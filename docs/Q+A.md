# Hotel Game - Q&A Session

## Overview
This document contains an interactive Q&A session about the Hotel Game project. Questions and answers will be added as the session progresses.

---

## Questions & Answers

### Q1: What's the tech stack for Real-time Updates in the gameplay?

**Socket.io** (WebSocket transport) with a **Hetzner-hosted relay server**. 

The architecture follows a **notification + refetch pattern**: Socket.io emits lightweight signals (`game:players_changed`, `game:state_updated`, `room:status_changed`) when data changes. The client responds by fetching authoritative state from the Netlify Functions API layer—not directly from the database. This keeps the WebSocket connection lightweight and maintains a clean separation: API handles auth/validation, Socket.io only handles notifications.

**Key Details:**
- Client: `socket.io-client` library, WebSocket-only transport
- Server: Hetzner Socket.io relay (configured via `VITE_WS_URL` env var)
- Pattern: Signal → Refetch (instead of pushing full state updates)
- Security: JWT tokens validate every API call; tile_bag never sent to client

---

### Q2: Why did we discard the login feature and what are we doing instead to identify players?

Login **isn't discarded**—just **hidden** behind a feature flag (`SHOW_ACCOUNT_UI = false`). The auth system remains intact for future use.

**Current player identification: Anonymous JWT + persistent localStorage**
- Players join **without signup/login** → automatic anonymous session creation (`getOrCreateAuthSession`)
- Each gets a **JWT token** stored in localStorage, decoded on app load to restore identity
- **Rejoin logic** (priority order):
  1. Check if registered user (JWT token + valid expiry)
  2. Check localStorage for saved game info (valid 48 hours)
  3. Verify player still exists in room by name
- Anonymous users have `is_anonymous = true` in database, persist via user_id

**Persistence:** Yes—identified by user_id across restarts via JWT token or localStorage fallback.

