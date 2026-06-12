#!/usr/bin/env bash
# =============================================================================
# deploy.sh — the single source of truth for deploying Hotel Game to Hetzner.
# =============================================================================
# Run ON the Hetzner server, from the repo root:   ~/aquire02/deploy.sh
# (Claude runs it for you via:  ssh hetzner "cd ~/aquire02 && ./deploy.sh")
#
# What it does, in order:
#   1. Fast-forwards the server checkout to the latest origin/main.
#   2. Installs frontend deps and builds the static site into ./dist.
#   3. Rebuilds the backend image and (re)starts postgres + backend + caddy.
#   4. Reloads Caddy so any Caddyfile changes take effect with no downtime.
#
# What it deliberately does NOT touch:
#   - ./.env            — real secrets, gitignored, lives only on the server.
#   - postgres data     — the named docker volume is never recreated here.
#   - ws-server (:3001) — legacy standalone relay, not part of this compose.
#                         Realtime is served by the backend on :3000.
#
# The whole body runs inside main() so that `git reset` overwriting this file
# mid-run can never corrupt the executing script (bash parses main() upfront).
# =============================================================================
set -euo pipefail

main() {
  cd "$(dirname "$0")"

  echo "==> [1/4] Updating code to latest origin/main..."
  git fetch --quiet origin main
  git reset --hard origin/main

  echo "==> [2/4] Installing frontend deps + building dist/..."
  npm ci --ignore-scripts
  VITE_WS_URL=wss://hotelgame.jonashapp.com npm run build

  echo "==> [3/4] Rebuilding backend image + (re)starting containers..."
  docker compose up -d --build

  echo "==> [4/4] Reloading Caddy (picks up Caddyfile + new dist/)..."
  docker compose exec -w /etc/caddy caddy caddy reload --config Caddyfile \
    || docker compose restart caddy

  echo "==> Pruning dangling images..."
  docker image prune -f >/dev/null 2>&1 || true

  echo "==> Done. Container status:"
  docker compose ps
  echo "==> Recent backend log:"
  docker compose logs --tail=15 backend
}

main "$@"
