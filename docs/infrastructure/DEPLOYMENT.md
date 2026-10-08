# Deployment Guide — Coolify on Hetzner

This is the **single source of truth** for how Hotel Game is deployed.
Production runs on one Hetzner server, managed by **Coolify** (v4). There is no
Netlify and no Supabase — everything (frontend, API, auth, realtime, database)
lives on that server.

---

## TL;DR — how a deploy happens

A deploy is **a merge into `main`**. Nothing else ships code.

1. A PR from `staging` is merged into `main` (see [`docs/CI_CD.md`](../CI_CD.md)).
2. GitHub Actions ([`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml))
   type-checks and builds, then calls the Coolify deploy webhook
   (`COOLIFY_WEBHOOK_URL` + `COOLIFY_TOKEN` repo secrets).
3. Coolify clones `main`, builds [`server/Dockerfile`](../../server/Dockerfile) and
   swaps in the new container (~2 min).
4. The workflow waits, polls `/health`, and on success tags the release `vX.Y.Z`.

Coolify's own Git-webhook **Auto Deploy is off on purpose** — the Actions workflow
is the only trigger, so a deploy never skips the build check.

> ⚠️ **Database migrations are not part of a deploy.** Anything under
> `db/migrations/` must be run by hand *before* the PR into `main` is merged — see
> [Database changes](#database-changes).

To redeploy the current `main` without a new merge: Coolify UI → *Hotel Game* →
*production* → *hotelgame* → **Redeploy**.

---

## Architecture (what actually runs)

```
                        Internet (HTTPS)
                              │
                  ┌───────────▼────────────┐
                  │  coolify-proxy (Traefik)│   TLS + routing
                  │  hotelgame.jonashapp.com│
                  └───────────┬────────────┘
                              │ :3000
                  ┌───────────▼────────────────────┐
                  │  hotelgame app container        │
                  │  node dist/server/server.js     │
                  │  Hono API + JWT auth +          │
                  │  Socket.io + static SPA (dist/) │
                  └───────────┬────────────────────┘
                              │ DATABASE_URL (internal network)
                  ┌───────────▼────────────────────┐
                  │  Coolify Postgres               │
                  │  a8ws9g5d9w9j1rhz2lfx73k2       │
                  │  postgres:18-alpine, internal   │
                  └────────────────────────────────┘
```

| Coolify resource | Container name                     | Role                                              |
| ---------------- | ---------------------------------- | ------------------------------------------------- |
| App `hotelgame`  | `ggyjpofavzhle9ub5agci6dy-<build>` | API, auth, realtime **and** the static frontend  |
| Database         | `a8ws9g5d9w9j1rhz2lfx73k2`         | Application database (user `postgres`, DB `postgres`) |
| Proxy            | `coolify-proxy`                    | Traefik: TLS certificates, routes the domain to :3000 |

The app container's name changes with every build; the database's does not.

### Where the code comes from

One image, built by Coolify from `server/Dockerfile` at the repo root:

- **Frontend**: `src/` → `vite build` → `dist/`, served by the backend itself
  (`serveStatic` in `server/server.ts`, falling back to `index.html`).
- **Backend**: `server/` → `tsc` → `dist/server/`. `server.ts` is the entrypoint,
  `server/api/` has one handler per endpoint, `server/lib/` the shared modules.
- `VITE_WS_URL` is baked into the bundle at build time (defaults to
  `wss://hotelgame.jonashapp.com`).

### Secrets and configuration

Set as **environment variables on the Coolify app** (Configuration → Environment
Variables), never in git: `DATABASE_URL` (internal Postgres URL),
`JWT_SECRET`, `ALLOWED_ORIGINS`, `WS_INTERNAL_SECRET`.

The database runs **without SSL** (Coolify's certificate had a key-permission bug)
and has **public access disabled** — it is reachable only from the Coolify network
and from the host via `docker exec`.

---

## Database changes

`db/schema.sql` is the full schema, but **nothing applies it to production** —
not a deploy, not a container restart. The production database was loaded from it
once by hand (June 2026). Every later schema change ships as an idempotent file
under `db/migrations/` and must be run by hand, **before** the code that needs it
reaches `main`:

```bash
ssh hetzner "docker exec -i a8ws9g5d9w9j1rhz2lfx73k2 psql -v ON_ERROR_STOP=1 -U postgres -d postgres" \
  < db/migrations/<file>.sql
```

Run migrations in the order their headers require (usually date order). Check
what is already applied before and after, e.g.:

```bash
ssh hetzner "docker exec a8ws9g5d9w9j1rhz2lfx73k2 psql -U postgres -d postgres -c '\d game_states'"
```

If a change touches a column the browser reads, the migration must also recreate
the `game_states_public` / `game_players_public` view, or the client sees the
field as `undefined`.

Never delete the `postgres-data-a8ws9g5d9w9j1rhz2lfx73k2` volume — it holds every
game and account.

---

## Verifying a deploy

```bash
curl -fsS https://hotelgame.jonashapp.com/health     # → {"status":"ok"}
gh run list --workflow=deploy.yml --limit 3          # did the pipeline pass?
```

The Coolify UI shows each deployment with its commit, duration and build log
(*hotelgame* → **Deployments**), and live container output under **Logs**.

Then smoke-test at https://hotelgame.jonashapp.com: create a room, join from a
second tab, place a tile.

---

## Troubleshooting

**Deploy workflow failed at "Trigger Coolify deploy"** — the webhook returned
non-2xx. Check that the `COOLIFY_WEBHOOK_URL` / `COOLIFY_TOKEN` secrets are still
valid (a regenerated Coolify API token invalidates the old one).

**Health check never passes** — open the deployment's build log in Coolify. Usual
causes: a TypeScript error in `server/` or `src/`, or a missing env var on the app.

**Backend errors about a missing column or relation** — a migration wasn't run.
See [Database changes](#database-changes).

**TLS / certificate issues** — handled by Traefik (`coolify-proxy`); check its logs:
`ssh hetzner "docker logs --tail=50 coolify-proxy"`.

---

## Legacy — not part of production

These still exist but nothing uses them. Don't deploy with them.

- **`deploy.sh`, `docker-compose.yml`, `Caddyfile`** in the repo, and the server
  checkout at `/root/aquire02` (with its `.env`): the pre-Coolify Docker Compose
  stack (`acquire-caddy`, `acquire-backend`, `acquire-db`). None of its containers
  run. A `docker exec acquire-db …` command fails with "No such container".
- **`acquire-ws` container** (`/opt/acquire-ws`, `ws-server/`): the old standalone
  Socket.io relay. Still running, unused — realtime is served by the app on :3000.

## Known gaps

- **No automated database backup.** Root has no crontab; whether a Coolify
  scheduled backup is configured for the database has not been checked.

---

**Last updated**: September 2026 — Coolify on Hetzner.
