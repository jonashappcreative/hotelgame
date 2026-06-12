# Plan: Full Hetzner Migration

## Context

The Hotel Game multiplayer board game is currently split across Netlify (SPA + serverless functions + Neon Postgres) and Hetzner (WebSocket relay only). Netlify's credit-based billing charges for function compute, web requests, bandwidth, DB compute, and DB bandwidth — all of which add up for a real-time multiplayer game. The free tier's 300-credit hard limit is easy to exceed, and even the $9/mo Personal plan (1,000 credits) may not be enough.

Additionally, players experience ~1 second latency per action due to: serverless cold starts, cross-internet WebSocket notifications that block the response, sequential DB queries, and HTTP-per-query overhead from the Neon serverless driver.

**Goal:** Move everything to the existing Hetzner server (~€5/mo flat) — eliminating Netlify entirely, cutting latency to ~100-200ms per action, and simplifying the stack to a single Docker Compose deployment.

## Architecture After Migration

```
Browser (React SPA)
    ├── HTTPS REST  ─┐
    │                ├── Caddy (TLS + static files) ──→ Backend (Docker, port 3000)
    └── WebSocket   ─┘                                   ├── Hono REST API
                                                          ├── Socket.io (embedded)
                                                          └── Cleanup scheduler
                                                          
Postgres 16 (Docker) ← Backend queries over Docker network (~1ms)
```

Three containers total: **Caddy** (reverse proxy + static SPA), **Backend** (API + WebSocket + scheduler), **Postgres**. Everything on one box.

---

## Phase 1: Swap Neon driver for standard `pg`

**File: `netlify/functions/_shared/db.ts`**

Replace `@neondatabase/serverless` with the standard `pg` package. The query builder (`db.from().select().eq()...`) and raw `query()` function only use `pool.query(text, params)` which is identical in both libraries.

Changes:
- Line 19: `import { Pool, neonConfig, types } from '@neondatabase/serverless'` → `import pg from 'pg'; const { Pool, types } = pg;`
- Remove lines 21-26 (the `neonConfig.poolQueryViaFetch = true` and its comment)
- Lines 35-38: Remove `NETLIFY_DATABASE_URL` / `NETLIFY_DATABASE_URL_UNPOOLED` fallbacks — only use `DATABASE_URL`
- Line 49: Add pool config: `new Pool({ connectionString, max: 20, idleTimeoutMillis: 30000 })`

**No changes to any handler file.** Every `db.from(...)` and `query(...)` call works identically.

## Phase 2: Create the unified backend server

**New file: `server/server.ts`**

A single Node process that does everything:

1. **REST API** — imports each existing Netlify Function handler and registers it at its route using Hono. The handlers already use the standard `Request → Response` Web API, so the adapter is trivial:
   ```ts
   function netlifyHandler(handler: (req: Request) => Promise<Response>) {
     return async (c) => handler(c.req.raw);
   }
   app.all('/api/auth/anonymous', netlifyHandler(authAnonymous));
   // ... etc for each function
   ```

2. **WebSocket (Socket.io)** — embeds the relay logic currently in `ws-server/server.js` directly into the same HTTP server. The Socket.io `Server` attaches to the same `http.createServer` that Hono uses. This is ~15 lines of code (join_room, leave_room handlers).

3. **In-process notifications** — replaces the HTTP-based `notifyWsServer()` with a direct in-process call. Instead of POSTing to a separate service, the function simply calls `io.to(roomId).emit(event, payload)`. This eliminates the `WS_SERVER_URL` and `WS_INTERNAL_SECRET` env vars entirely.

4. **Cleanup scheduler** — runs the `cleanup-rooms` handler on `setInterval` every 5 minutes.

Routes (matching current `netlify.toml` redirects):
- `/api/auth/anonymous` → `auth-anonymous.ts`
- `/api/auth/signup` → `auth-signup.ts`
- `/api/auth/login` → `auth-login.ts`
- `/api/game-action` → `game-action.ts`
- `/api/rooms` → `rooms.ts`
- `/api/account` → `account.ts`
- `/health` → uptime/status check

**New file: `server/package.json`** — deps: `hono`, `@hono/node-server`, `pg`, `jose`, `bcryptjs`, `socket.io`, `express` (Socket.io needs it for the internal notify middleware)

