# Hetzner Migration Plan

**Target:** Move the entire project (frontend, API, WebSocket server, Postgres) from Netlify + Supabase to a self-hosted Hetzner VPS.  
**Domain:** `acquiregame.jonashapp.com` (A-record at all-inkl pointing to Hetzner IP)

---

## 1. Concepts First

### How multiple projects share one server

A server has one IP address. To host multiple projects on it, you run a **reverse proxy** — a gatekeeper that looks at the domain name in each incoming request and forwards it to the right internal service.

```
Internet
  │
  ▼
Caddy (port 80/443) ← the only thing exposed to the internet
  ├── acquiregame.jonashapp.com  →  acquire-app (port 3000, internal)
  ├── otherwebsite.jonashapp.com →  other-app   (port 4000, internal)
  └── portainer.jonashapp.com   →  portainer    (port 9000, internal)
```

Each project runs in its own **Docker container** on an internal port. Nothing except Caddy is directly reachable from outside. Caddy also handles HTTPS automatically — it fetches a free Let's Encrypt certificate for every domain you configure, with zero extra steps.

### How you manage things without a UI

Servers don't have a desktop, but you have three tools:

1. **SSH** — a terminal session into the server. `ssh root@<hetzner-ip>`. All server management happens here.
2. **Portainer** — a web UI for Docker that you access from your browser. Shows running containers, logs, resource usage, start/stop controls. You deploy it once and access it at `portainer.jonashapp.com`. This is your primary day-to-day interface.
3. **UptimeRobot** (free, external) — pings your site every 5 minutes and emails you if it goes down.

---

## 2. Server Setup

### 2a. Create the server (Hetzner Cloud)
- Go to console.hetzner.cloud → New Project → Add Server
- **Location:** Nuremberg or Falkenstein (Germany, close to you)
- **Image:** Ubuntu 24.04
- **Type:** CX22 — 2 vCPU, 4 GB RAM, 40 GB SSD — **€4.35/month**. Enough for several projects and Postgres.
- **SSH Key:** Add your public key during creation (avoids password login)
- Note the public IP once created

### 2b. Initial server hardening (one-time, ~10 min)

SSH in as root, then run:

```bash
# Update packages
apt update && apt upgrade -y

# Create a non-root user for daily use
adduser deploy
usermod -aG sudo deploy

# Copy your SSH key to the new user
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy

# Basic firewall: allow SSH, HTTP, HTTPS only
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable

# Install Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# Log out and back in as 'deploy' from now on
```

### 2c. Install Caddy (reverse proxy)

Caddy runs as a Docker container alongside your projects. Create the shared infrastructure:

```bash
mkdir -p /home/deploy/caddy /home/deploy/caddy/data /home/deploy/caddy/config
```

Create `/home/deploy/caddy/Caddyfile`:
```
acquiregame.jonashapp.com {
    reverse_proxy acquire-api:3000
}

# Static frontend served directly by Caddy (faster than Node for static files)
# This is a separate block — see section 5 for how the SPA is served

portainer.jonashapp.com {
    reverse_proxy portainer:9000
}
```

Create `/home/deploy/caddy/docker-compose.yml`:
```yaml
services:
  caddy:
    image: caddy:2-alpine
    container_name: caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - ./data:/data
      - ./config:/config
      - /home/deploy/acquire/dist:/srv/acquire  # built frontend files
    networks:
      - caddy

  portainer:
    image: portainer/portainer-ce:latest
    container_name: portainer
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - portainer_data:/data
    networks:
      - caddy

networks:
  caddy:
    name: caddy
    driver: bridge

volumes:
  portainer_data:
```

```bash
cd /home/deploy/caddy && docker compose up -d
```

**From this point, Portainer is live at `portainer.jonashapp.com`** (once DNS is set — see step 3). First login sets the admin password.

---

## 3. DNS at all-inkl

Log into all-inkl → KAS → your domain `jonashapp.com` → DNS settings.

Add these A records (replace `<HETZNER-IP>` with the IP from step 2a):

| Name | Type | Value | TTL |
|---|---|---|---|
| `acquiregame` | A | `<HETZNER-IP>` | 300 |
| `portainer` | A | `<HETZNER-IP>` | 300 |

DNS propagates within a few minutes (TTL 300 = 5 min).  
Caddy detects the domain automatically and fetches SSL certs. No extra config.

**For future projects**, just add another A record pointing to the same IP, add a block to the Caddyfile, and restart Caddy.

---

## 4. Adding a Second Project Later

Structure on server:
```
/home/deploy/
  caddy/               ← shared reverse proxy
  acquire/             ← this project
  other-project/       ← any future project
```

Each project has its own `docker-compose.yml`. Add it to the `caddy` Docker network so Caddy can reach it:

```yaml
# in any project's docker-compose.yml
networks:
  caddy:
    external: true   # join the shared caddy network
```

Then add one block to the Caddyfile and `docker compose restart caddy`. That's it.

---

## 5. Acquire Game — Docker Stack

Create `/home/deploy/acquire/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: acquire-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: acquire
      POSTGRES_USER: acquire
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - internal

  api:
    build: .
    container_name: acquire-api
    restart: unless-stopped
    environment:
      DATABASE_URL: postgresql://acquire:${POSTGRES_PASSWORD}@postgres:5432/acquire
      JWT_SECRET: ${JWT_SECRET}
      WS_INTERNAL_SECRET: ${WS_INTERNAL_SECRET}
      NODE_ENV: production
    depends_on:
      - postgres
    networks:
      - internal
      - caddy           # reachable by Caddy

  ws:
    build:
      context: ./ws-server
    container_name: acquire-ws
    restart: unless-stopped
    environment:
      WS_INTERNAL_SECRET: ${WS_INTERNAL_SECRET}
    networks:
      - internal
      - caddy           # reachable by Caddy for WebSocket upgrades

networks:
  internal:
    driver: bridge
  caddy:
    external: true

volumes:
  postgres_data:
```

