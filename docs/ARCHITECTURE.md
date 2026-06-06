# Acquire — Architecture

This document describes the **target architecture** the project is migrating to
(Netlify DB + Hetzner WebSocket relay, no Supabase) and the status of that
migration. For the step-by-step migration plan see
[transition_to_hetzner.md](transition_to_hetzner.md).

---

## 1. High-level overview

```
                         ┌─────────────────────────────────────────┐
                         │            Browser (React SPA)           │
                         │   Vite build, served by Netlify CDN      │
                         └───────┬───────────────────────┬─────────┘
                                 │                        │
                  HTTPS (REST)   │                        │  WSS (realtime)
                                 ▼                        ▼
              ┌──────────────────────────────┐   ┌──────────────────────────┐
              │   Netlify Serverless Funcs    │   │   Hetzner WS relay        │
              │   /api/game-action            │   │   (Socket.io, Docker)     │
              │   /api/auth/*                  │   │   stateless, no DB        │
              └───────────────┬──────────────┘   └────────────▲─────────────┘
                              │                                │
                  SQL (Neon   │       POST /internal/notify    │
                  serverless) │       (shared secret)          │
                              ▼────────────────────────────────┘
              ┌──────────────────────────────┐
              │   Netlify DB (Neon Postgres)  │
              │   game_rooms / game_players / │
              │   game_states / game_history /│
              │   profiles / users            │
              └──────────────────────────────┘
```

Three independent pieces:

| Component | Hosting | Responsibility | Touches DB? |
|---|---|---|---|
| **Frontend** | Netlify CDN | React SPA, all UI/rendering | No (via API only) |
| **Serverless Functions** | Netlify | Authoritative game logic, auth, all DB writes | **Yes** (only writer) |
| **WS relay** | Hetzner (Docker) | Broadcast room events to browsers | **No** |

The key invariant: **only the Netlify Functions touch the database.** The browser
never holds DB credentials, and the WS relay is a dumb message bus. This is what
makes the realtime layer disposable — if Hetzner goes down, game state is still
safe in the DB and clients can refetch by reloading.

---

## 2. Why this architecture (vs. the old Supabase one)

Supabase's free tier pauses the whole project after 7 days of inactivity, which
breaks a low-traffic game. The replacement splits Supabase's three roles:

| Supabase role | Replaced by |
|---|---|
| Postgres + RLS | Netlify DB (Neon Postgres), access control in Functions |
| Auth (anon + email) | Custom JWT via `jose`, `users` table, bcrypt |
| Realtime (`postgres_changes`) | Hetzner Socket.io relay + `notify` fan-out |
| Edge Function (`game-action`) | Netlify Function (`game-action.ts`) |

---

## 3. Authentication

