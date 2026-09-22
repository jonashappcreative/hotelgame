# Claude Code Project Instructions

## Project Context
- This is an online multiplayer board game (Hotel Game)
- **Everything runs on one Hetzner server.** There is no Netlify deploy and no
  Supabase anymore. The backend lives entirely under `server/`: `server.ts` is
  the entrypoint, `server/api/` holds one handler per endpoint, and `server/lib/`
  holds the shared modules (db, auth, rules, bot, CORS, errors, Socket.IO).
- Backend stack (all on Hetzner, managed by Coolify):
  - API + Auth: Hono server (`server/server.ts`), custom JWT signed/verified with `jose`
  - Realtime: Socket.io served by that same backend on `:3000`
  - Frontend: the same container serves the static `dist/`
  - DB: Coolify-managed Postgres, container `a8ws9g5d9w9j1rhz2lfx73k2`
  - TLS + routing: Coolify's Traefik proxy
- Built with React, TypeScript, Vite, and Tailwind CSS

## Deploying to the server
- **The full deploy process is documented in [`infrastructure/DEPLOYMENT.md`](./infrastructure/DEPLOYMENT.md).** Read it before deploying.
- A deploy **is** a merge into `main`: GitHub Actions (`deploy.yml`) calls the
  Coolify webhook, Coolify rebuilds from `server/Dockerfile`, and the workflow
  health-checks and tags. Coolify's own Git auto-deploy is off on purpose.
- When Jonas says **"push this to the server"**, **"deploy"**, or similar, that
  means promoting to `main` via `/release` (see below), then verifying:
  `curl -fsS https://hotelgame.jonashapp.com/health` and `gh run list --workflow=deploy.yml`.
- **DB migrations are manual and must run before the merge into `main`:**
  `ssh hetzner "docker exec -i a8ws9g5d9w9j1rhz2lfx73k2 psql -v ON_ERROR_STOP=1 -U postgres -d postgres" < db/migrations/<file>.sql`
- `deploy.sh`, `docker-compose.yml`, `Caddyfile` and `/root/aquire02` on the server
  are the retired pre-Coolify stack. Never deploy with them; `acquire-db` no longer exists.

## Branching and releases
- **Full process: [`docs/CI_CD.md`](./CI_CD.md).** Read it before promoting anything.
- The flow is `feature/* → staging → main`. A push to `main` auto-deploys
  to production, so `main` is only ever reached by merging an approved PR from
  `staging`, once staging has been tested locally.
- `staging` is the single pre-production branch: features integrate there and it
  is what gets promoted. Use a PR into it for anything substantive; a typo or a
  doc tweak can be pushed straight to it. `main` and `staging` both refuse direct
  pushes via ruleset, so a release commit needs its own `release/vX.Y.Z` branch.
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