**New file: `server/tsconfig.json`** — compiles both `server/` and `netlify/functions/` in one pass (rootDir: `..`)

**New file: `server/Dockerfile`** — multi-stage: build TS in stage 1, run with Node 20 Alpine in stage 2

## Phase 3: Replace WebSocket notification mechanism

**File: `netlify/functions/_shared/ws.ts`**

Currently this file does an HTTP POST to a separate relay server. Replace with an in-process broadcast:

```ts
import type { Server as SocketServer } from 'socket.io';

let io: SocketServer | null = null;

export function setSocketServer(server: SocketServer) {
  io = server;
}

export async function notifyWsServer(
  roomId: string,
  event: RoomEvent,
  payload: unknown = null,
): Promise<void> {
  if (!io) {
    console.warn('Socket.io server not initialized; skipping notify');
    return;
  }
  io.to(roomId).emit(event, payload ?? null);
}
```

The `server.ts` entry point calls `setSocketServer(io)` after creating the Socket.io instance. All existing `notifyWsServer()` calls in `game-action.ts` and `rooms.ts` continue to work unchanged — they just become instant in-process calls instead of HTTP round-trips.

## Phase 4: Apply latency fixes

These are applied while migrating, since we're already touching the relevant files.

### 4a. Fire-and-forget notifications

**File: `netlify/functions/game-action.ts` line 1856**
```
- await notifyForAction(action, roomId);
+ notifyForAction(action, roomId).catch(err => console.error('notify error:', err));
```

**File: `netlify/functions/rooms.ts`** — same change for all `await notifyWsServer(...)` calls (~6 of them). Drop the `await`, add `.catch()`.

With the in-process Socket.io emit these are already near-instant, but dropping the `await` still ensures the response is never delayed by notification logic.

### 4b. Parallelize initial queries in game-action.ts

**File: `netlify/functions/game-action.ts` lines 125-153**

Currently three sequential queries. After the player query succeeds (needed for auth check), fire the next two in parallel:

```ts
const { data: playerData, error: playerError } = await playerQuery.single();
// ... existing error check stays here ...

const [stateResult, playersResult] = await Promise.all([
  adminClient.from('game_states').select('*').eq('room_id', roomId).single(),
  adminClient.from('game_players').select('*').eq('room_id', roomId).order('player_index'),
]);
const { data: gameState, error: stateError } = stateResult;
const { data: allPlayers, error: playersError } = playersResult;
```

Note: the player query must run first because its failure returns a 403. The other two can be parallelized.

## Phase 5: Production Docker Compose

**File: `docker-compose.yml`** (replace the existing dev-only compose)

Two services + Caddy:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: acquire-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: acquire
      POSTGRES_USER: acquire
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U acquire"]
      interval: 10s
    networks: [internal]

  backend:
    build: { context: ., dockerfile: server/Dockerfile }
    container_name: acquire-backend
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://acquire:${POSTGRES_PASSWORD}@postgres:5432/acquire
      JWT_SECRET: ${JWT_SECRET}
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS}
    depends_on:
      postgres: { condition: service_healthy }
    networks: [internal, caddy]

  caddy:
    image: caddy:2-alpine
    container_name: acquire-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./dist:/srv/hotelgame:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [backend]
    networks: [caddy]

networks:
  internal:
  caddy:

volumes:
  postgres_data:
  caddy_data:
  caddy_config:
