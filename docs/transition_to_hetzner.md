# Transition Plan: Supabase → Hetzner + Netlify DB

## Problem

Supabase free tier pauses the entire project after 7 days of inactivity, breaking `acquiregame.netlify.app` for low-traffic use. No graceful wake-up — users hit a dead app until the project is manually unpaused.

## Target Architecture

```
Browser (React SPA on Netlify)
  │
  ├─── REST/HTTP ──► Netlify Serverless Functions ──► Netlify DB (Neon Postgres)
  │                   (game actions, auth, history)
  │
  └─── WebSocket ──► Hetzner WS Server (Socket.io / Docker)
                      (room events, turn broadcasts, presence)
```

**Netlify:** Frontend (React/Vite) + Serverless Functions + Netlify Database (Postgres/Neon)
**Hetzner:** Persistent Node.js Socket.io server in Docker — pure message relay, no direct DB access

Supabase is fully removed. Auth becomes stateless (JWT issued by Netlify Functions or a lightweight library like `jose`).

---

## What Needs to Change

### 1. Database (Supabase Postgres → Netlify DB)

**Tables to migrate (from `supabase/migrations/` + `src/integrations/supabase/types.ts`):**
- `game_rooms` — room metadata, status, max_players, custom_rules
- `game_players` — per-player state (cash, stocks, tiles, connection status)
- `game_states` — full serialized game state per room
- `game_history` — completed game records per user
- `profiles` — display names linked to user accounts

**Views to recreate:**
- `game_players_public` — players minus `tiles` and `session_id` (security row filter)
- `game_states_public` — game state minus `tile_bag` (prevents tile peeking)

**Migration approach:**
1. Export schema from Supabase (`supabase db dump --schema-only`)
2. Strip Supabase-specific extensions (pgcrypto, uuid-ossp are available in Neon; `auth.users` FK must be replaced with a local `users` table)
3. Apply to Netlify DB via `psql` or the Netlify CLI
4. Export data if any real game records are worth keeping

---

### 2. Authentication (Supabase Auth → Custom JWT)

**Current usage:**
- `supabase.auth.signInAnonymously()` — for anonymous game sessions
- `supabase.auth.signUp/signInWithPassword` — for registered accounts
- `supabase.auth.getUser()` / `supabase.auth.getSession()` — identity checks throughout
- `AuthContext.tsx` — wraps all auth state for the React tree

**Replacement strategy:**
- Use `jose` (lightweight JWT library, works in Netlify Edge/Node) for signing and verifying tokens
- Anonymous sessions: Netlify Function `/api/auth/anonymous` issues a signed JWT with a random UUID as `sub`; stored in `localStorage` (same as current `persistSession: true`)
- Registered accounts: `/api/auth/signup`, `/api/auth/login` endpoints — bcrypt password hashing, JWT on success
- `AuthContext.tsx` refactor: replace `supabase.auth.*` calls with `fetch('/api/auth/...')` + local JWT storage

**DB change:** Add a `users` table (`id uuid PK, email text unique, password_hash text, created_at`) to replace the Supabase `auth.users` dependency. The `game_players.user_id` and `game_history.user_id` FKs point here instead.

---

### 3. Realtime / WebSockets (Supabase Realtime → Socket.io on Hetzner)

**Current usage in `subscribeToRoom()` (`multiplayerService.ts:549-609`):**
- `supabase.channel(room-${roomId})` subscribes to `postgres_changes` on three tables: `game_players`, `game_states`, `game_rooms`
- On `game_states` change → fetch full state from `game_states_public` view
- On `game_players` change → refetch `getRoomPlayers()`
- On `game_rooms` change → update `roomStatus`

**Replacement:** The Hetzner WS server emits named events. The frontend replaces the Supabase channel subscription with Socket.io listeners.

**Events the WS server needs to emit (to all clients in a room):**
- `game:state_updated` — after any game action completes
- `game:players_changed` — player joined/left/ready toggle
- `room:status_changed { status }` — game started / finished

**Events the WS server receives (from Netlify Functions, not the browser):**
- After each Netlify Function mutates the DB, it POSTs a notification to the Hetzner WS server's internal HTTP endpoint, which fans it out to the correct Socket.io room

**Frontend changes:**
- Remove `supabase.channel(...)` from `subscribeToRoom()`
- Connect `socket.io-client` to `wss://ws.jonashapp.com` (or similar subdomain)
- `socket.emit('join_room', roomId)` on join
- Replace the three Supabase listeners with `socket.on('game:state_updated', ...)`, etc.

---

### 4. Supabase Edge Function → Netlify Serverless Function

**Current:** `supabase/functions/game-action/index.ts` — single Deno function handling all game mutations (`place_tile`, `found_chain`, `buy_stocks`, `start_game`, `toggle_ready`, etc.)

