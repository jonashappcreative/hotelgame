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

## Branching and releases
- **Full process: [`docs/CI_CD.md`](./CI_CD.md).** Read it before promoting anything.
- The flow is `feature/* → dev → staging → main`. A push to `main` auto-deploys
  to production, so `main` is only ever reached by merging an approved PR from
  `staging`, once staging has been tested locally.
- **Never push directly to `main`.** A PreToolUse hook
  (`.claude/hooks/block-main-push.sh`) blocks it. That is intentional — don't
  route around it. If Jonas wants a direct push, he removes the hook himself.
- Use the **`/release`** skill to promote a branch. It runs the gates, picks the
  version bump, writes the changelog entry, and opens the right PR.
- Version bumps:
  - 0.0.1 for bug fixes
  - 0.1.0 for new features
  - 1.0.0 for major updates (recommend it to me when you feel like its a thing
    or wait for my request — never pick it yourself)
- The changelog shown on the site lives in `src/data/versionHistory.ts` — the
  single source of truth, re-exported by `SiteFooter.tsx` and rendered on
  `/case-study`. Edit the data file, never the component. CI blocks any PR into
  `main` that doesn't update it, or whose `package.json` version disagrees with
  the newest entry.
- Don't create version tags by hand — `deploy.yml` tags `main` after the deploy
  passes its health check.


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