Create `/home/deploy/acquire/.env` (never commit this):
```
POSTGRES_PASSWORD=<strong-random-password>
JWT_SECRET=<64-char-random-string>
WS_INTERNAL_SECRET=<32-char-random-string>
```

Update the Caddyfile to also handle WebSocket connections:
```
acquiregame.jonashapp.com {
    # WebSocket connections (Socket.io path)
    handle /socket.io/* {
        reverse_proxy acquire-ws:3001
    }

    # API calls
    handle /api/* {
        reverse_proxy acquire-api:3000
    }

    # Frontend SPA (static files)
    handle {
        root * /srv/acquire
        try_files {path} /index.html
        file_server
    }
}
```

---

## 6. Migration Steps (in order)

### Phase 1 — Infrastructure (on server)
- [ ] Create Hetzner CX22 server
- [ ] Run initial hardening (step 2b)
- [ ] Deploy Caddy + Portainer (step 2c)
- [ ] Add DNS A records at all-inkl (step 3)
- [ ] Verify `portainer.jonashapp.com` is reachable with HTTPS

### Phase 2 — Database
- [ ] Start Postgres container (step 5 compose)
- [ ] Export Supabase schema: `supabase db dump --schema-only > schema.sql`
- [ ] Edit `schema.sql`: remove Supabase-specific extensions, replace `auth.users` FK with a local `users` table
- [ ] Apply to Hetzner Postgres: `psql $DATABASE_URL < schema.sql`
- [ ] Export any real game data if worth keeping: `supabase db dump --data-only > data.sql`

### Phase 3 — Backend Code
- [ ] Port `supabase/functions/game-action/index.ts` (Deno) → `netlify/functions/game-action.ts` (Node 20)
  - Replace Supabase client with `postgres` npm package
  - Replace Supabase JWT verify with `jose.jwtVerify`
  - Add `notifyWsServer(roomId, event, payload)` — HTTP POST to `acquire-ws` internal endpoint
- [ ] Write auth endpoints (`/api/auth/anonymous`, `/api/auth/signup`, `/api/auth/login`)
- [ ] Write Socket.io WS server (`ws-server/server.js`, ~80 lines — see spec in `docs/transition_to_hetzner.md`)
- [ ] Write Dockerfiles for API and WS server

### Phase 4 — Frontend Code
- [ ] Replace `src/integrations/supabase/` with `src/integrations/api/` (thin fetch wrappers)
- [ ] Rewrite `src/utils/multiplayerService.ts` — `supabase.*` → `fetch('/api/...')` + Socket.io client
- [ ] Rewrite `src/contexts/AuthContext.tsx` — `supabase.auth.*` → custom auth endpoints
- [ ] Update env vars: remove `VITE_SUPABASE_*`, add `VITE_API_URL` and `VITE_WS_URL`

### Phase 5 — Build & Deploy Frontend
- [ ] Run `npm run build` locally → produces `dist/`
- [ ] Copy `dist/` to server: `rsync -avz dist/ deploy@<HETZNER-IP>:/home/deploy/acquire/dist/`
- [ ] Caddy serves `dist/` as static files (already configured in Caddyfile)
- [ ] For future deploys: same rsync command, or automate with a GitHub Action

### Phase 6 — Cutover & Cleanup
- [ ] Smoke test: create room, join, play a turn, realtime updates work
- [ ] Remove `@supabase/supabase-js` from `package.json`
- [ ] Delete `supabase/` directory
- [ ] Delete `src/integrations/supabase/`
- [ ] Pause the Supabase project

---

## 7. Monitoring

### Portainer (your day-to-day UI)
- Access at `portainer.jonashapp.com`
- Shows all containers, their status, CPU/RAM usage
- Click any container → Logs to see live output
- Start / stop / restart containers with a button

### UptimeRobot (external uptime alerts) — free
- Sign up at uptimerobot.com
- Add monitor: HTTPS → `https://acquiregame.jonashapp.com`
- Check interval: 5 minutes
- Alert: email if down
- You get an email within 5 minutes of any outage

### Useful SSH commands for quick checks
```bash
# See all running containers and status
docker ps

# Live logs for the API
docker logs -f acquire-api

# Live logs for the WS server
docker logs -f acquire-ws

# Restart everything after a config change
cd /home/deploy/acquire && docker compose restart

# Check disk/RAM usage
df -h && free -h
```

### Backups (Postgres)
Add a daily cron job on the server:
```bash
# Run: crontab -e, then add:
0 3 * * * docker exec acquire-db pg_dump -U acquire acquire > /home/deploy/backups/acquire_$(date +\%Y\%m\%d).sql
```

Hetzner also offers automated server snapshots (€0.013/GB/month) via the Cloud console — one-click restore if something goes catastrophically wrong.

---

## 8. Cost Summary

| Item | Cost |
|---|---|
| Hetzner CX22 | €4.35/month |
| acquiregame.jonashapp.com | Free (subdomain of existing domain) |
| SSL certificate | Free (Let's Encrypt via Caddy) |
| UptimeRobot | Free |
| Portainer CE | Free |
| **Total** | **~€4.35/month** |

vs. Netlify Pro ($20/month) + Supabase free tier issues.