Stateless JWT, signed/verified with [`jose`](https://github.com/panva/jose) (HS256,
secret in `JWT_SECRET`). The token's `sub` claim is the user's UUID in the
`users` table. The browser stores the token in `localStorage` (replacing
Supabase's `persistSession`).

| Endpoint | Purpose | Token TTL |
|---|---|---|
| `POST /api/auth/anonymous` | Create an anonymous `users` row, issue token | 48h |
| `POST /api/auth/signup` | Create email/password user (bcrypt), issue token | 7d |
| `POST /api/auth/login` | Verify credentials, issue token | 7d |

Every call to `/api/game-action` carries `Authorization: Bearer <token>`. The
function calls `verifyAuth(req)` → returns the `userId`, then checks the user is
actually a player in the room before doing anything.

**Auth flow (anonymous):**

```
Browser                         Netlify Function            Netlify DB
   │  POST /api/auth/anonymous        │                         │
   ├─────────────────────────────────►│  INSERT INTO users      │
   │                                  ├────────────────────────►│
   │                                  │◄─── id ──────────────────┤
   │                                  │  signToken(id, 48h)     │
   │◄──── { token, userId } ──────────┤                         │
   │  localStorage["acquire_auth_token"] = token                │
```

---

## 4. A game action, end to end

Example: a player buys stock.

```
Browser                  Netlify Function (game-action)        Netlify DB         WS relay
  │  POST /api/game-action                  │                      │                  │
  │  { action:"buy_stocks", roomId, payload}│                      │                  │
  ├────────────────────────────────────────►│                      │                  │
  │                                         │ verifyAuth() → userId │                  │
  │                                         │ load player/state ───►│                  │
  │                                         │◄──────────────────────┤                  │
  │                                         │ validate turn, funds  │                  │
  │                                         │ apply rules (pure)    │                  │
  │                                         │ UPDATE players/state ►│                  │
  │                                         │ notifyForAction() ───────────────────────►│ POST /internal/notify
  │◄──── { success: true } ─────────────────┤                      │                  │ io.to(room).emit(...)
  │                                                                                    │
  │◄════ socket event "game:state_updated" ════════════════════════════════════════════┤
  │  → refetch state from /api (excludes tile_bag)                                      │
  │                                                                                    │
  │   (all OTHER players in the room receive the same socket event and refetch)         │
```

The acting player gets the synchronous `{ success }` response **and** the socket
event; other players only get the socket event. Both react by refetching the
current room state. Realtime is best-effort: a dropped notify just means a client
is briefly stale until its next refetch/reload.

**Events the relay broadcasts:**

| Event | Emitted after | Client reaction |
|---|---|---|
| `game:state_updated` | any game action | refetch `game_states_public` |
| `game:players_changed` | join/leave/ready/cash/stock change | refetch `game_players_public` |
| `room:status_changed` | game start / finish / reset | update room status |

---

## 5. Database

Single consolidated schema in [`db/schema.sql`](../db/schema.sql) (replaces the
whole `supabase/migrations/` history). Differences from the Supabase schema:

- **No Row Level Security.** Supabase enforced per-row access with `auth.uid()`.
  Here the Functions layer is the only DB client, so it enforces access in code
  (e.g. "is this `userId` a player in this room?", "is it their turn?").
- **`users` table replaces `auth.users`.** All `user_id` foreign keys point here.
- **No `supabase_realtime` publication** — realtime is handled by the relay.

### Tables

| Table | Holds |
|---|---|
| `users` | id, email, password_hash, is_anonymous |
| `profiles` | display_name per user |
| `game_rooms` | room_code, status, max_players, custom_rules |
| `game_players` | per-player cash, stocks, **tiles**, **session_id**, connection |
| `game_states` | board, chains, stock_bank, **tile_bag**, merger, log, rules |
| `game_history` | completed-game records per user |

### Hiding secrets (anti-cheat)

Two columns must never reach the browser:

- `game_states.tile_bag` — would reveal future draws.
- `game_players.tiles` (other players') and `session_id`.

Two views project these away:

- `game_states_public` — every column **except** `tile_bag`.
- `game_players_public` — every column **except** `tiles` and `session_id`.

Without RLS these are plain views; the discipline is that **Functions return data
to the browser only via these views**, and serve a player their own `tiles` only
with `WHERE user_id = <jwt sub>`.

---

## 6. The DB shim (why game-action looks like Supabase code)

The old edge function was ~2,100 lines, almost all pure Acquire rules expressed
through the Supabase query API (`adminClient.from('t').select().eq()…`). Rewriting
all of that as raw SQL would be a large, bug-prone change.

Instead, [`netlify/functions/_shared/db.ts`](../netlify/functions/_shared/db.ts)
implements a **minimal Supabase-compatible shim** over the Neon driver. It
supports exactly the subset the handler uses:

```ts
db.from(t).select('*').eq('a', x).single()
db.from(t).select('*').eq('a', x).order('player_index')
db.from(t).insert({ ... })
db.from(t).update({ ... }).eq('id', id)
db.from(t).delete().eq('room_id', roomId)
```

Each builder is awaitable and resolves to `{ data, error }`, matching Supabase's
shape — so the ~2,000 lines of game logic ported **verbatim**. Only the top of
the file (auth + client init) and a new `notifyForAction()` call changed.

The shim knows which columns are `jsonb` vs `text[]` and encodes them explicitly
(`$n::jsonb` with `JSON.stringify`, `$n::text[]` with a JS array) so values
round-trip correctly. All values are bound parameters; only our own
(trusted) table/column identifiers are interpolated.

For auth endpoints that need `RETURNING`, there's a raw `query(text, params)`
helper alongside the shim.

---

## 7. The WebSocket relay

[`ws-server/`](../ws-server/) — a ~90-line stateless Socket.io + Express server,
deployed on Hetzner via Docker (`docker compose up -d`).

- Browsers connect, then `socket.emit('join_room', roomId)` → `socket.join(room)`.
- Netlify Functions `POST /internal/notify { roomId, event, payload }` with the
  `x-internal-secret` header → `io.to(roomId).emit(event, payload)`.
- `GET /health` for uptime checks; `restart: unless-stopped` for resilience.

It has no database access and no game knowledge — it only relays. See
[ws-server/README.md](../ws-server/README.md) for deploy steps.

---

## 8. Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Netlify | Neon Postgres connection string |
| `JWT_SECRET` | Netlify | Sign/verify auth tokens |
| `WS_SERVER_URL` | Netlify | Internal URL of the Hetzner relay (for notify) |
| `WS_INTERNAL_SECRET` | Netlify + Hetzner | Shared secret for `/internal/notify` |
| `ALLOWED_ORIGINS` | Netlify + Hetzner | CORS / Socket.io allowed browser origins |
| `VITE_WS_URL` | Netlify (build) | `wss://…` the browser connects to |

---

## 9. Repository map (migration-relevant)

```
db/
  schema.sql                  Consolidated Netlify DB (Neon) schema
netlify/
  functions/
    game-action.ts            Ported authoritative game logic (all 13 actions)
    rooms.ts                  Room/player/game-state data ops (dispatch on `op`)
    account.ts                Profile + game history ops
    auth-anonymous.ts         POST /api/auth/anonymous
    auth-signup.ts            POST /api/auth/signup
    auth-login.ts             POST /api/auth/login
    _shared/
      db.ts                   Supabase-compatible shim over Neon + raw query()
      auth.ts                 jose signToken / verifyAuth
      cors.ts                 CORS headers + jsonResponse helper
      ws.ts                   notifyWsServer() fan-out helper
ws-server/
  server.js                   Socket.io relay
  Dockerfile, docker-compose.yml, README.md
netlify.toml                  functions dir + /api/* redirects
src/integrations/api/
  client.ts                   Token storage + apiFetch + auth wrappers (NEW)
src/utils/multiplayerService.ts  Refactored to apiFetch + socket.io-client
src/contexts/AuthContext.tsx     Refactored to JWT/api client
supabase/                     OLD backend — removed in Phase 4
src/integrations/supabase/    OLD client — now unused, removed in Phase 4
```

---

## 10. Migration status

| Phase | Scope | Status |
|---|---|---|
| **1 — Infrastructure** | `db/schema.sql`, `ws-server/` scaffold | **Code done** (schema applies & is idempotent; relay boots & endpoints verified). Provisioning Netlify DB, Hetzner deploy, DNS still manual. |
| **2 — Backend** | `game-action.ts` port, 3 auth endpoints, DB shim, WS notify | **Code done** (type-checks + bundles). Live DB round-trip pending Phase 4. |
| **3 — Frontend** | `rooms`/`account` endpoints, `src/integrations/api/`, refactor `multiplayerService.ts` / `AuthContext.tsx` / `useOnlineGame` / `GameHistory`, `subscribeToRoom()` → socket.io-client | **Code done** (production Vite build passes; functions type-check + bundle). Live end-to-end pending Phase 4. |
| **4 — Cutover** | local end-to-end test, deploy, remove Supabase | Not started |

### What's verified so far
- `db/schema.sql` applied to a real Postgres 14 instance: 6 tables + 2 views, idempotent on re-run.
- `ws-server`: boots, `/health` ok, `/internal/notify` returns 401 (no secret) / `{ok:true}` (valid) / 400 (bad body).
- `netlify/functions/*` (game-action, rooms, account, auth-*): pass `tsc` type-check and `esbuild` bundling.
- Frontend: `npm run build` (Vite/esbuild) succeeds — all Supabase usage in app code replaced; only the unused `src/integrations/supabase/client.ts` remains for Phase 4 deletion.

### API surface (browser → Netlify Functions)
- `POST /api/auth/anonymous | signup | login`
- `POST /api/game-action` `{ action, roomId, payload }`
- `POST /api/rooms` `{ op, ... }` — create, get_room, get_rules, find_active, list_players, get_players, get_state, join, leave, heartbeat, disconnect
- `POST /api/account` `{ op }` — get_profile, set_display_name, list_history

### Known follow-ups
- Run the full stack against a live Neon DB + relay (Phase 4 test step).
- Finalize CSP `connect-src` in `netlify.toml` for the real `wss://` host and drop the Supabase origins (Phase 4).
- Delete `src/integrations/supabase/`, the `supabase/` dir, and `@supabase/supabase-js`; port `multiplayerService.test.ts` off the Supabase mock (Phase 4).
- The `max 5 active rooms/user` rule (old `check_room_creation_limit` trigger) is now enforced in the `rooms` create op. ✓
```
