---
name: local-preview-end
description: Stop the local preview stack — Vite, the Hono backend, and the local Postgres cluster. Use when Jonas says "stop the preview", "end local preview", "shut it down", "kill the servers", or is done testing locally.
---

# End local preview

Stops everything `/local-preview` started, in reverse order.

## Run it

```bash
bash .claude/skills/local-preview-end/stop.sh
```

Report what it stopped. Safe to run when nothing is up — it says so rather than
failing.

## What it will and will not kill

It identifies services by what is listening on each port and checks the command
before killing it:

| Port | Stopped only if the process is | Otherwise |
|---|---|---|
| 5173 | a `vite` process | reported and left alone |
| 3000 | `node dist/server/server.js` | reported and left alone |
| 55432 | the preview cluster (`pg_ctl status`) | left alone |

So an unrelated dev server of Jonas's on one of those ports is never killed out
from under him.

## Data is kept

The Postgres cluster at `~/.hotelgame-preview/pgdata` is persistent. Games
recorded in `game_results` are still there on the next `/local-preview`, which
is what makes the dashboard's Live mode accumulate across sessions.

To deliberately start from an empty database — the honest way to see the
dashboard's real cold-start state — the script prints the three commands at the
end. Never offer to wipe it unless Jonas asks.

## Not related to production

This skill touches only local processes. It never stops, restarts or deploys
anything on Hetzner. Production is not affected by anything here.
