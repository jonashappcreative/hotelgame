// Fan-out helper: after a Netlify Function mutates the DB it POSTs to the
// Hetzner relay's internal endpoint, which broadcasts the event to the room.
// Failures are logged but never block the action (realtime is best-effort;
// clients can always refetch).

export type RoomEvent =
  | 'game:state_updated'
  | 'game:players_changed'
  | 'room:status_changed';

export async function notifyWsServer(
  roomId: string,
  event: RoomEvent,
  payload: unknown = null,
): Promise<void> {
  const url = process.env.WS_SERVER_URL;
  const secret = process.env.WS_INTERNAL_SECRET;
  if (!url || !secret) {
    console.warn('WS_SERVER_URL / WS_INTERNAL_SECRET not set; skipping notify');
    return;
  }
  try {
    await fetch(`${url.replace(/\/$/, '')}/internal/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': secret,
      },
      body: JSON.stringify({ roomId, event, payload }),
    });
  } catch (err) {
    console.error('WS notify failed:', err);
  }
}
