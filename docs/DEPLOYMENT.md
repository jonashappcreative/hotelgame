# Deployment Guide — Hetzner

This is the **single source of truth** for how Hotel Game is deployed.
Production runs entirely on one Hetzner server. There is **no Netlify deploy and
no Supabase** anymore — everything (frontend, API, auth, realtime, database)
lives on Hetzner.

---

## TL;DR — how a deploy happens

You tell Claude something like **"push this to the server"** or
**"merge to main and update on server"**. Claude then:

1. Merges/commits your work and pushes to `main` on GitHub.
2. Runs the deploy on the server for you:

   ```bash
   ssh hetzner "cd ~/aquire02 && ./deploy.sh"
   ```

That one script pulls `main`, rebuilds, and restarts everything. You don't run
anything yourself. See [`deploy.sh`](../deploy.sh) for the exact steps.

> ⚠️ A deploy ships whatever is on **`origin/main`**. Make sure main is the code
> you want live (tests passing, built locally) before asking to deploy.

---

## Architecture (what actually runs)

Everything is Docker containers on the Hetzner box, fronted by Caddy.

```
                        Internet (HTTPS)
                              │
                  ┌───────────▼───────────┐
                  │   Caddy  (host net)    │   TLS + router + static files
                  │   hotelgame.jonashapp  │
                  └───────────┬───────────┘
            static dist/      │ reverse proxy
        ┌─────────────────────┼───────────────────────┐
        │                     │                        │
   /  (SPA files)      /api/*  /socket.io/*  /health   │
   served from               │
   /srv/hotelgame      ┌──────▼───────────────────┐
   (= ./dist mount)    │  backend  (acquire-backend)│  :3000
                       │  Hono + JWT auth +         │
                       │  Socket.io realtime        │
                       └──────────┬─────────────────┘
                                  │ postgresql
                       ┌──────────▼─────────────────┐
                       │  postgres (acquire-db)     │  :5432 (internal only)
                       │  schema from db/schema.sql │
                       └────────────────────────────┘
```

| Container         | Image / build                  | Port             | Role                                                 |
| ----------------- | ------------------------------ | ---------------- | ---------------------------------------------------- |
| `acquire-caddy`   | `caddy:2-alpine`               | host (80/443)    | TLS, routes API/WS to backend, serves `dist/` static |
| `acquire-backend` | built from `server/Dockerfile` | `127.0.0.1:3000` | REST API, JWT auth, **and** Socket.io realtime       |
| `acquire-db`      | `postgres:16-alpine`           | internal `5432`  | Application database                                  |

Defined in [`docker-compose.yml`](../docker-compose.yml) and
[`Caddyfile`](../Caddyfile).

### Where the code comes from

- **Frontend**: `src/` → built by Vite into `dist/`, mounted read-only into Caddy.
- **Backend**: `server/server.ts` is a thin Hono + Socket.io host that imports its
  route handlers from `netlify/functions/` (`auth-*`, `rooms`, `game-action`,
  `account`, `cleanup-rooms`). **"netlify" here is just a directory name** — that
  code is compiled into the Hetzner backend container. We do not deploy to
  Netlify and there is no Supabase.

### Legacy / not part of deploys

- **`ws-server/` (port 3001)** is a standalone Socket.io relay from the old
  two-tier design. The unified backend now serves realtime on `:3000`, and Caddy
  routes `/socket.io/*` there. The standalone relay is **not** in
  `docker-compose.yml` and `deploy.sh` never touches it.

---

## Server layout

| Path                   | What it is                                              |
| ---------------------- | ------------------------------------------------------- |
| `~/aquire02`           | The deployed checkout (a git clone of `origin/main`).   |
| `~/aquire02/.env`      | **Real production secrets.** Gitignored — never in git. |
| `~/aquire02/dist`      | Built frontend, served by Caddy.                        |
| `~/aquire02/deploy.sh` | The deploy script.                                      |

