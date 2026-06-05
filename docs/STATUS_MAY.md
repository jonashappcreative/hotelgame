# Project Status Briefing — June 2026

**Goal for next week:** Ship the Supabase → Netlify + Hetzner migration and bring the app back to life permanently.

---

## What Happened Last Time

### Completed Features (via `merge-all-branches`)
All custom room rules stories (0–9) were implemented and merged:
- Story 0: `custom_rules`, `rules_snapshot`, `turn_deadline_epoch` DB columns
- Story 1: `CustomRules` and `DEFAULT_RULES` promoted to shared types
- Story 2: Custom rules wired from lobby through DB to game start
- Story 3: Turn timer with server-enforced auto-end
- Story 4: Dynamic chain safety threshold
- Story 5: Cash visibility rule
- Stories 6–8: Bonus tiers, dynamic board size, chain founding rules
- Story 9: Starting conditions rule

### Security & Compliance
- Full security audit completed and all findings remediated (`fix(security)`)
- Brand/IP audit done (`docs(brand-audit)`) — confirmed no Hasbro trademark exposure
- DB fix applied: missing room settings columns on the remote Supabase instance

### Current Blockers
**The app is on Supabase free tier, which pauses the entire backend after 7 days of inactivity.** The site at `acquiregame.netlify.app` is dead until manually unpaused. This is the core motivation to migrate.

---

## Current Architecture (what exists now)

```
Browser (React SPA on Netlify CDN)
  │
  ├─── Supabase JS SDK ──► Supabase Postgres (auth + DB)
  │                         ↕ Supabase Edge Function (game-action, Deno)
  └─── Supabase Realtime ──► postgres_changes subscriptions
```

**Key files:**
- [src/utils/multiplayerService.ts](src/utils/multiplayerService.ts) — all DB + realtime calls (~650 lines, 100% Supabase SDK)
- [src/contexts/AuthContext.tsx](src/contexts/AuthContext.tsx) — wraps `supabase.auth.*` throughout the React tree
- [supabase/migrations/](supabase/migrations/) — 20+ migration files, fully documented schema
- [supabase/functions/game-action/](supabase/functions/) — Deno edge function handling all game mutations

---

## Target Architecture (what to build)

```
Browser (React SPA on Netlify CDN)
  │
  ├─── REST ──► Netlify Serverless Functions ──► Netlify DB (Neon Postgres)
  │              (game actions, auth, queries)
  └─── WebSocket ──► Hetzner Socket.io Server (Docker)
                      (realtime room events, turn broadcasts)
```

**The full migration plan is at [docs/transition_to_hetzner.md](docs/transition_to_hetzner.md).** Read it before starting — it's detailed and current.

---

## Netlify Research — Can It Replace Supabase?

**Short answer: Yes for DB and Auth. No for WebSockets — Hetzner is still needed.**

### Netlify DB (Neon Postgres) ✅
- **GA as of April 28, 2026** — stable, production-ready
- Built on Neon serverless Postgres (same engine)
- Auto-provisioned, supports branching (deploy previews get isolated DB branches)
- **Plans:** Free tier = 300 credits/month; Pro = $20/month = 3,000 credits
- Storage is free until July 1, 2026, then billed per GB
- No 7-day pause — it's always on

### Netlify Identity (Auth) ✅
- Built on GoTrue (same tech Supabase Auth was built on)
- Supports signup, login, password recovery, JWT-based sessions
- Covers our use case (anonymous + registered accounts)
- Available on all plans, no extra cost

### WebSockets ❌
- Netlify serverless functions are stateless — **no persistent WebSocket connections**
- Netlify officially integrates with Jamsocket as a managed alternative, but it's overkill for our Socket.io approach
- **Hetzner Socket.io server is still required** — no way around this

### Realtime / postgres_changes ❌
- Netlify DB has **no built-in change subscriptions** — it's plain Postgres
- Our replacement: Netlify Functions POST a notification to the Hetzner WS server after every mutation, which fans it out to the room's Socket.io clients. This pattern is already designed in the transition doc.

### Summary Table

| Feature | Supabase | Netlify+Hetzner |
|---|---|---|
| Postgres DB | ✅ | ✅ Netlify DB (Neon) |
| Auth | ✅ GoTrue | ✅ Netlify Identity |
| Realtime subscriptions | ✅ native | ✅ via Hetzner Socket.io |
| WebSockets | ✅ Realtime | ✅ Hetzner Docker |
| Free tier freeze | ❌ 7-day pause | ✅ None |
| Billing predictability | ✅ (free until quota) | ⚠️ credit-based (unpredictable) |

