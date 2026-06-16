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