```

Note: no `WS_SERVER_URL` or `WS_INTERNAL_SECRET` env vars — WebSocket notifications are in-process now.

Save the existing dev compose as `docker-compose.dev.yml` so local development still works.

## Phase 6: Caddyfile

**New file: `Caddyfile`**

```
hotelgame.jonashapp.com {
    # WebSocket + API both go to the same backend
    handle /socket.io/* {
        reverse_proxy acquire-backend:3000
    }
    handle /api/* {
        reverse_proxy acquire-backend:3000
    }
    handle /health {
        reverse_proxy acquire-backend:3000
    }

    # Frontend SPA — static files with fallback to index.html
    handle {
        root * /srv/hotelgame
        try_files {path} /index.html
        file_server
    }

    # Security headers (replaces netlify.toml headers)
    header {
        X-Frame-Options DENY
        X-Content-Type-Options nosniff
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        Referrer-Policy strict-origin-when-cross-origin
    }
}
```

Caddy auto-provisions TLS via Let's Encrypt. This replaces all the security headers and redirects from `netlify.toml`.

## Phase 7: Frontend build config

**File: `netlify/functions/_shared/cors.ts` line 6** — update `DEFAULT_ORIGINS` to include `https://hotelgame.jonashapp.com`

**Build-time env var**: `VITE_WS_URL=wss://hotelgame.jonashapp.com` — WebSocket now goes through Caddy on the same domain (no separate `server.jonashapp.com` subdomain needed).

The frontend API client (`src/integrations/api/client.ts`) already uses relative URLs (`/api/rooms` etc.), so no API URL changes needed.

## Phase 8: Environment template + deploy script

**New file: `.env.production`** — template with all required vars:
```
POSTGRES_PASSWORD=<generate>
JWT_SECRET=<generate>
ALLOWED_ORIGINS=https://hotelgame.jonashapp.com,http://localhost:5173
```

Only 3 env vars now (was 5 before — `WS_SERVER_URL` and `WS_INTERNAL_SECRET` are gone).

**New file: `deploy.sh`** — simple pull + build frontend + restart containers script

## Phase 9: DNS cutover

`hotelgame.jonashapp.com` currently points to Netlify. After the Hetzner stack is up and smoke-tested:

1. Update the DNS A record for `hotelgame.jonashapp.com` → Hetzner server IP
2. Caddy will auto-provision a Let's Encrypt TLS certificate once DNS resolves
3. Keep the old `server.jonashapp.com` record temporarily (existing WebSocket relay still runs until cutover is confirmed)
4. After stable, the separate subdomain is no longer needed — everything goes through the main domain

## Phase 10: Fix bot stuck during mergers

Bots can permanently freeze during merger phases. The root cause: if a bot's action is rejected by the engine (status !== 200), `driveBots()` exits immediately with no retry. The client-side `bot_tick` watchdog re-invokes `driveBots()` every 1.5 seconds, but it just hits the same error and exits again — infinite loop of failures.

**Specific bugs identified:**

1. **`merger_pay_bonuses` turn-check mismatch** — The action checks `gameState.current_player_index === myPlayerIndex` (line 843), but during a merger the acting player may not match this index. Bot gets 403, exits, stuck.

2. **Stale `merger.currentPlayerIndex`** — In `pay_merger_bonuses` (around line 979), if no player has shares in the defunct chain, the loop completes without setting `newMerger.currentPlayerIndex`. It retains a stale value pointing to a bot that doesn't have stock, causing `merger_stock_choice` to fail validation.

**Fix approach — add bot retry with fallback:**

**File: `netlify/functions/game-action.ts`** in `driveBots()` (~line 1909-1918):

When a bot move is rejected:
1. Log the failure with phase + action details
2. If the failed phase is merger-related (`merger_pay_bonuses`, `merger_handle_stock`, `merger_choose_survivor`), attempt a safe fallback action (e.g., keep all shares, pick the largest chain)
3. If the fallback also fails, force-advance the merger state to the next player or phase to prevent permanent freezes
4. Add a per-bot retry counter (max 3) within a single `driveBots()` invocation to prevent infinite loops

**File: `netlify/functions/_shared/bot.ts`** in `decideBotMove()`:

Add explicit handling for edge cases where the bot has 0 shares in the defunct chain during `merger_handle_stock` — should return `{ action: 'merger_stock_choice', payload: { sell: 0, trade: 0, keep: 0 } }` to advance the merger.

## Phase 11: Finalize turquoise theme

The codebase already has a preview theme system with 4 alternatives to the old blue. The turquoise theme is the chosen one.

**File: `src/index.css`**
- Replace the `:root` CSS variables (lines 8-86) with the values from `.theme-turquoise` (lines 103-131)
- Delete all 4 preview theme class blocks (`.theme-turquoise`, `.theme-emerald`, `.theme-teal-gold`, `.theme-jade` — lines 93-224)

**File: `src/lib/themePreview.ts`** — delete entirely (no longer needed)

**File: `src/main.tsx`** — remove the theme preview initialization (lines 4-8, the `applyTheme`/`getStoredThemeId` imports and calls)

**File: `src/components/SiteFooter.tsx`** — remove the theme switcher UI (the "Theme" button and its dropdown around lines 106-110, 227-260)

The turquoise values become the permanent `:root` defaults. No theme switching, no localStorage key, no preview system.

## Phase 12: Improve merger stock choice UI

The current sell/trade/keep sliders are hard to use — it's difficult to pick exact share counts, especially for trading. The user also can't see the resulting share values after trading.

**File: `src/components/game/MergerStockDecision.tsx`**

Changes:
1. **Add tick marks to sliders** — render visible tick marks at each whole number position below the slider track. Each tick is clickable to jump to that value. The trade slider already has step=2; show ticks at every even number.

2. **Show numeric value labels** — display the current value prominently next to each slider (large number, not just in the summary text). Add min/max labels at slider endpoints.

3. **Show post-trade share portfolio** — after the summary panel, add a "Your shares after this decision" section showing:
   - Cash gained from selling: `+$X`
   - New share count in surviving chain: `current + received = total`
   - Shares kept in defunct chain (if any, for end-game scoring)
   - The dollar value of the surviving chain shares received (using `getStockPrice()` for the surviving chain)

4. **Keep the quick-action buttons** (Sell All / Trade All / Keep All) — they work well.

## Phase 13: DNS strategy — A record via all-inkl, keep Netlify as backup

**Important DNS note:** A CNAME record cannot point to an IP address — only to another hostname. Since we're pointing to the Hetzner server's IP, use an **A record** instead.

**Strategy:**
1. In all-inkl DNS settings: change the A record for `hotelgame.jonashapp.com` to point to the Hetzner server IP
2. **Keep the Netlify site running** — don't delete it. It remains accessible at its original `*.netlify.app` URL (e.g., `acquiregame.netlify.app`)
3. This works as a backup: if Hetzner goes down, temporarily switch the A record back to Netlify's load balancer IP (or re-add the Netlify CNAME) to restore service
4. The Netlify site will stop receiving traffic once DNS switches, so it won't consume credits — but it stays deployable as a safety net
5. Update `ALLOWED_ORIGINS` on both Hetzner and Netlify to include both domains during the transition

**Note:** The Netlify backup will lag behind in features (it won't have the bot fixes, theme change, or merger UI improvements unless you also deploy there), but it provides a working fallback for the core game if the Hetzner server has issues.

## Phase 14: Remove Lovable branding

All Lovable affiliate references need to be replaced with proper game branding.

**File: `index.html`** — replace all meta tags:
- Line 11: description → proper game description (e.g., "Acquire — a classic hotel chain board game, playable online with friends")
- Line 12: author → `Jonas Happ` (or remove)
- Line 18: `og:image` → replace Lovable URL with a custom social preview image (create one or use a screenshot of the game board). Host the image in `public/` so it deploys with the SPA.
- Line 21: `twitter:site` → remove or set to your own handle
- Line 22: `twitter:image` → same custom image as og:image
- Lines 25-26: `og:description` / `twitter:description` → same proper game description

**File: `vite.config.ts`** — line 5: remove `import { componentTagger } from "lovable-tagger"` and remove it from the plugins array (line in `plugins: [react(), mode === "development" && componentTagger()]`)

**File: `package.json`** — remove `lovable-tagger` from devDependencies. Also rename the package `name` from `"vite_react_shadcn_ts"` to something like `"acquire-game"`.

**File: `src/components/SiteFooter.tsx`** — line 61: remove or replace the `{ role: 'UI design', by: 'Lovable' }` credit entry

**File: `netlify.toml`** (kept for reference/backup) — line 75: remove `https://lovable.dev` from `img-src` in the CSP header

**New file: `public/og-image.png`** — create a social preview image for the game (1200x630px recommended for Open Graph). Can be a screenshot of the game board with the title overlaid, or a simple branded graphic.

## Phase 15: Database backup cron

Add to server crontab:
```
0 3 * * * docker exec acquire-db pg_dump -U acquire acquire | gzip > /home/deploy/backups/acquire_$(date +\%Y\%m\%d).sql.gz
0 4 * * * find /home/deploy/backups -name "acquire_*.sql.gz" -mtime +14 -delete
```

---

## Files Modified (existing)

| File | Change |
|------|--------|
| `netlify/functions/_shared/db.ts` | Swap `@neondatabase/serverless` → `pg`, add pool config |
| `netlify/functions/_shared/ws.ts` | Replace HTTP POST with in-process `io.to(roomId).emit()` |
| `netlify/functions/_shared/cors.ts` | Add `hotelgame.jonashapp.com` to `DEFAULT_ORIGINS` |
| `netlify/functions/_shared/bot.ts` | Handle 0-share edge case in `merger_handle_stock` |
| `netlify/functions/game-action.ts` | Fire-and-forget notify, parallelize queries, bot retry with fallback in `driveBots()` |
| `netlify/functions/rooms.ts` | Fire-and-forget all `notifyWsServer` calls |
| `docker-compose.yml` | Replace dev compose with production stack (save old as `docker-compose.dev.yml`) |
| `index.html` | Replace Lovable meta tags/OG images with proper game branding |
| `vite.config.ts` | Remove `lovable-tagger` plugin |
| `package.json` | Remove `lovable-tagger` dep, rename package |
| `src/index.css` | Replace `:root` theme with turquoise values, delete preview theme blocks |
| `src/main.tsx` | Remove theme preview initialization |
| `src/components/SiteFooter.tsx` | Remove theme switcher UI + Lovable credit |
| `src/components/game/MergerStockDecision.tsx` | Add slider tick marks, numeric labels, post-trade share value display |
| `netlify.toml` | Remove `lovable.dev` from CSP img-src (kept as backup reference) |

## Files Created (new)

| File | Purpose |
|------|---------|
| `server/server.ts` | Unified backend: Hono API + Socket.io + cleanup scheduler |
| `server/package.json` | Server dependencies |
| `server/tsconfig.json` | TypeScript config for server + functions |
| `server/Dockerfile` | Multi-stage build for backend |
| `Caddyfile` | TLS + reverse proxy + static file serving |
| `.env.production` | Template for production environment variables |
| `deploy.sh` | Deployment script |
| `docker-compose.dev.yml` | Preserved copy of the old dev compose |
| `public/og-image.png` | Custom social preview image for the game |

## Files Deleted

| File | Reason |
|------|--------|
| `src/lib/themePreview.ts` | Theme preview system no longer needed |

## Verification

1. **Local test**: `docker compose up --build` — verify all 3 containers start healthy
2. **API test**: `curl http://localhost:3000/health` returns `{ status: "ok" }`
3. **DB test**: `curl -X POST http://localhost:3000/api/auth/anonymous` returns a JWT
4. **WebSocket test**: Open browser, create a room, join from 2 tabs, verify real-time updates
5. **Game test**: Play through a full game action (place tile, buy stocks) — verify <200ms response time
6. **Merger test**: Start a game with bots, trigger a merger, verify bots handle stock decisions without freezing. Test with 2+ chains merging simultaneously.
7. **Merger UI test**: During a human merger decision, verify slider tick marks work, values are clickable, and post-trade share values are displayed correctly
8. **Theme test**: Verify the turquoise theme is applied everywhere — no remnants of old blue, no theme switcher visible
9. **Run existing tests**: `npm run test:run` — all should pass
10. **Netlify backup**: After DNS switch, verify `acquiregame.netlify.app` still loads the old version as a fallback

## What This Achieves

| Before | After |
|--------|-------|
| Netlify free (300 credits, hard limit) + €5 Hetzner | ~€5/mo Hetzner only |
| ~1s response times (cold starts + cross-internet notify + HTTP-per-query) | ~100-200ms (persistent pool + in-process notify + parallel queries) |
| Two hosting providers, credit-based billing | Single server, flat monthly cost |
| Separate WebSocket subdomain + relay service | Single backend process, one domain |
| 5 env vars including shared secrets | 3 env vars, no inter-service secrets |
| Bots freeze permanently during mergers | Bot retry + fallback mechanism, handles edge cases |
| Old blue theme with preview switcher | Clean turquoise theme, no preview system |
| Guesswork sliders for merger stock decisions | Precise tick marks + post-trade value display |
| No fallback if server goes down | Netlify stays live as backup at `*.netlify.app` |

## Scope Boundaries

- **Not changing**: core game rules engine or frontend routing
- **Not adding**: CI/CD pipeline (manual `deploy.sh` is fine for a personal project)
- **Not migrating data**: fresh Postgres database, schema auto-applied on first boot
- **Keeping**: `netlify.toml` and Netlify function files in the repo (they still work as the canonical source; the backend server wraps them)
- **Keeping**: Netlify site running as a backup (just won't receive traffic after DNS switch)
- **ws-server/ directory**: left in the repo but no longer deployed separately
