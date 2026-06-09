#!/usr/bin/env bash
# deploy.sh — pull latest code, build frontend, restart containers
# Run on the Hetzner server: ./deploy.sh

set -euo pipefail

echo "==> Pulling latest code..."
git pull

echo "==> Installing frontend deps..."
npm ci --ignore-scripts

echo "==> Building frontend..."
VITE_WS_URL=wss://hotelgame.jonashapp.com npm run build

echo "==> Restarting containers..."
docker compose pull caddy postgres 2>/dev/null || true
docker compose up -d --build

echo "==> Done. Backend log:"
docker compose logs --tail=20 backend
