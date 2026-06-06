# Acquire WebSocket Relay (Hetzner)

A stateless Socket.io relay that fans out room events to connected browsers.
It holds **no game state** and has **no database access** — game state lives in
Netlify DB and is mutated only by Netlify Functions.

```
Browser ── Socket.io ──► ws-server  (join_room / leave_room, receives events)
Netlify Function ── POST /internal/notify ──► ws-server  (broadcast to room)
```

## Events broadcast to clients in a room

| Event | Fired when |
|---|---|
| `game:state_updated` | a game action completed |
| `game:players_changed` | a player joined/left/toggled ready |
| `room:status_changed` | game started or finished |

These are emitted by the relay when a Netlify Function POSTs to
`/internal/notify` after mutating the DB.

## HTTP endpoints

- `POST /internal/notify` — body `{ roomId, event, payload }`, requires header
  `x-internal-secret: $WS_INTERNAL_SECRET`. Called only by Netlify Functions.
- `GET /health` — `{ status: "ok", connections }` for uptime/Docker checks.

## Local run

```bash
cp .env.example .env      # set WS_INTERNAL_SECRET
npm install
npm run dev               # node --watch server.js
```

## Deploy on Hetzner

```bash
# on the Hetzner box, in this directory
cp .env.example .env      # set a strong WS_INTERNAL_SECRET + ALLOWED_ORIGINS
docker compose up -d --build
docker compose logs -f
```

Then point a subdomain (e.g. `ws.acquiregame.jonashapp.com`) at the Hetzner IP
via DNS and terminate TLS in front of the container (Caddy / nginx / Traefik) so
the browser can reach it over `wss://`. The container itself serves plain HTTP
on port 3001.

## Environment variables

| Variable | Purpose |
|---|---|
| `WS_INTERNAL_SECRET` | Shared secret for `/internal/notify` (must match Netlify) |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed to connect |
| `PORT` | Listen port (default 3001) |
