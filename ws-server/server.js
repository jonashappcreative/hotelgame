// =============================================================================
// Acquire — Hetzner WebSocket relay server
// =============================================================================
// A pure message relay. It holds NO game state and never touches the database.
//
//   Browsers  ── Socket.io ──►  this server  (join/leave rooms, receive events)
//   Netlify Functions ── POST /internal/notify ──►  this server  (fan-out)
//
// After a Netlify Function mutates the DB it POSTs here, and we broadcast the
// named event to every socket in that room.
// =============================================================================

import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';

const PORT = process.env.PORT || 3001;
const INTERNAL_SECRET = process.env.WS_INTERNAL_SECRET;
// Allowed browser origins for the Socket.io CORS check. Configurable via the
// comma-separated ALLOWED_ORIGINS env var; falls back to the production
// domains + local dev ports when unset.
const DEFAULT_ALLOWED_ORIGINS = [
  'https://hotelgame.jonashapp.com',
  'https://acquiregame.netlify.app',
  'http://localhost:8080',
  'http://localhost:5173',
  'http://localhost:4173',
];
const ENV_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = ENV_ALLOWED_ORIGINS.length > 0
  ? ENV_ALLOWED_ORIGINS
  : DEFAULT_ALLOWED_ORIGINS;

if (!INTERNAL_SECRET) {
  console.error('FATAL: WS_INTERNAL_SECRET is not set. Refusing to start.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '256kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : false,
    methods: ['GET', 'POST'],
  },
});

// -----------------------------------------------------------------------------
// Socket.io: clients join/leave per-room channels
// -----------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('join_room', (roomId) => {
    if (typeof roomId === 'string' && roomId.length > 0) {
      socket.join(roomId);
    }
  });

  socket.on('leave_room', (roomId) => {
    if (typeof roomId === 'string' && roomId.length > 0) {
      socket.leave(roomId);
    }
  });
});

// -----------------------------------------------------------------------------
// Internal fan-out endpoint (called only by Netlify Functions)
// Protected by a shared secret; never exposed to the browser.
// -----------------------------------------------------------------------------
app.post('/internal/notify', (req, res) => {
  if (req.get('x-internal-secret') !== INTERNAL_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { roomId, event, payload } = req.body || {};
  if (typeof roomId !== 'string' || typeof event !== 'string') {
    return res.status(400).json({ error: 'roomId and event are required' });
  }

  io.to(roomId).emit(event, payload ?? null);
  return res.json({ ok: true });
});

// -----------------------------------------------------------------------------
// Health check (for Docker / uptime monitoring)
// -----------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', connections: io.engine.clientsCount });
});

server.listen(PORT, () => {
  console.log(`Acquire WS relay listening on :${PORT}`);
});
