import type { Server as SocketServer } from 'socket.io';

export type RoomEvent =
  | 'game:state_updated'
  | 'game:players_changed'
  | 'room:status_changed';

let io: SocketServer | null = null;

export function setSocketServer(server: SocketServer): void {
  io = server;
}

export async function notifyWsServer(
  roomId: string,
  event: RoomEvent,
  payload: unknown = null,
): Promise<void> {
  if (!io) {
    console.warn('Socket.io server not initialized; skipping notify');
    return;
  }
  io.to(roomId).emit(event, payload ?? null);
}
