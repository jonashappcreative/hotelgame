# Hotel Game - Q&A Session

## Overview
This document contains an interactive Q&A session about the Hotel Game project. Questions and answers will be added as the session progresses.

---

## Questions & Answers

### Q1: What's the tech stack for Real-time Updates in the gameplay?

**Socket.io** (WebSocket transport) with a **Hetzner-hosted relay server**. 

The architecture follows a **notification + refetch pattern**: Socket.io emits lightweight signals (`game:players_changed`, `game:state_updated`, `room:status_changed`) when data changes. The client responds by fetching authoritative state from the Netlify Functions API layer—not directly from the database. This keeps the WebSocket connection lightweight and maintains a clean separation: API handles auth/validation, Socket.io only handles notifications.

**Key Details:**
- Client: `socket.io-client` library, WebSocket-only transport
- Server: Hetzner Socket.io relay (configured via `VITE_WS_URL` env var)
- Pattern: Signal → Refetch (instead of pushing full state updates)
- Security: JWT tokens validate every API call; tile_bag never sent to client

---

### Q2: Why did we discard the login feature and what are we doing instead to identify players?

Login **isn't discarded**—just **hidden** behind a feature flag (`SHOW_ACCOUNT_UI = false`). The auth system remains intact for future use.

**Current player identification: Anonymous JWT + persistent localStorage**
- Players join **without signup/login** → automatic anonymous session creation (`getOrCreateAuthSession`)
- Each gets a **JWT token** stored in localStorage, decoded on app load to restore identity
- **Rejoin logic** (priority order):
  1. Check if registered user (JWT token + valid expiry)
  2. Check localStorage for saved game info (valid 48 hours)
  3. Verify player still exists in room by name
- Anonymous users have `is_anonymous = true` in database, persist via user_id

**Persistence:** Yes—identified by user_id across restarts via JWT token or localStorage fallback.

---

### Q3: What were the login/auth debugging fuckups?

**Main issues during Supabase era (Jan 2026):**

1. **Overly Restrictive RLS Policy** — `game_players` SELECT policy only allowed viewing own user_id record. Multiple anonymous users trying to join the same room couldn't see each other, so they all tried claiming the same `player_index` slot simultaneously.

2. **Race Condition Hell** — When 2+ users joined concurrently:
   - Both would find no players (due to RLS), assume they're player_0
   - Both try to INSERT at player_index 0 → unique constraint violation
   - No retry logic, both fail silently
   - Game join appeared broken

3. **Inadequate Retry Logic** — Initial retry was `100ms * attempt`. With 3 retries and 2+ concurrent joins, collisions happened faster than exponential backoff could handle. Solution: exponential backoff with **jitter** (randomized delay) to desynchronize concurrent requests.

4. **Duplicate Realtime Publication Errors** — Migrations ran idempotently but didn't handle pre-existing publications. Running migration twice = `duplicate_object` error. Fixed with `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL;` blocks.

5. **Missing Unique Constraint** — No database-level protection against the same user joining a room twice (race condition where tab 1 + tab 2 both try to join). Added: `UNIQUE (room_id, user_id)`.

**Debugging artifacts:** commit `dbd5e25` ("Add comprehensive debug logging...") added extensive `console.log` statements to trace auth session creation, room joining, and retry logic—these are still in the codebase at `src/utils/multiplayerService.ts`.

