

# Major Security Update Plan

## Executive Summary

This plan addresses critical security vulnerabilities in the Acquire multiplayer game, focusing on:
- Moving from client-side session management to proper Supabase authentication
- Protecting game state from unauthorized manipulation
- Ensuring player data privacy (tiles, session identifiers)
- Restricting backend access to authorized operations only

## Current Security Issues

### Critical Problems Identified:

1. **Overly Permissive RLS Policies** - Game tables allow anyone to INSERT, UPDATE, and DELETE without authorization checks. Players can cheat by modifying their cash/stocks or manipulate other players' data.

2. **Client-Side Session Management** - Uses `sessionStorage` with custom `session_id` instead of Supabase Auth. This provides no server-side verification.

3. **Tile Bag Exposure** - The `game_states` table exposes `tile_bag` to all players, allowing cheaters to see upcoming tiles.

4. **Game State Manipulation** - Anyone in a room can update game state during merger phases due to broad OR clauses in policies.

5. **Unprotected Cleanup Function** - The `cleanup_abandoned_rooms()` function lacks explicit access controls.

## Proposed Solution Architecture

```text
+------------------+     +------------------+     +------------------+
|   Frontend       |     |   Edge Function  |     |   Database       |
|   (React App)    |---->|   (Game Actions) |---->|   (Supabase)     |
+------------------+     +------------------+     +------------------+
        |                        |                        |
        v                        v                        v
   Auth Token             Validates Token           RLS Policies
   (Supabase Auth)        Validates Turn            Check auth.uid()
                          Updates State
```

## Implementation Steps

### Phase 1: Migrate to Supabase Anonymous Auth

Replace custom `session_id` management with Supabase's built-in anonymous authentication:

**Why anonymous auth?**
- Players can join games without creating accounts
- Provides proper server-side token validation via `auth.uid()`
- Session persists across page refreshes
- Compatible with existing authenticated users

**Changes Required:**

1. Update `multiplayerService.ts`:
   - Replace `getSessionId()` with `getOrCreateAnonSession()` that uses `supabase.auth.signInAnonymously()`
   - Store `auth.uid()` in `game_players.user_id` column instead of custom `session_id`
   - Update all queries to use the authenticated session

2. Update database:
   - Make `game_players.user_id` mandatory for new records
   - Keep `session_id` temporarily for backward compatibility during migration

### Phase 2: Lock Down RLS Policies

**game_players table:**

| Operation | Current | New Policy |
|-----------|---------|------------|
| SELECT | Restricted to own session | Allow room players via view only |
| INSERT | `WITH CHECK (true)` | `WITH CHECK (auth.uid() = user_id)` |
| UPDATE | Any room player can update anyone | `USING (auth.uid()::text = user_id::text)` |
| DELETE | `USING (true)` | `USING (auth.uid()::text = user_id::text)` |

**game_states table:**

| Operation | Current | New Policy |
|-----------|---------|------------|
| SELECT | Public | Create view excluding `tile_bag` |
| INSERT | Room players | Room players (verified via `auth.uid()`) |
| UPDATE | Current player + merger exception | Edge function only (via service role) |

**game_rooms table:**

| Operation | Current | New Policy |
|-----------|---------|------------|
| INSERT | `WITH CHECK (true)` | Authenticated users only (rate limited) |
| UPDATE | Host or waiting rooms | Host verified via `auth.uid()` |
| DELETE | Time-based cleanup | No change (cleanup function only) |

### Phase 3: Move Game State Updates to Edge Function

Create a secure edge function to handle all game state mutations:

**Why an edge function?**
- Uses service role key for database access
- Can validate game rules server-side
- Prevents client-side cheating
- Enforces turn order and valid moves

**Edge Function: `game-action`**

```text
Supported Actions:
- place_tile: Validate tile ownership, placement rules
- found_chain: Validate chain availability
- buy_stocks: Validate cash, stock availability
- handle_merger: Validate merger sequence, stock decisions
- end_turn: Draw tile, advance player
- vote_end_game: Record vote
```

**Validation performed:**
- Verify JWT token and extract user ID
- Verify it's the requesting player's turn
- Validate the requested action is legal
- Apply game rules
- Update database with service role

### Phase 4: Create Secure Views

**game_states_public view:**

Exposes game state WITHOUT sensitive data:
- Excludes `tile_bag` (upcoming tiles are secret)
- Includes all other game state for UI rendering

**game_players_public view:**

