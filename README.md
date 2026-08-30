# Hotel Game

An online multiplayer hotel-chain board game — place tiles, found chains, trade
stocks, trigger mergers, and finish with the greatest fortune. Inspired by the
board game classic *Acquire*.

**Live:** [hotelgame.jonashapp.com](https://hotelgame.jonashapp.com) · **Version:** 1.4.2

Play solo against AI bots, hot-seat on one device, or online with friends in
real time. A [story page](https://hotelgame.jonashapp.com/case-study) walks
through how the game was built, with interactive exhibits for tile placement,
mergers, and the stock market.

---

## Architecture

**Everything runs on a single Hetzner VPS, in Docker.** There is no Netlify
deployment and no Supabase — both were migrated away from in v1.3.0.

```
                     ┌─────────────────────────────────────┐
  Browser ──HTTPS──▶ │ Caddy (host network)                │
                     │  TLS · reverse proxy · static files │
                     └───────────────┬─────────────────────┘
                        /api/*  /socket.io/*  /health
                                     │            everything else
                                     ▼                  │
                     ┌─────────────────────────────┐    │
                     │ backend  (Hono, :3000)      │    ▼
                     │  REST API + JWT auth        │  dist/
                     │  Socket.IO (same process)   │  (Vite build)
                     │  AI bots · rules engine     │
                     └───────────────┬─────────────┘
                                     ▼
                     ┌─────────────────────────────┐
                     │ postgres:16-alpine          │
                     │  db/schema.sql              │
                     └─────────────────────────────┘
```

Realtime runs **in-process**: the API and Socket.IO share one HTTP server, so a
game action emits to subscribed clients directly with no internal network hop.

### Stack

| Layer | What |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui (Radix) |
| Routing / data | React Router, TanStack Query |
| Motion / audio | Framer Motion, Howler.js |
| Backend | Hono on Node 20, `jose` (JWT), `bcryptjs` |
| Realtime | Socket.IO (server + browser client) |
| Database | PostgreSQL 16 |
| Proxy / TLS | Caddy 2 |
| Hosting | Hetzner VPS, Docker Compose, deployed via Coolify |
| Tests | Vitest + Testing Library (202 tests) |

## Repository layout

```
src/                    Frontend
  components/game/        Board, tiles, player cards, merger UI
  components/case-study/  Interactive exhibits for the story page
  components/ui/          shadcn/ui primitives
  pages/                  / · /online · /auth · /history · /tutorial · /case-study
  contexts/               Auth and audio providers
  hooks/                  useGameState (local) · useOnlineGame (multiplayer)
  utils/                  gameLogic (rules engine) · multiplayerService
  data/versionHistory.ts  Changelog rendered in the footer and story page

server/                 Backend — one process, entered at server.ts
  server.ts               Mounts the routes, attaches Socket.IO, serves dist/,
                          runs the idle-room cleanup timer
  api/                    Route handlers, one file per endpoint. Plain
                          (Request) => Response functions, no framework types
  lib/                    db · auth · rules engine · AI bot · CORS · errors ·
                          Socket.IO bridge

db/schema.sql           Database schema (loaded on first container start)
docs/                   Architecture, deployment, CI/CD, audits
```

Handlers are ordinary `(Request) => Response` functions rather than Hono
handlers, so they stay portable and are trivial to unit-test — `server.ts` wraps
each one when mounting it.

## Getting started

Requires Node.js 20+ and Docker (for Postgres).

```sh
git clone https://github.com/jonashappcreative/hotelgame.git
cd hotelgame
npm install
```

### Frontend only

The local hot-seat game, tutorial, and story page need no backend:

```sh
npm run dev          # http://localhost:5173
```

### Full stack (online multiplayer)

Online play needs the API, Socket.IO, and a database. Start Postgres and the
backend, then run Vite against them:

```sh
docker compose up -d postgres     # Postgres on :5432, schema auto-loaded
cd server && npm install && npm run build && npm start   # Hono on :3000
npm run dev                       # Vite on :5173, in another terminal
```

Copy `.env.example` to `.env.local` and set `VITE_WS_URL=http://localhost:3000`.
The backend reads `DATABASE_URL`, `JWT_SECRET`, and `ALLOWED_ORIGINS` from the
environment — see `.env.example` for the full list.

Vite proxies `/api/*` and `/socket.io` to `localhost:3000`, mirroring what Caddy
does in production, so the frontend code makes the same calls in both.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server with HMR on :5173 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Vitest in watch mode |
| `npm run test:run` | Run all 202 tests once |
| `npm run test:coverage` | Tests with a coverage report |
| `npm run lint` | ESLint |

## Development workflow

Work flows `feature/* → dev → staging → main`. **A push to `main` auto-deploys to
production**, so `main` is only reached by merging a reviewed PR from `staging`.
`main` and `staging` are protected by GitHub rulesets; direct pushes are refused.

Every PR runs type check, lint, tests, and build — all blocking. PRs into `main`
additionally must update `src/data/versionHistory.ts` and keep the
`package.json` version in step with it. Version tags are created by CI *after* a
deploy passes its health check.

Full process, including how to cut a release: **[docs/CI_CD.md](docs/CI_CD.md)**.

## Deployment

Merging to `main` triggers GitHub Actions → Coolify webhook → rebuild → health
check → tag. Manual deploys run on the server:

```sh
ssh hetzner "cd ~/aquire02 && ./deploy.sh"
curl -fsS https://hotelgame.jonashapp.com/health
```

`deploy.sh` is the single source of truth for deploy steps. Real secrets live in
`~/aquire02/.env` on the host (gitignored — never commit or overwrite it).

See [docs/infrastructure/DEPLOYMENT.md](docs/infrastructure/DEPLOYMENT.md) for
provisioning, backups, and troubleshooting.

## Documentation

| Doc | Covers |
|---|---|
| [docs/CI_CD.md](docs/CI_CD.md) | Branch model, CI gates, release process |
| [docs/infrastructure/ARCHITECTURE.md](docs/infrastructure/ARCHITECTURE.md) | System design |
| [docs/infrastructure/DEPLOYMENT.md](docs/infrastructure/DEPLOYMENT.md) | Deploying and operating the server |
| [docs/infrastructure/INFRA_SETUP.md](docs/infrastructure/INFRA_SETUP.md) | Provisioning from scratch |
| [docs/migration/](docs/migration/) | The Netlify + Supabase → Hetzner migration |
| [docs/security/security_audit.md](docs/security/security_audit.md) | Security review |

## Credits

Built by Jonas Happ. Backend and server work with Claude Code (Anthropic); logo
and favicon by ChatGPT (OpenAI); hosting by Hetzner.

*Acquire* is a trademark of its respective owner. This is a non-commercial,
fan-made project for educational purposes, not affiliated with or endorsed by
the rights holders.