---

## Open TODOs — Migration Phases

All of this is detailed in [docs/transition_to_hetzner.md](docs/transition_to_hetzner.md).

### Phase 1 — Infrastructure
- [ ] Provision Netlify DB (requires Pro or credit plan — needs a paid Netlify plan)
- [ ] Apply schema to Netlify DB (dump from Supabase, replace `auth.users` FK with local `users` table)
- [ ] Set JWT secret as Netlify env var
- [ ] Scaffold Hetzner WS server (`ws-server/server.js` — ~80 lines Socket.io + Express)
- [ ] Dockerfile + docker-compose for WS server
- [ ] Deploy WS server on Hetzner, set DNS subdomain (e.g. `ws.acquiregame.jonashapp.com`)

### Phase 2 — Backend
- [ ] Port `supabase/functions/game-action/index.ts` (Deno) → `netlify/functions/game-action.ts` (Node 20)
  - Replace Supabase client with `@neondatabase/serverless` driver
  - Replace Supabase JWT verify with `jose.jwtVerify(token, JWT_SECRET)`
  - Add `notifyWsServer(roomId, event, payload)` helper — POSTs to Hetzner after mutations
- [ ] Auth endpoints in `netlify/functions/`:
  - `auth-anonymous.ts` — issues short-lived JWT with random UUID
  - `auth-signup.ts` — bcrypt hash, write to `users` table, issue JWT
  - `auth-login.ts` — verify password, issue JWT

### Phase 3 — Frontend
- [ ] Replace `src/integrations/supabase/` with `src/integrations/api/` (thin fetch wrappers)
- [ ] Rewrite `src/utils/multiplayerService.ts`:
  - All `supabase.from(...)` → `fetch('/.netlify/functions/...')`
  - `executeGameAction` → `fetch('/.netlify/functions/game-action', ...)`
  - `subscribeToRoom()` → `socket.io-client` connecting to Hetzner
- [ ] Rewrite `src/contexts/AuthContext.tsx`:
  - `supabase.auth.*` → custom auth endpoints
  - JWT in `localStorage` under `acquire_auth_token`

### Phase 4 — Cutover
- [ ] Full local test: Netlify Dev + local WS server
- [ ] Deploy to production, smoke test
- [ ] Remove `@supabase/supabase-js` from `package.json`
- [ ] Delete `supabase/` directory and `src/integrations/supabase/`
- [ ] Pause/delete Supabase project

---

## Code Cleanup Opportunities

These can be done **after** migration, not before (avoid scope creep now):

### Unused Radix UI components
`package.json` imports ~20 Radix UI packages. Many are likely from the Shadcn scaffold and never used. After migration, audit and remove unused ones to reduce bundle size.

### `debug logging` in `multiplayerService.ts`
Lines [488–494](src/utils/multiplayerService.ts#L488) have `console.log` calls in `dbToGameState` that were added for debugging. Clean these out once the new service layer is stable.

### `updateGameState` stub
[multiplayerService.ts:475](src/utils/multiplayerService.ts#L475) — `updateGameState` is a no-op stub kept for compatibility. Delete it during the migration.

### `IMPLEMENTATION_TODO.md`
Completely empty. Either populate it with the next feature backlog or delete it.

### `docs/NETLIFY_CHECKLIST.md`
Still references Supabase env vars (`VITE_SUPABASE_URL`, etc). Update or replace it once the migration is done.

### `vite.config.ts.timestamp-*` file
Artifact file at repo root — add to `.gitignore`.

---

## Do You Need My Help On?

Here's where you can unblock things:

- **Hetzner setup** — I can write the full `ws-server/server.js`, `Dockerfile`, and `docker-compose.yml` right now, ready to deploy
- **Netlify Functions** — I can port `game-action` from Deno → Node and write the auth endpoints
- **Frontend migration** — I can rewrite `multiplayerService.ts` and `AuthContext.tsx`
- **Schema migration** — I can generate the SQL diff to apply to Netlify DB (with `auth.users` FK replaced)
- **Env var setup** — I can update `docs/NETLIFY_CHECKLIST.md` with the new variable list

Just tell me which phase to start on and I'll go.
