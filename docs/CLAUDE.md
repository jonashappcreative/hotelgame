# Claude Code Project Instructions

## Project Context
- This is an online multiplayer board game (Hotel Game)
- **Everything runs on one Hetzner server.** There is no Netlify deploy and no
  Supabase anymore. (The `netlify/functions/` directory is just shared backend
  source code compiled into the Hetzner backend — not a live Netlify service.)
- Backend stack (all on Hetzner, in Docker):
  - API + Auth: Hono server (`server/server.ts`), custom JWT signed/verified with `jose`
  - Realtime: Socket.io served by that same backend on `:3000`
  - DB: self-hosted Postgres (`postgres:16-alpine`) container
  - Caddy: TLS + reverse proxy + serves the static `dist/`
- Built with React, TypeScript, Vite, and Tailwind CSS

## Deploying to the server
- **The full deploy process is documented in [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md).** Read it before deploying.
- When Jonas says **"push this to the server"**, **"merge to main and update on
  server"**, **"deploy"**, or anything similar, do this:
  1. Make sure the intended work is committed and pushed to `origin/main`.
  2. Deploy by running, on his behalf:
     `ssh hetzner "cd ~/aquire02 && ./deploy.sh"`
  3. Verify: `curl -fsS https://hotelgame.jonashapp.com/health` and check
     `docker compose ps` / backend logs.
- The server checkout is `~/aquire02` (a git clone of `origin/main`). Real
  secrets live in `~/aquire02/.env` (gitignored — never overwrite or commit it).
- `deploy.sh` is the single source of truth for deploy steps. Don't invent
  ad-hoc deploy commands — update `deploy.sh` instead.

## Before pushing anything to main
- PLease check if Jonas really wants tu push to main, as this triggers an auto deploy. We prever a structure like:

Main < Staging < Development < Feature Branches

- Only wen staging works and is tested locally, push to main upon request.

- When we push a new version to the Server, usually increase the version history by:
- 0.0.1 for bug fixes
- 0.1.0 for new features
- 1.0.0 for major updates (recommend it to me when you feel like its a thing or wait for my request)


## Testing Requirements

**IMPORTANT:** Always run all tests before committing to main or develop branches.

```bash
# Run all tests
npm run test:run

# Run tests in watch mode during development
npm test
```

### Test Coverage
- `src/utils/gameLogic.test.ts` - Core game mechanics (tile placement, chains, stocks, scoring)
- `src/utils/multiplayerService.test.ts` - Multiplayer integration (auth, rooms, realtime)

All tests must pass before merging any changes. If tests fail, fix the issues before committing.