SSH access is configured as the `hetzner` host (`ssh hetzner`).

### Secrets (`~/aquire02/.env`)

These live **only** on the server and are never committed:

```
POSTGRES_PASSWORD=...
JWT_SECRET=...
ALLOWED_ORIGINS=https://hotelgame.jonashapp.com,http://localhost:5173
```

`.env.production` in the repo is a **template with placeholders only** — copy it
to `.env` and fill in real values when provisioning a new server.
`git reset --hard` during deploy preserves `.env` (it's gitignored).

---

## First-time server setup (already done — for reference / rebuilds)

If the server checkout is ever lost or you provision a fresh box:

```bash
# 1. Clone into place
cd ~ && git clone https://github.com/jonashappcreative/hotelgame.git aquire02
cd ~/aquire02

# 2. Create the real secrets file
cp .env.production .env
nano .env   # fill in POSTGRES_PASSWORD, JWT_SECRET, ALLOWED_ORIGINS
            # generate secrets with: openssl rand -base64 48

# 3. First boot (also initialises the DB from db/schema.sql)
npm ci --ignore-scripts
VITE_WS_URL=wss://hotelgame.jonashapp.com npm run build
docker compose up -d --build

# 4. Subsequent deploys are just:
./deploy.sh
```

---

## Database changes

`db/schema.sql` is applied **only when the Postgres volume is first created**
(via `docker-entrypoint-initdb.d`). It is **not** re-run on deploy.

To change the live schema you must run a migration by hand, e.g.:

```bash
# Apply an ad-hoc SQL change to the running DB:
ssh hetzner "docker exec -i acquire-db psql -U acquire -d acquire" < migration.sql
```

Never `docker compose down -v` in production — the `-v` flag deletes the
`postgres_data` volume and wipes all games/accounts.

---

## Verifying a deploy

```bash
# Health endpoint (proxied to the backend):
curl -fsS https://hotelgame.jonashapp.com/health

# Container status + recent backend logs:
ssh hetzner "cd ~/aquire02 && docker compose ps && docker compose logs --tail=30 backend"
```

Then smoke-test in the browser at https://hotelgame.jonashapp.com:
- Create a room, join from a second tab → realtime sync works.
- Place/discard a tile → API + DB writes work.

---

## Troubleshooting

**Frontend changes not showing up**
Caddy serves the live `./dist` mount, so new builds appear immediately. Hard-refresh
the browser (cache). If still stale, confirm the build step succeeded in the deploy log.

**Backend won't start after deploy**
Check logs: `ssh hetzner "cd ~/aquire02 && docker compose logs --tail=50 backend"`.
Common causes: a missing/renamed env var in `.env`, or a TypeScript build error in
`server/` or `netlify/functions/` (the image build will have failed — re-run the deploy
and read the build output).

**Caddyfile change didn't apply**
`deploy.sh` reloads Caddy automatically. To force it:
`ssh hetzner "cd ~/aquire02 && docker compose restart caddy"`.

**TLS / cert issues**
Caddy manages certificates automatically. Check `docker compose logs caddy` for ACME
errors (usually DNS or rate-limit related).

**Out of disk from old images**
`deploy.sh` runs `docker image prune -f`. For a deeper clean:
`ssh hetzner "docker system prune -af"` (does not remove named volumes).

---

## Quick reference

```bash
# Local development (see docs for the two-terminal setup)
npm run dev

# Production build (test locally before deploying)
VITE_WS_URL=wss://hotelgame.jonashapp.com npm run build && npm run preview

# Deploy (Claude does this for you on "push to the server")
ssh hetzner "cd ~/aquire02 && ./deploy.sh"

# Logs / status
ssh hetzner "cd ~/aquire02 && docker compose ps"
ssh hetzner "cd ~/aquire02 && docker compose logs -f backend"
```

---

**Last updated**: June 2026 — Hetzner-only architecture (post Netlify/Supabase migration).
