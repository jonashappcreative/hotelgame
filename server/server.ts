// =============================================================================
// Hotel Game — unified backend server
// Hono REST API + Socket.io WebSocket + cleanup scheduler, all in one process.
// =============================================================================

import { createAdaptorServer } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { Server as SocketServer } from 'socket.io';
import { setSocketServer } from './lib/ws';

// Route handlers (plain Web Request/Response functions — see server/api/)
import authAnonymous from './api/auth-anonymous';
import authSignup from './api/auth-signup';
import authLogin from './api/auth-login';
import gameAction from './api/game-action';
import rooms from './api/rooms';
import account from './api/account';
import cleanupRooms from './api/cleanup-rooms';

const PORT = Number(process.env.PORT) || 3000;

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (ALLOWED_ORIGINS.length === 0) {
  ALLOWED_ORIGINS.push(
    'https://hotelgame.jonashapp.com',
    'http://localhost:5173',
    'http://localhost:4173',
  );
}

// Adapt a Web API handler (Request → Response) for use as a Hono route
function handler(fn: (req: Request) => Promise<Response>) {
  return (c: any) => fn(c.req.raw);
}

const app = new Hono();

app.all('/api/auth/anonymous', handler(authAnonymous));
app.all('/api/auth/signup',    handler(authSignup));
app.all('/api/auth/login',     handler(authLogin));
app.all('/api/game-action',    handler(gameAction));
app.all('/api/rooms',          handler(rooms));
app.all('/api/account',        handler(account));

app.get('/health', (c) => c.json({ status: 'ok' }));

// Serve Vite-built frontend; fallback to index.html for client-side routing
app.use('/*', serveStatic({ root: './dist' }));
app.use('/*', serveStatic({ path: './dist/index.html' }));

// Create an http.Server backed by Hono, then attach Socket.io to the same server
const nodeServer = createAdaptorServer({ fetch: app.fetch.bind(app) });

const io = new SocketServer(nodeServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
  },
});

// Wire in-process Socket.io so notifyWsServer() emits directly (no HTTP hop)
setSocketServer(io);

io.on('connection', (socket) => {
  socket.on('join_room', (roomId: string) => {
    if (typeof roomId === 'string' && roomId.length > 0) socket.join(roomId);
  });
  socket.on('leave_room', (roomId: string) => {
    if (typeof roomId === 'string' && roomId.length > 0) socket.leave(roomId);
  });
});

// Cleanup scheduler: close idle rooms every 5 minutes
setInterval(
  () => {
    cleanupRooms(new Request('http://localhost/cleanup'))
      .catch((err: unknown) => console.error('cleanup error:', err));
  },
  5 * 60 * 1000,
);

nodeServer.listen(PORT, () => {
  console.log(`Hotel Game backend listening on :${PORT}`);
});
