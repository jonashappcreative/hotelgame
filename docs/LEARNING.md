# What I Learned Building Hotel Game

This is a personal record of everything I picked up while building an online multiplayer board game from scratch — from the first Lovable prototype through the full Hetzner migration. Written in the order things came up, grouped by topic.

---

## Table of Contents

- [Servers & Hosting](#servers--hosting)
  - [Netlify](#netlify)
  - [Supabase](#supabase)
  - [Hetzner Cloud](#hetzner-cloud)
  - [General Hosting Concepts](#general-hosting-concepts)
  
- [Architecture](#architecture)
  - [Separation of Concerns](#separation-of-concerns)
  - [Stateless vs. Stateful](#stateless-vs-stateful)
  - [The Shim Pattern](#the-shim-pattern)
  - [Anti-Cheat Architecture](#anti-cheat-architecture)
  - [Trade-offs I Made](#trade-offs-i-made)

- [Databases](#databases)
  - [PostgreSQL Basics](#postgresql-basics)
  - [JSON in Postgres](#json-in-postgres)
  - [Neon (Serverless Postgres)](#neon-serverless-postgres)
  - [Views vs. RLS](#views-vs-rls)
  - [Connection Pooling](#connection-pooling)

- [Realtime & WebSockets](#realtime--websockets)
  - [How WebSockets Work](#how-websockets-work)
  - [Socket.io](#socketio)
  - [The Relay Pattern](#the-relay-pattern)
  - [In-Process vs. Over-Wire Notifications](#in-process-vs-over-wire-notifications)
  - [Best-Effort vs. Guaranteed Delivery](#best-effort-vs-guaranteed-delivery)

- [Security](#security)
  - [The OWASP Top 10](#the-owasp-top-10)
  - [Authentication: JWT](#authentication-jwt)
  - [CORS](#cors)
  - [Game-Specific Security](#game-specific-security)
  - [Secrets Management](#secrets-management)
  - [Security Headers](#security-headers)

- [Docker & Containers](#docker--containers)
  - [What Docker Does](#what-docker-does)
  - [Docker Compose](#docker-compose)
  - [Useful Docker Commands](#useful-docker-commands)
  
- [Reverse Proxies & TLS](#reverse-proxies--tls)
  - [What a Reverse Proxy Does](#what-a-reverse-proxy-does)
  - [Caddy](#caddy)
  - [TLS / HTTPS / WSS](#tls--https--wss)

- [DNS](#dns)
  - [How DNS Works](#how-dns-works)
  - [DNS Cutover Strategy](#dns-cutover-strategy)

- [Linux & Bash](#linux--bash)
  - [Initial Server Setup](#initial-server-setup)
  - [UFW (Firewall)](#ufw-firewall)
  - [Useful Commands](#useful-commands)
  - [Cron Jobs](#cron-jobs)

- [Git & GitHub](#git--github)
  - [Commit Conventions](#commit-conventions)
  - [Branch Workflow](#branch-workflow)
  - [Secrets in Git History](#secrets-in-git-history)
- [Intellectual Property](#intellectual-property)
  - [Board Game IP](#board-game-ip)

- [Game Design (Technical Side)](#game-design-technical-side)
  - [State Machines](#state-machines)
  - [Bot AI](#bot-ai)
  - [Merger Complexity](#merger-complexity)

- [Tools & Services Encountered](#tools--services-encountered)

---

## Servers & Hosting

### Netlify
- Netlify hosts static sites (your React build) on a global CDN — you get fast load times everywhere without configuring anything.
- **Serverless functions** live alongside your site and run on-demand. They're great for game logic: no always-on server costs, auto-scaling, zero setup.
- The free tier has a **credit limit** (300/month). A real-time multiplayer game burns credits fast: every game action is a function invocation, every DB query costs compute, every WebSocket notification is a request. Credits run out.
- `netlify.toml` controls redirects, function directories, security headers, and build commands all in one file.
- **Environment variables** set in the Netlify dashboard are available to functions at runtime and to the Vite build at build time (prefix with `VITE_` for build-time vars).

### Supabase
- Supabase bundles Postgres, auth, storage, and realtime into one service. It's great for prototypes because you get a backend in minutes.
- The free tier **pauses the database** after 7 days of inactivity. For a low-traffic game, this means players get a cold-start error every weekend. That's what triggered the migration away.
- **Row Level Security (RLS)** lets you write security rules as SQL policies directly on tables, enforced by the DB engine. Powerful but opaque — when a query returns nothing and you don't know why, RLS is usually the culprit.
- Supabase Realtime works by listening to Postgres `NOTIFY` events and broadcasting them to connected clients. You subscribe to a table change, and the client gets an update. Convenient, but you don't control the delivery.

### Hetzner Cloud
- A VPS (Virtual Private Server) is a virtual machine you rent by the month. Unlike serverless, it's always on — you pay whether anyone is using it or not. For a flat ~€5/month, it's cheaper than serverless once traffic is consistent.
- You pick a **data center location** when creating a server. Closer to your users = less latency. EU is good for a European audience.
- After creating a server, you get a **public IPv4 address**. That's how the internet reaches it.
- **SSH keys** are how you log in without a password. You generate a key pair (`ssh-keygen`), put the public key on the server, and log in from your machine with the private key. No password ever travels over the network.
- First-time SSH login asks you to confirm the server's **fingerprint** — this is how SSH prevents man-in-the-middle attacks. Type `yes` the first time (you're confirming the server is who it says it is), then SSH remembers it.

### General Hosting Concepts
- **CDN (Content Delivery Network):** copies of your static files are cached at servers around the world. When someone loads your site, they get it from the nearest server, not from one machine in one country.
- **Cold start:** serverless functions sleep when idle. The first request after a sleep period takes longer (sometimes 1–2 seconds extra) while the runtime spins up. This matters for user experience.
- **Credit-based billing vs. flat billing:** serverless is pay-per-use (good for zero traffic, expensive for steady traffic). A VPS is flat (good for steady traffic, wasteful at zero).

---

## Architecture

### Separation of Concerns
The game ended up split into three independent pieces:
1. **Frontend (React SPA):** just HTML/CSS/JS. Netlify serves it. It has no game secrets, no DB credentials.
2. **API (serverless functions / unified backend):** the only thing that touches the database and runs game logic. It's the single source of truth.
3. **WebSocket relay:** a dumb message bus. It doesn't know game rules, doesn't touch the DB. It just broadcasts "something changed" to connected browsers.

The key invariant: **only the API layer writes to the database.** The browser never holds DB credentials. If the WebSocket relay goes down, the game state is safe in the DB and clients can reload.

### Stateless vs. Stateful
- **Stateless** means each request carries all context needed to handle it (e.g., a JWT with the user ID). The server doesn't remember anything between requests. Serverless functions are stateless by nature.
- **Stateful** means the server remembers things (open WebSocket connections, in-memory game state). A long-running Node.js process is stateful.
- The relay server is stateful (it holds open WebSocket connections) but the game logic is stateless (it re-reads from the DB on every action). This is intentional: if the relay crashes, you lose connections but not data.

### The Shim Pattern
When migrating from Supabase to a plain Postgres driver, 2,100 lines of game logic used Supabase's query API (`adminClient.from('table').select().eq()`). Rewriting all of it would be risky.

Instead, I built a **shim**: a small module that implements the same interface (`.from().select().eq().single()`) but executes it against a standard `pg` pool. The 2,000 lines of game logic ported verbatim. Only the top-level plumbing changed.

This is a general pattern: when you need to swap out an implementation, write an adapter that speaks the old API to existing code, but translates to the new system underneath.

### Anti-Cheat Architecture
In a multiplayer game, the server must be the authority on game state. Two specific things must never reach the browser:
- **The tile bag** — if a player can see future draws, they know what tiles are coming.
- **Other players' tiles** — seeing opponents' hands is cheating.

The solution: database views (`game_states_public`, `game_players_public`) that exclude these columns. The API returns data only through these views, and serves a player their own tiles only when their JWT matches the `user_id`.

### Trade-offs I Made
- **HTTP-per-action over persistent connection for game logic:** each game action is a fresh HTTP POST. Simpler to reason about (stateless, no connection management), but adds latency vs. a persistent WebSocket for commands too.
- **Fire-and-forget WebSocket notifications:** after writing game state to the DB, the API emits a socket event but doesn't wait for confirmation. If the emit fails, the client is briefly stale — but it can always reload. Guaranteed delivery would require a queue, which is more complex.
- **No CI/CD pipeline:** a manual `deploy.sh` script is fine for a personal project. The cost of a proper pipeline (GitHub Actions, Docker registries, staging environments) isn't worth it at this scale.

---

## Databases

### PostgreSQL Basics
- PostgreSQL is a relational database. Data lives in tables with typed columns, connected by foreign keys.
- `psql` is the command-line client. You connect with a connection string: `psql "postgres://user:pass@host/db"`.
- `\dt` lists tables. `\dv` lists views. `SELECT count(*) FROM table;` is the quickest sanity check.
- **Idempotent migrations:** write SQL that can run twice without failing (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). This makes re-running migrations after a failure safe.

### JSON in Postgres
- PostgreSQL has a `jsonb` column type for storing structured JSON. Unlike `text`, it's binary-encoded, indexed, and queryable with operators like `->` and `->>`.
- When using a Node.js driver, you must `JSON.stringify()` before inserting into `jsonb` columns and `JSON.parse()` after reading. The Neon driver handled this automatically; the standard `pg` driver does not. This is a common gotcha when switching drivers.

### Neon (Serverless Postgres)
- Neon is Postgres-as-a-service with a serverless driver that routes queries over HTTP instead of a persistent TCP connection. This is what makes it work from serverless functions (which can't hold TCP connections across invocations).
- The downside: each query is an HTTP round-trip. Sequential queries compound latency. **Parallelising independent queries with `Promise.all()`** cuts this significantly.

### Views vs. RLS
- **RLS (Row Level Security):** access control enforced at the DB level. Every query from every client goes through the same policy. Powerful but adds complexity and can be invisible when debugging.
- **Views:** a named query that looks like a table. `game_states_public` is just a `SELECT` that excludes the `tile_bag` column. Simple, transparent, easy to audit.
- After removing Supabase, I dropped RLS entirely. The application layer (serverless functions) is the only DB client, so security is enforced in code: "is this user in this room? is it their turn?" — checked before every mutation.

### Connection Pooling
- A database can only handle a limited number of simultaneous connections. Opening a new connection per query is slow and wasteful.
- A **connection pool** opens N connections upfront and reuses them. `new Pool({ max: 20 })` means at most 20 concurrent DB connections. New queries wait if all 20 are busy.
- Long-running servers (like the Hetzner backend) need a pool. Serverless functions are better off with the HTTP driver (no persistent connection to maintain).

---

## Realtime & WebSockets

### How WebSockets Work
- HTTP is request-response: client asks, server answers, connection closes.
- **WebSocket** is a persistent, bidirectional channel. Once opened, either side can send a message at any time. This is what makes realtime updates possible without polling.
- The handshake starts as HTTP (`Upgrade: websocket` header), then upgrades to the WebSocket protocol. That's why WebSocket URLs start with `ws://` (or `wss://` for TLS).

### Socket.io
- Socket.io is a library built on top of WebSockets. It adds:
  - **Rooms:** a client can `join('room-abc')`, and you can `emit` to everyone in that room with `io.to('room-abc').emit(event, data)`.
  - **Automatic reconnection:** if the connection drops, Socket.io retries.
  - **Fallback to polling:** if WebSockets aren't available (rare today), it falls back to HTTP polling.
- The browser connects to the Socket.io server and joins a room matching their game room ID. When any game action happens, the backend emits an event to the room — all players in that room receive it and refetch the game state.

### The Relay Pattern
The architecture I built:
1. Player submits an action (HTTP POST to Netlify function)
2. Function validates + applies the action + writes to DB
3. Function POSTs to the Hetzner relay: "notify room X that something changed"
4. Relay broadcasts a Socket.io event to all clients in room X
5. Clients refetch the current state

The relay has no game knowledge. It just translates an HTTP POST into a Socket.io broadcast. This separation means the relay is disposable — if it goes down, game state is safe and clients can reload to get the latest state.

### In-Process vs. Over-Wire Notifications
The original relay needed an HTTP request from Netlify to Hetzner to trigger a broadcast. This added ~50-100ms of network latency to every game action.

In the unified Hetzner backend, the API and Socket.io server run **in the same process**. The notification is a direct function call: `io.to(roomId).emit(event, payload)` — microseconds instead of milliseconds.

### Best-Effort vs. Guaranteed Delivery
WebSocket events are fire-and-forget. If a client misses an event (their tab was in the background, the connection dropped briefly), they won't automatically get it later.

The solution: **events trigger refetches, not state updates.** When a client receives `game:state_updated`, it GETs the full current state from the API. The event is just a signal. Even if a client misses 10 events, one refetch gets them fully up to date.

---

## Security

### The OWASP Top 10
A standard list of the most common web vulnerabilities. Working through the security audit taught me:
- **SQL injection:** never build SQL by string concatenation. Always use bound parameters (`$1, $2`). Even for table/column names from your own code, be deliberate.
- **XSS (Cross-Site Scripting):** never put user-provided strings directly into HTML (`.innerHTML`, `dangerouslySetInnerHTML`). Use JSX rendering — React escapes everything automatically.
- **Broken Access Control:** every action must check "is the requesting user allowed to do this?" Not just "are they logged in?" but "are they in this room, on this turn, in this game phase?"

### Authentication: JWT
- A **JWT (JSON Web Token)** is a signed token the server issues after login. It contains claims (like user ID) and a cryptographic signature.
- The server signs with a secret key. Anyone can read the payload (it's base64, not encrypted), but only the server can create a valid signature. Tampering with the payload invalidates the signature.
- JWTs are **stateless** — the server doesn't need to look anything up to verify one. It just checks the signature.
- Storing JWTs in `localStorage` is a pragmatic choice for a game — it persists across tab refreshes. The alternative (httpOnly cookies) is more secure against XSS but requires more server-side setup (CSRF tokens, SameSite cookies).

### CORS
- **CORS (Cross-Origin Resource Sharing):** browsers block JavaScript from making requests to a different domain unless the server explicitly allows it.
- A **wildcard** (`Access-Control-Allow-Origin: *`) allows any origin. That's fine for public APIs but wrong for APIs with auth — it means any website could make authenticated requests on behalf of your users.
- The fix: maintain an explicit **allowlist** of origins (`https://hotelgame.jonashapp.com`, `http://localhost:5173`) and reject anything not on the list.

### Game-Specific Security
- **Phase validation:** game actions must check that the game is in the right phase, not just that it's the right player's turn. Without this, the current player can place a tile during the buy phase, double-place, or skip phases entirely.
- **Server-side authority:** the server recomputes chain adjacency, merger eligibility, and tile validity — never trusting the client's claim that a move is valid.
- **Rate limiting:** without it, a user can create thousands of rooms, flooding the DB. A simple trigger or counter check (max 5 active rooms per user) prevents this.

### Secrets Management
- `.env` files hold secrets (DB passwords, JWT keys). They must never be committed to git.
- If you accidentally commit a secret, `git-filter-repo` can scrub it from history. But the safest approach is rotating the secret immediately — assume it's compromised once it's been in a commit.
- `openssl rand -hex 32` generates a cryptographically random 32-byte secret. Use this for JWT keys, internal shared secrets, anything that needs to be unguessable.

### Security Headers
Headers sent with every HTTP response can harden the browser's behavior:
- `Content-Security-Policy`: tells the browser which domains can load scripts, styles, images. Prevents injected scripts from phoning home.
- `Strict-Transport-Security`: forces HTTPS even if the user types `http://`. Once seen, the browser won't downgrade.
- `X-Frame-Options: DENY`: prevents your site from being embedded in an iframe (clickjacking protection).
- `X-Content-Type-Options: nosniff`: stops the browser from guessing file types (can lead to script execution from text files).

---

## Docker & Containers

### What Docker Does
- A **container** is an isolated environment with its own filesystem, processes, and network. It runs the same way on any machine that has Docker.
- A **Dockerfile** describes how to build an image: start from a base (e.g., `node:20-alpine`), copy files, run commands, set an entrypoint.
- **Multi-stage builds:** use one Docker stage to compile TypeScript, then copy only the compiled output into a smaller runtime stage. The final image doesn't contain TypeScript compiler, source files, or dev dependencies.

### Docker Compose
- `docker compose` manages multiple containers as a unit. One `docker-compose.yml` defines all services, their environment, networking, and restart policies.
- `restart: unless-stopped` means the container automatically restarts after a server reboot or crash — you don't need to SSH in to start things up.
- **Networks:** containers on the same Docker network can reach each other by service name (e.g., `postgres:5432`). Internal traffic never leaves the machine. Only ports explicitly mapped to the host (`ports:`) are reachable from outside.
- `docker compose up -d` starts everything detached (in the background). `docker compose logs -f` follows the logs. `docker compose ps` shows status.

### Useful Docker Commands
```bash
docker compose up -d --build   # rebuild images and start
docker compose logs -f          # follow logs from all services
docker compose ps               # show running containers and status
docker exec -it acquire-db psql -U acquire  # open psql inside the DB container
docker compose restart backend  # restart one service
```

---

## Reverse Proxies & TLS

### What a Reverse Proxy Does
- A reverse proxy sits in front of your app and handles incoming requests. It forwards them to the right backend service.
- Benefits: TLS termination (decrypts HTTPS, forwards plain HTTP to your app), routing (different paths go to different services), caching, security headers.

### Caddy
- Caddy is a modern web server and reverse proxy. Its killer feature: **automatic HTTPS**. It obtains and renews Let's Encrypt certificates with zero configuration.
- A minimal Caddyfile:
  ```
  hotelgame.jonashapp.com {
      reverse_proxy backend:3000
  }
  ```
  Caddy sees the domain, fetches a certificate from Let's Encrypt, and starts proxying — no manual cert management.
- Caddy can also serve static files (`file_server`) and handle SPA routing (`try_files {path} /index.html`).

### TLS / HTTPS / WSS
- TLS encrypts traffic between the browser and server. HTTPS = HTTP over TLS. WSS = WebSocket over TLS.
- **Let's Encrypt** is a free certificate authority. It proves you control a domain by having you serve a specific file from it (HTTP challenge) or add a DNS record (DNS challenge).
- Browsers require WSS (not plain `ws://`) for connections from HTTPS pages. That's why the WebSocket URL must use `wss://`.

---

## DNS

### How DNS Works
- DNS translates a domain name to an IP address. When a browser needs `hotelgame.jonashapp.com`, it asks DNS servers: "what IP is that?" and connects to the answer.
- **A record:** maps a hostname to an IPv4 address. This is what points your domain to the Hetzner server.
- **CNAME record:** maps a hostname to another hostname. Netlify gives you a CNAME to point to their load balancer. CNAMEs can't point to IP addresses — that's why you need an A record for Hetzner.
- **TTL (Time to Live):** how long DNS resolvers cache the answer. A low TTL (300 seconds) means changes propagate in 5 minutes. A high TTL means clients cache the old IP longer during a migration.

### DNS Cutover Strategy
When moving from Netlify to Hetzner:
1. Keep Netlify running (it still works as a fallback)
2. Change the A record to the Hetzner IP
3. Wait for TTL to expire (5 minutes if TTL was 300)
4. Test the new server
5. If something breaks, revert the A record — Netlify is still there

This is why you don't delete the Netlify site during a migration.

---

## Linux & Bash

### Initial Server Setup
```bash
apt update && apt upgrade -y          # update package lists and upgrade installed packages
apt install -y curl git ufw fail2ban  # install tools
ufw allow OpenSSH                     # allow SSH through firewall
ufw allow 443/tcp                     # allow HTTPS
ufw --force enable                    # enable firewall
ufw status                            # verify
```

### UFW (Firewall)
- UFW (Uncomplicated Firewall) manages `iptables` rules with a simple interface.
- By default, UFW blocks all incoming traffic. You explicitly allow what you need.
- Always allow SSH before enabling UFW — otherwise you lock yourself out.

### Useful Commands
```bash
ssh root@<IP>                              # connect to a server
scp -r ./ws-server root@<IP>:/opt/app     # copy a folder to a server
openssl rand -hex 32                       # generate a random secret
curl -s https://ws.jonashapp.com/health   # test an HTTP endpoint
systemctl status caddy                     # check if a service is running
systemctl enable caddy                     # start service on boot
journalctl -u caddy -f                    # follow systemd service logs
```

### Cron Jobs
Cron schedules commands on a repeating schedule. `crontab -e` opens the editor.
```
0 3 * * *   # run at 3am every day
*/5 * * * * # run every 5 minutes
```
Format: `minute hour day month weekday command`

A daily DB backup cron:
```bash
0 3 * * * docker exec acquire-db pg_dump -U acquire acquire | gzip > /backups/acquire_$(date +\%Y\%m\%d).sql.gz
```

---

## Git & GitHub

### Commit Conventions
Using a consistent format makes `git log` readable:
- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance (dependency bumps, version updates, file moves)
- `docs:` — documentation only
- `refactor:` — code restructuring without behaviour change

### Branch Workflow
- Work on a feature branch, not `main`. `main` should always be deployable.
- Merge to `main` when the feature is complete and tested.
- Keep branch names descriptive: `feat/hetzner-migration`, `fix/security-audit-remediation`.

### Secrets in Git History
If a secret is committed (even in a past commit, even in a deleted file), it's in the history and visible to anyone who clones the repo.
- Rotate the secret immediately — assume it's compromised.
- Use `git-filter-repo` to scrub it from history (rewrites all commits that touched the file).
- Add the file to `.gitignore` so it can't be accidentally staged again.

---

## Intellectual Property

### Board Game IP
The original Acquire board game is a copyrighted/trademarked work. Using its name ("Acquire"), hotel chain names (Continental, Imperial, etc.), and marketing it as an "implementation of Acquire" creates IP liability.

The fix: rename the game ("Hotel Game"), rename the chains to original names, change the game description to "inspired by classic hotel chain games" rather than claiming to implement a specific game.

Key distinction: **mechanics can't be copyrighted, but names and specific creative expression can.** You can build a tile-placement hotel chain merger game — you just can't call it Acquire or use its branded chain names.

---

## Game Design (Technical Side)

### State Machines
A multiplayer game is a state machine: at any moment the game is in exactly one phase (`place_tile`, `buy_stock`, `merger_choose_survivor`, etc.), and only specific actions are valid in each phase.

Every action handler must check:
1. Is the user in this room?
2. Is it this user's turn?
3. Is the game in the correct phase for this action?

Without check 3, a player can trigger actions out of sequence and corrupt state.

### Bot AI
Bots run on the server, not the client. The server periodically calls `driveBots()` which checks if any bot is the current player and submits an action on their behalf via the same game action handler that human players use — bots go through the same validation as humans.

A common bug: if a bot's action is rejected (wrong phase, stale state), and the recovery path isn't handled, the bot gets stuck permanently. The fix: add retry logic and fallback actions (e.g., if a bot has 0 shares in a defunct chain during a merger, explicitly return `{ sell:0, trade:0, keep:0 }` instead of crashing).

### Merger Complexity
Mergers are the most complex part of Acquire-style games. When two chains merge:
1. Determine which chain is larger (survivor) and which disappears (defunct)
2. Pay merger bonuses to shareholders of the defunct chain (majority + minority holder)
3. Each player with defunct shares decides: sell, trade (2:1 for survivor shares), or keep
4. Remove defunct chain tiles from the board

Each of these is a separate game phase with its own validation. Players go through them in turn order. Bots must handle every case — including holding 0 shares (common and easy to forget as an edge case).

---

## Tools & Services Encountered

| Tool/Service | What it's for |
|---|---|
| **Netlify** | Static site hosting + serverless functions |
| **Supabase** | Postgres + auth + realtime (used early, then removed) |
| **Neon** | Serverless Postgres (Netlify DB runs on Neon) |
| **Hetzner Cloud** | VPS hosting (~€5/mo) |
| **Docker / Docker Compose** | Container orchestration |
| **Caddy** | Reverse proxy + automatic TLS |
| **Socket.io** | WebSocket library with rooms + reconnection |
| **jose** | JWT signing/verification in Node.js |
| **bcryptjs** | Password hashing |
| **Vite** | Frontend build tool (fast HMR, ESM-first) |
| **TypeScript** | Typed JavaScript — strict mode catches bugs at compile time |
| **Tailwind CSS** | Utility-first CSS — compose styles directly in JSX |
| **UFW** | Linux firewall (wraps iptables) |
| **Let's Encrypt / Caddy** | Free TLS certificates, auto-renewed |
| **UptimeRobot** | Free uptime monitoring with alerts |
| **openssl** | Generating cryptographically random secrets |
| **psql** | PostgreSQL CLI client |
| **wscat** | WebSocket CLI client (for testing `wss://` connections) |
