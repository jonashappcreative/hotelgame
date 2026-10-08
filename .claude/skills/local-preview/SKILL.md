---
name: local-preview
description: Start the full local preview stack — Postgres, the Hono backend, and Vite — so Jonas can play the game and see the dashboard on localhost. Idempotent; reuses anything already running. Use when he says "local preview", "start the local stack", "let me try it locally", "run it on localhost", or "spin it up".
---

# Local preview

Brings up everything needed to play a real game against bots on this machine,
with a real database, without touching production.

**The one rule: this stack never reaches production.** The database is a
loopback-only Postgres on port 55432, and the frontend runs with
`--mode preview` so `.env.preview.local` overrides `.env`. That override is
not cosmetic — `.env` sets `VITE_WS_URL=wss://server.jonashapp.com`, so a plain
`npm run dev` opens the browser's realtime connection against the **production**
relay. Always start the frontend through this skill, never with `npm run dev`.

## Run it

```bash
bash .claude/skills/local-preview/start.sh
```

That is the whole skill. Report its output to Jonas, then hand him the URLs.

To check what is up without starting anything:

```bash
bash .claude/skills/local-preview/start.sh status
```

## What it does, in order

Each step checks before it acts, so running twice reuses what is up instead of
starting a second copy — two Vite instances fighting over 5173, or a second
backend silently failing to bind 3000, are the failure modes this prevents.

1. **Postgres** — a dedicated cluster at `~/.hotelgame-preview/pgdata`, listening
   on `127.0.0.1:55432` only. Created on first run. Then `db/schema.sql` is
   applied every time; it is the complete idempotent state and already folds in
   the Epic 14, 15 and 16 migrations, so **a local database never needs those
   migrations run by hand** — that is only true of production.
2. **Backend** — rebuilds `dist/server/` when a source file is newer, then runs
   `node dist/server/server.js` from the repo root, exactly as the container
   does. Env comes from `.env.preview.local`.
3. **Frontend** — `npx vite --host --mode preview`.

## Two local-only fixes it applies inside `dist/`

Both exist because the Docker runtime stage copies `server/package.json` to
`/app/package.json`, which is not true on this machine. `dist/` is gitignored
build output, so nothing tracked is modified.

- `dist/package.json` with `{"type":"commonjs"}` — the backend compiles to
  CommonJS, but the repo root declares `"type": "module"`, so Node would read
  `dist/server/*.js` as ESM and die on the first `exports`.
- `dist/node_modules` symlinked to `server/node_modules` — the backend's
  dependencies are not on the module resolution path from `dist/server/`.

If either goes missing (a `npm run build` empties `dist/`), just run the skill
again; it restores both.

## Playing a game

Single browser, bots only — no second device and no second tab needed:

**Online Multiplayer → Create Room → set the rules → Add Bot ×2 → Ready.**

Custom rules work end to end: they are validated server-side on create and
stored as the game's `rules_snapshot`. The host can sit anywhere in the turn
order and can edit rules until the game starts.

Finishing a game writes a row to `game_results`, which is what makes
`/dashboard` in **Live** mode show anything. Until a game finishes, Live shows
its empty state — that is correct, not a bug. **Sample** mode is always
populated and needs no backend at all.

## If something is wrong

- Logs are in `~/.hotelgame-preview/` (`backend.log`, `frontend.log`,
  `postgres.log`).
- "port 5173 not started with --mode preview" — a stray `npm run dev`. Run
  `/local-preview-end`, then start again.
- Backend build failures: run `cd server && npm run build` to see the real
  error. Phantom `TS2688` errors come from `@types/<pkg> 2` duplicate
  directories; delete them.

## Stopping

`/local-preview-end`. Recorded games survive; the cluster is persistent.
