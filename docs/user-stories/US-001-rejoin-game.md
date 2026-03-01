# User Story: Rejoin Ongoing Game

**Story ID:** US-001
**Feature:** Game Reconnection
**Priority:** High
**Created:** 2026-02-09

---

## User Story

**As a** player in a multiplayer game
**I want to** automatically reconnect to my ongoing game if I accidentally refresh the page or lose connection
**So that** the game can continue without blocking other players or losing my progress

---

## Problem Statement

Currently, when a player refreshes their browser or loses connection during an active game:
1. They are returned to the lobby instead of the ongoing game
2. Attempting to rejoin with the same name and room code fails with "game already ongoing"
3. The game becomes blocked for all other players since they cannot proceed without the disconnected player
4. There is no way to recover the game session

This creates a poor experience and can result in abandoned games due to accidental page refreshes or network issues.

---

## Acceptance Criteria

### AC1: Automatic Reconnection on Page Refresh
- **Given** a player is in an active game (status: `playing`)
- **When** they refresh the page or navigate back to the app
- **Then** they should be automatically redirected to their ongoing game
- **And** they should resume at their previous player position with all their assets intact (cash, tiles, stocks)

### AC2: Reconnection via Room Code (Same Identity)
- **Given** a player was disconnected from an active game
- **When** they attempt to join using the same room code
- **And** they have the same identity (user_id for logged-in users, or session_id for anonymous users in the same browser)
- **Then** they should be reconnected to their existing player slot
- **And** they should NOT be treated as a new player

### AC3: Reconnection via Room Code (Different Device - Logged-in Users Only)
- **Given** a logged-in player was disconnected from an active game
- **When** they log in from a different device/browser
- **And** they navigate to or enter the room code
- **Then** they should be reconnected to their existing player slot
- **And** their game state (cash, stocks) should be preserved

### AC4: Anonymous User Reconnection Limitations
- **Given** an anonymous player was disconnected from an active game
- **When** they try to rejoin from a different browser or after clearing browser data
- **Then** they should see a clear message explaining they cannot rejoin without their original session
- **And** they should be offered the option to create an account to prevent this in the future

### AC5: Connection Status Visibility
- **Given** a multiplayer game is in progress
- **When** a player disconnects (refresh, network loss, browser close)
- **Then** other players should see that player marked as "disconnected" or "reconnecting"
- **And** the game should continue to function (other players can still see the board state)

### AC6: Graceful Turn Handling for Disconnected Players
- **Given** it is a disconnected player's turn
- **When** they have been disconnected for more than 30 seconds
- **Then** other players should see a "Waiting for [Player Name] to reconnect..." message
- **And** optionally, after a configurable timeout (e.g., 2-5 minutes), the game could offer options to:
  - Continue waiting
  - Allow AI to play for the disconnected player
  - Vote to end the game

### AC7: Persistent Game Recovery
- **Given** a player has an ongoing game
- **When** they open the app (even after browser restart for logged-in users)
- **Then** they should see a prompt or notification about their active game
- **And** they should be able to click to rejoin immediately

---

## Technical Requirements

### Database Changes

1. **Update `is_connected` tracking**
   - Implement heartbeat mechanism to track active connections
   - Update `is_connected` to `false` when heartbeat stops
   - Update `is_connected` to `true` when player reconnects

2. **Add `last_seen_at` column to `game_players`**
   ```sql
   ALTER TABLE game_players
   ADD COLUMN last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
   ```

3. **Add `disconnected_at` column to `game_players`**
   ```sql
   ALTER TABLE game_players
   ADD COLUMN disconnected_at TIMESTAMP WITH TIME ZONE;
   ```

### Frontend Changes

1. **Implement presence/heartbeat system**
   - Send heartbeat every 10-15 seconds while in game
   - Use Supabase Realtime Presence or custom implementation

2. **Add reconnection check on app load**
   - Query for active games where user is a player
   - Redirect to game if found

3. **Update `joinRoom` logic**
   - Check if user already exists in room (even if game is `playing`)
   - Allow rejoin if identity matches existing player

4. **Add disconnection UI indicators**
   - Show disconnected player status to other players
   - Show "Reconnecting..." state to the reconnecting player

### Edge Function Changes

1. **Add `rejoin` action**
   - Validate player identity against existing game_players record
   - Update `is_connected` to `true`
   - Update `last_seen_at`
   - Clear `disconnected_at`

2. **Add `heartbeat` action**
   - Update `last_seen_at` timestamp
   - Lightweight action for presence tracking

3. **Modify turn validation**
   - Consider disconnection status when validating turns
   - Potentially skip disconnected players or implement timeout logic

---

## User Flows

### Flow 1: Automatic Reconnection (Same Browser)

```
1. Player is in active game
2. Player accidentally refreshes page
3. App loads → checks for active games for current user
4. Active game found → redirect to /game/:roomCode
5. Game state loads → player resumes where they left off
6. Other players see "[Player] reconnected"
```

### Flow 2: Manual Reconnection (Same Identity)

```
1. Player loses connection or closes browser
2. Player opens app again
3. Player enters room code (or clicks "Rejoin" from notification)
4. System checks: Does this user_id exist in game_players for this room?
5. Yes → Mark as connected, load game state
6. Player resumes their position
```

### Flow 3: Failed Reconnection (Anonymous, Lost Session)

```
1. Anonymous player closes browser
2. Player opens new browser/incognito
3. Player enters room code
4. System checks: No matching user_id or session_id found
5. Show error: "Cannot rejoin - your session has expired"
6. Offer: "Create an account to prevent this in the future"
```

---

## Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Player refreshes during their turn | Reconnect, resume turn (timer may reset) |
| Player refreshes during merger decision | Reconnect, show merger dialog with current state |
| Two tabs open, one closes | Other tab continues working normally |
| Player tries to rejoin as different name | Reject - must use original identity |
| Game ends while player disconnected | Show game over screen on reconnect |
| All players disconnect | Game remains in `playing` state, recoverable |
| Player disconnects then game is cleaned up (24h+) | Show "Game no longer available" |

---

## Out of Scope (Future Enhancements)

- AI takeover for disconnected players
- Vote-to-kick functionality
- Spectator mode for disconnected players
- Mobile push notifications for turn/reconnection

---

## Definition of Done

- [ ] Players can refresh the page and automatically return to their game
- [ ] Players can rejoin using room code if they have the same identity
- [ ] Logged-in users can rejoin from different devices
- [ ] Anonymous users are informed of session limitations
- [ ] Other players can see when someone is disconnected
- [ ] All existing tests pass
- [ ] New tests added for reconnection scenarios
- [ ] No regression in current multiplayer functionality

---

## Notes

- The `is_connected` field already exists in the schema but is not actively used
- Supabase Realtime Presence could be leveraged for connection tracking
- Consider rate limiting heartbeat to avoid excessive database writes
- Anonymous users rely on browser sessionStorage - this is inherently fragile