Already exists. Confirm it excludes:
- `session_id` (already removed)
- `tiles` (player's private hand)
- `user_id` (internal identifier)

### Phase 5: Secure the Cleanup Function

Restrict execution of `cleanup_abandoned_rooms()`:

```sql
REVOKE ALL ON FUNCTION public.cleanup_abandoned_rooms() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_abandoned_rooms() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_abandoned_rooms() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_abandoned_rooms() TO postgres;
```

### Phase 6: Add Rate Limiting

Prevent abuse via database constraints:

1. **Room creation rate limit**: Add a trigger that limits rooms per user per hour
2. **Player join limit**: Limit concurrent room memberships per user

---

## Technical Implementation Details

### Database Migration

```sql
-- 1. Create secure view for game_states (hide tile_bag)
CREATE VIEW public.game_states_public
WITH (security_invoker=on) AS
  SELECT 
    id, room_id, current_player_index, phase, board, chains,
    stock_bank, last_placed_tile, pending_chain_foundation,
    merger, stocks_purchased_this_turn, game_log, winner,
    end_game_votes, updated_at
  FROM public.game_states;
  -- Excludes: tile_bag

-- 2. Update game_players policies for auth.uid()
DROP POLICY IF EXISTS "Anyone can join games" ON public.game_players;
DROP POLICY IF EXISTS "Anyone can leave games" ON public.game_players;
DROP POLICY IF EXISTS "Room players can update" ON public.game_players;

CREATE POLICY "Authenticated users can join games"
ON public.game_players FOR INSERT
TO authenticated
WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Players can leave their own games"
ON public.game_players FOR DELETE
TO authenticated
USING (auth.uid()::text = user_id::text);

CREATE POLICY "Players can update own record"
ON public.game_players FOR UPDATE
TO authenticated
USING (auth.uid()::text = user_id::text);

-- 3. Restrict game_states updates to service role only
DROP POLICY IF EXISTS "Current player can update game state" ON public.game_states;

CREATE POLICY "Service role can update game state"
ON public.game_states FOR UPDATE
TO service_role
USING (true);

-- 4. Restrict game_rooms creation to authenticated
DROP POLICY IF EXISTS "Anyone can create rooms" ON public.game_rooms;

CREATE POLICY "Authenticated users can create rooms"
ON public.game_rooms FOR INSERT
TO authenticated
WITH CHECK (true);

-- 5. Secure cleanup function
REVOKE ALL ON FUNCTION public.cleanup_abandoned_rooms() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_abandoned_rooms() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_abandoned_rooms() FROM authenticated;
```

### Edge Function: `game-action`

Location: `supabase/functions/game-action/index.ts`

**Request format:**
```json
{
  "action": "place_tile",
  "roomId": "uuid",
  "payload": { "tileId": "5G" }
}
```

**Core logic:**
1. Validate JWT and extract `userId`
2. Fetch game state and player data
3. Verify player is in the room
4. Verify it's the player's turn (or merger exception)
5. Execute action using game logic (imported from shared utils)
6. Update database using service role client
7. Return success/error response

### Frontend Changes

**multiplayerService.ts updates:**

```typescript
// Replace getSessionId with:
export const getOrCreateAnonSession = async (): Promise<string | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  
  if (user) {
    return user.id;
  }
  
  // Sign in anonymously if not authenticated
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error('Failed to create anonymous session:', error);
    return null;
  }
  
  return data.user?.id ?? null;
};

// Update joinRoom to use user_id instead of session_id
export const joinRoom = async (roomCode: string, playerName: string) => {
  const userId = await getOrCreateAnonSession();
  if (!userId) {
    return { success: false, error: 'Failed to authenticate' };
  }
  
  // Insert with user_id
  const { error } = await supabase
    .from('game_players')
    .insert({
      room_id: room.id,
      player_name: playerName,
      player_index: playerIndex,
      user_id: userId,
      session_id: userId, // Backward compatibility
    });
  // ...
};
```

**Game actions via edge function:**

```typescript
// Replace direct database updates with edge function calls
export const executeGameAction = async (
  action: string,
  roomId: string,
  payload: any
): Promise<{ success: boolean; error?: string; newState?: GameState }> => {
  const { data, error } = await supabase.functions.invoke('game-action', {
    body: { action, roomId, payload }
  });
  
  if (error) {
    return { success: false, error: error.message };
  }
  
  return data;
};
```

---

## Security Checklist

After implementation, verify:

- [ ] Anonymous users cannot read tile_bag from game_states
- [ ] Players cannot see other players' tiles
- [ ] Players cannot modify other players' cash/stocks
- [ ] Only the current player can make moves
- [ ] Game state updates require valid JWT
- [ ] Room creation requires authentication
- [ ] Cleanup function cannot be called by users
- [ ] Email/password data is never exposed (already protected by Supabase Auth)
- [ ] Profiles table only accessible to authenticated users

---

## Migration Path

To avoid breaking existing games:

1. Deploy edge function first (doesn't affect existing flow)
2. Add new RLS policies alongside existing ones
3. Update frontend to use edge function for new games
4. Mark existing games as using "legacy" mode
5. Remove permissive policies after legacy games complete
6. Remove session_id column after migration period

---

## Files to Create/Modify

**New Files:**
- `supabase/functions/game-action/index.ts` - Edge function for game actions

**Modified Files:**
- `src/utils/multiplayerService.ts` - Switch to anonymous auth, use edge function
- `src/hooks/useOnlineGame.ts` - Update to use edge function for actions
- Database migration - New policies, views, function restrictions

**Migration SQL:**
- Create `game_states_public` view
- Update all RLS policies
- Restrict cleanup function permissions