**Replacement:** `netlify/functions/game-action.ts` — same logic, same actions, ported to Node.js 20

Key differences from the current implementation:
- Replace `createClient` (Supabase) with `postgres` or `@neondatabase/serverless` driver
- Replace the `Authorization: Bearer <supabase-jwt>` verification with `jose.jwtVerify(token, JWT_SECRET)`
- After each mutation, call the internal Hetzner WS endpoint to fan out the event
- CORS `ALLOWED_ORIGINS` list stays the same

---

### 5. Files to Delete / Archive

After migration is complete:
- `src/integrations/supabase/` — entire directory (client, types)
- `supabase/` — entire directory (config, migrations, edge functions)
- Remove `@supabase/supabase-js` from `package.json`
- Remove `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from env

---

## Implementation Order

Work in a feature branch. The app should remain deployable from `main` until the cutover.

### Phase 1 — Infrastructure
- [ ] Provision Netlify DB on the project (requires credit-based Netlify plan)
- [ ] Apply schema to Netlify DB (migrate from Supabase dump, replace `auth.users` FK)
- [ ] Set up `users` table and JWT secret as Netlify env var
- [ ] Scaffold Hetzner WS server (`ws-server/` directory in this repo or separate repo)
  - `server.js`: Socket.io + Express, `POST /internal/notify` endpoint, joins/leaves rooms
  - `Dockerfile` + `docker-compose.yml`
  - Deploy on Hetzner with `docker compose up -d`
  - Point subdomain (e.g. `ws.acquiregame.jonashapp.com`) at Hetzner IP via DNS

### Phase 2 — Backend
- [ ] Port `supabase/functions/game-action/index.ts` → `netlify/functions/game-action.ts`
  - Replace Supabase client with Neon driver
  - Replace Supabase JWT verify with `jose`
  - Add `notifyWsServer(roomId, event)` helper that POSTs to Hetzner after mutations
- [ ] Implement auth endpoints in `netlify/functions/`:
  - `auth-anonymous.ts` — issues anonymous JWT
  - `auth-signup.ts` — creates user + issues JWT
  - `auth-login.ts` — verifies credentials + issues JWT

### Phase 3 — Frontend
- [ ] Refactor `src/integrations/supabase/` → `src/integrations/api/` (thin fetch wrappers)
- [ ] Refactor `src/utils/multiplayerService.ts`:
  - Replace all `supabase.from(...)` calls with `fetch('/api/...')` calls
  - Replace `supabase.functions.invoke('game-action', ...)` with `fetch('/.netlify/functions/game-action', ...)`
  - Rewrite `subscribeToRoom()` using `socket.io-client`
- [ ] Refactor `src/contexts/AuthContext.tsx`:
  - Replace `supabase.auth.*` with the new auth endpoints
  - JWT stored in `localStorage` under a key like `acquire_auth_token`

### Phase 4 — Cutover & Cleanup
- [ ] Test full game flow locally against Netlify DB + local WS server
- [ ] Deploy to production, run smoke tests
- [ ] Remove Supabase SDK, env vars, and `supabase/` directory
- [ ] Pause (or delete) the Supabase project

---

## Hetzner WS Server — Minimal Spec

```
ws-server/
  server.js          Node.js 20, ~80 lines
  package.json       socket.io, express
  Dockerfile
  docker-compose.yml
```

**`server.js` responsibilities:**
1. Accept Socket.io connections; on `join_room(roomId)` → `socket.join(roomId)`
2. Accept `POST /internal/notify` with `{ roomId, event, payload }` → `io.to(roomId).emit(event, payload)`
3. `/internal/notify` must only accept requests from Netlify Function IPs or require a shared secret header

**Docker:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js .
EXPOSE 3001
CMD ["node", "server.js"]
```

---

## Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Netlify env | Neon Postgres connection string |
| `JWT_SECRET` | Netlify env | Sign/verify auth tokens |
| `WS_SERVER_URL` | Netlify env | Internal URL of Hetzner WS server |
| `WS_INTERNAL_SECRET` | Netlify env + Hetzner | Shared secret for `/internal/notify` |
| `VITE_WS_URL` | Netlify env (build) | `wss://ws.acquiregame.jonashapp.com` |

---

## Risk Notes

- **Single point of failure:** The Hetzner WS server going down means realtime stops working, but game state is still persisted in DB. Players can refresh to get current state; use `--restart unless-stopped` in Docker to minimise downtime.
- **Anonymous auth security:** Anonymous JWTs must expire (e.g. 48h) and be validated on every Netlify Function call, same as the current Supabase anon key model.
- **Tiles still hidden:** The `game_states_public` view strips `tile_bag`; the equivalent in Netlify Functions is to never return `tile_bag` from game state queries to the browser, and to serve each player's own tiles only via the auth-gated query (`WHERE user_id = $jwt_sub`).
