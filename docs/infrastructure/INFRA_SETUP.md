# Infrastructure Setup — Hetzner + Netlify DB

Step-by-step guide to provision and connect everything for the Supabase → Hetzner + Netlify migration.
**Work through these steps in order.** Each section has a verification check before moving on.

---

## Prerequisites (do before anything else)

You need:
- A Hetzner Cloud account (cloud.hetzner.com)
- Your domain's DNS control panel (wherever `jonashapp.com` DNS is managed — Cloudflare, Namecheap, etc.)
- A Netlify account with a paid plan or credits (Netlify DB requires it)
- The project repo cloned locally

Generate a strong secret for the internal WS auth (save this — you'll use it in 3 places):
```bash
openssl rand -hex 32
# e.g. a3f9c2d1e8b7...  → call this WS_INTERNAL_SECRET
```

Generate a JWT signing secret (save this — used by Netlify Functions and nowhere public):
```bash
openssl rand -hex 32
# e.g. 7d2e5f1a9c3b...  → call this JWT_SECRET
```

Write both values somewhere safe (password manager). You'll need them in Step 2 and Step 5.

---

## Step 1 — Create the Hetzner Server

**Where:** cloud.hetzner.com → Projects → New Project (or use existing)

1. Click **Add Server**
2. **Location:** choose EU (Falkenstein or Nuremberg) — closest to your users
3. **Image:** Ubuntu 24.04 LTS
4. **Type:** CX22 (2 vCPU, 4 GB RAM) — more than enough for a Socket.io relay
5. **SSH keys:** add your public key (`~/.ssh/id_rsa.pub` or `~/.ssh/id_ed25519.pub`)
   - If you don't have one: `ssh-keygen -t ed25519 -C "hetzner-acquire"` then paste the `.pub` contents
6. **Name:** `acquire-ws` (or anything memorable)
7. Click **Create & Buy Now**

Wait ~30 seconds. Hetzner shows you the server's **public IPv4 address** (e.g. `65.21.xxx.xxx`). **Copy it** — needed for DNS and SSH.

**Verify:** In the Hetzner console you see the server status as "Running" (green dot).

---

## Step 2 — SSH Into the Server

From your local machine (or from inside this Claude Code session — just give me the IP):

```bash
ssh root@<YOUR_HETZNER_IP>
```

First login may ask you to confirm the host fingerprint — type `yes`.

### 2a — Initial hardening (do this once)

```bash
# Keep packages up to date
apt update && apt upgrade -y

# Install essentials
apt install -y curl git ufw fail2ban

# Firewall: allow SSH, HTTP, HTTPS, and port 3001 (WS relay)
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3001/tcp
ufw --force enable

# Verify firewall
ufw status
```

**Verify:** `ufw status` shows ports 22, 80, 443, 3001 as ALLOW.

---

## Step 3 — Install Docker

Still on the Hetzner server via SSH:

```bash
# Docker's official install script (safe — same as docs.docker.com recommends)
curl -fsSL https://get.docker.com | sh

# Add root to docker group (so you don't need sudo for every docker command)
# (root already has access, this matters if you add a non-root user later)
systemctl enable docker
systemctl start docker

# Verify
docker --version
docker compose version
```

**Verify:** Both commands print version strings. `docker run hello-world` prints "Hello from Docker!".

---

## Step 4 — Deploy the WebSocket Server

### 4a — Upload the ws-server code

From your **local machine** (not the server), in the project root:

```bash
# Copy the ws-server directory to the Hetzner server
scp -r ws-server/ root@<YOUR_HETZNER_IP>:/opt/acquire-ws
```

Or alternatively, clone the whole repo on the server:

```bash
# On the server:
cd /opt
git clone <your-repo-url> acquire
cd acquire/ws-server
```

> **Note:** If you SSH me into the server (just give me `ssh root@IP`) I can do this copy and all subsequent steps directly.

### 4b — Create the .env file on the server

On the server, inside `/opt/acquire-ws` (or `/opt/acquire/ws-server`):

```bash
cd /opt/acquire-ws   # or wherever you put it

cat > .env << 'EOF'
WS_INTERNAL_SECRET=<paste your WS_INTERNAL_SECRET from Prerequisites>
ALLOWED_ORIGINS=https://acquiregame.netlify.app
PORT=3001
EOF
```

**Do not commit this file.** It's already in `.gitignore`.

### 4c — Build and start the container

```bash
# Install production dependencies first (Dockerfile copies node_modules from host)
npm install --omit=dev

docker compose up -d --build
```

This builds the Node 20 image from the Dockerfile in ws-server/ and starts it detached.

**Verify:**
```bash
docker compose ps          # status should be "Up"
docker compose logs -f     # should print: "Hotel Game WS relay listening on :3001"
curl http://localhost:3001/health
# → {"status":"ok","connections":0}
```

Press Ctrl+C to stop log tailing.

---

## Step 5 — Point a Subdomain at the Server

**Where:** your DNS control panel (Cloudflare / Namecheap / wherever you manage `jonashapp.com`)

Add an **A record**:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `ws` | `<YOUR_HETZNER_IP>` | Auto / 300 |

This creates `ws.jonashapp.com` → your server.

**Wait 1–5 minutes** for DNS to propagate, then verify from your local machine:

```bash
ping ws.jonashapp.com      # should resolve to your Hetzner IP
curl http://ws.jonashapp.com:3001/health
# → {"status":"ok","connections":0}
```

---

## Step 6 — Add TLS (HTTPS / WSS) with Caddy

The browser requires `wss://` (TLS). The easiest way on Hetzner is Caddy — it handles Let's Encrypt automatically.

On the server:

```bash
# Install Caddy
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudflare.com/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudflare.com/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy
```

Create the Caddy config:

```bash
cat > /etc/caddy/Caddyfile << 'EOF'
ws.jonashapp.com {
    reverse_proxy localhost:3001
}
EOF
```

Start Caddy:

```bash
systemctl enable caddy
systemctl restart caddy
systemctl status caddy   # should say "active (running)"
```

Caddy automatically obtains a Let's Encrypt certificate for `ws.jonashapp.com`. This takes ~10 seconds.

**Verify:**
```bash
curl https://ws.jonashapp.com/health
# → {"status":"ok","connections":0}
```

If this works, `wss://ws.jonashapp.com` is ready for Socket.io connections.

> **Update the docker-compose ALLOWED_ORIGINS** now that you know the real wss URL:
> Edit `/opt/acquire-ws/.env` and set `ALLOWED_ORIGINS=https://acquiregame.netlify.app`
> Then `docker compose up -d` to reload.

---

## Step 7 — Provision Netlify DB

**Where:** Netlify dashboard → your site → **Database** tab (requires paid plan / credits)

1. Go to your site in the Netlify dashboard
2. Click **Database** in the left nav
3. Click **Enable Netlify DB** — Netlify provisions a Neon Postgres instance linked to your site
4. Once provisioned, click **Connection details** and copy the `DATABASE_URL` (a `postgres://...` string)

> It looks like: `postgres://neondb_owner:xxxx@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`

---

## Step 8 — Apply the Database Schema

From your **local machine**, in the project root:

```bash
# Install psql if you don't have it
# macOS: brew install postgresql

psql "<YOUR_DATABASE_URL>" -f db/schema.sql
```

This runs `db/schema.sql` against Netlify DB, creating all tables and views in one shot (it's idempotent — safe to run again if something fails).

**Verify:**
```bash
psql "<YOUR_DATABASE_URL>" -c "\dt"
```

You should see: `users`, `profiles`, `game_rooms`, `game_players`, `game_states`, `game_history`.

```bash
psql "<YOUR_DATABASE_URL>" -c "\dv"
```

You should see: `game_players_public`, `game_states_public`.

---

## Step 9 — Set Netlify Environment Variables

**Where:** Netlify dashboard → your site → **Site configuration** → **Environment variables**

Add these variables (Scope: **All scopes** unless noted):

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://...` (from Step 7) | Keep secret |
| `JWT_SECRET` | your JWT_SECRET from Prerequisites | Keep secret |
| `WS_SERVER_URL` | `https://ws.jonashapp.com` | Internal URL for Netlify Functions to POST to |
| `WS_INTERNAL_SECRET` | your WS_INTERNAL_SECRET from Prerequisites | Must match .env on server |
| `VITE_WS_URL` | `wss://ws.jonashapp.com` | Build-time, used by the browser |

After adding all variables, click **Save** and trigger a **new deploy** so the build picks up `VITE_WS_URL`.

---

## Step 10 — End-to-End Smoke Test

### 10a — Test the WS server directly

From your local machine:

```bash
# Install wscat if not present
npm install -g wscat

# Connect to the WS server
wscat -c "wss://ws.jonashapp.com"
# Should connect — type anything, no errors
```

### 10b — Test the internal notify endpoint

```bash
curl -s -X POST https://ws.jonashapp.com/internal/notify \
  -H "Content-Type: application/json" \
  -H "x-internal-secret: <YOUR_WS_INTERNAL_SECRET>" \
  -d '{"roomId":"test-room","event":"test:ping","payload":{"msg":"hello"}}'
# → {"ok":true}
```

### 10c — Test the DB connection

From the Netlify Functions log (trigger any function after deploy) or locally:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM game_rooms;"
# → count = 0 (empty, that's correct)
```

### 10d — Full game flow test

1. Open the deployed site (`acquiregame.netlify.app`)
2. Create a room — check Netlify Function logs in the dashboard
3. Open a second browser tab, join the room with a different player
4. Toggle ready — verify the state updates in real-time across both tabs (Socket.io fan-out working)
5. Start a game — verify the board appears

**Monitor logs while testing:**
```bash
# On the Hetzner server (SSH in):
docker compose logs -f
# Watch for: "join_room" events from browsers, POST /internal/notify calls from Netlify
```

---

## Step 11 — Hetzner Auto-restart and Monitoring

On the server, the docker-compose already has `restart: unless-stopped`, meaning the container restarts automatically after server reboots.

Enable Docker to start on boot (should already be set, but confirm):

```bash
systemctl is-enabled docker   # should print "enabled"
```

Optional but recommended — set up a simple uptime check:

```bash
# Test that a cron-based self-check works
curl -s https://ws.jonashapp.com/health | grep '"status":"ok"'
```

You can add this to an uptime monitor like UptimeRobot (free) pointing at `https://ws.jonashapp.com/health` to get alerted if the server goes down.

---

## Summary — What You've Built

```
Browser (acquiregame.netlify.app)
  │
  ├── HTTPS/REST → Netlify Functions → Netlify DB (Neon Postgres)
  │                  └── after each mutation →
  └── WSS → wss://ws.jonashapp.com → Docker (acquire-ws) ← POST /internal/notify
```

**Checklist:**
- [ ] Hetzner server running (Step 1–2)
- [ ] Docker installed (Step 3)
- [ ] WS server container up: `curl http://localhost:3001/health` returns OK (Step 4)
- [ ] DNS A record: `ws.jonashapp.com → <Hetzner IP>` (Step 5)
- [ ] TLS via Caddy: `https://ws.jonashapp.com/health` returns OK (Step 6)
- [ ] Netlify DB provisioned and `DATABASE_URL` copied (Step 7)
- [ ] Schema applied: 6 tables + 2 views exist (Step 8)
- [ ] All 5 env vars set in Netlify dashboard (Step 9)
- [ ] End-to-end game flow works across two browser tabs (Step 10)

---

## Can I SSH In and Do This For You?

**Yes.** Once you have:
1. The Hetzner server created (Step 1 — you do this in the browser)
2. Your SSH key added to it during creation

Tell me the server IP (`65.21.xxx.xxx`) and I'll SSH in directly from this session and run Steps 2–8 for you. You only need to:
- Create the server (Step 1, ~2 minutes in Hetzner dashboard)
- Set the DNS record (Step 5, ~1 minute in your DNS panel)
- Set the Netlify env vars (Step 9, ~3 minutes in Netlify dashboard)

Everything else I can execute via Bash.
