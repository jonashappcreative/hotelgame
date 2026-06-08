// =============================================================================
// cleanup-rooms — scheduled Netlify Function (runs every 5 minutes)
// =============================================================================
// "Closes" rooms that have seen no player activity for the last 10 minutes —
// this covers both finished games whose players have moved on and rooms that
// were simply abandoned. Deleting the room cascades to its game_players and
// game_states rows (see the ON DELETE CASCADE FKs in db/schema.sql), freeing
// the host's active-room slots and removing them from reconnection lookups.
//
// "Activity" is the most recent of:
//   * any player's heartbeat            (game_players.last_seen_at)
//   * the last game-state mutation      (game_states.updated_at)
//   * the room's own last update        (game_rooms.updated_at)
// The browser sends a heartbeat every 15s while a player has the game open, so
// only genuinely idle rooms (everyone closed the tab) ever cross the threshold.
//
// The handler only ever deletes rooms already idle for >10 min, so it is safe
// to run unauthenticated on a schedule; it can never touch an active game.
// =============================================================================

import { query } from './_shared/db';

const IDLE_MINUTES = 10;

export default async (_req: Request): Promise<Response> => {
  try {
    const closed = await query<{ id: string }>(
      `WITH room_activity AS (
         SELECT gr.id,
                GREATEST(
                  gr.updated_at,
                  COALESCE(MAX(gp.last_seen_at), gr.updated_at),
                  COALESCE(MAX(gs.updated_at), gr.updated_at)
                ) AS last_active
           FROM game_rooms gr
           LEFT JOIN game_players gp ON gp.room_id = gr.id
           LEFT JOIN game_states  gs ON gs.room_id = gr.id
          GROUP BY gr.id
       )
       DELETE FROM game_rooms
        WHERE id IN (
          SELECT id FROM room_activity
           WHERE last_active < now() - interval '${IDLE_MINUTES} minutes'
        )
        RETURNING id`,
    );

    console.log(`cleanup-rooms: closed ${closed.length} idle room(s)`);
    return new Response(JSON.stringify({ closed: closed.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('cleanup-rooms error:', err);
    return new Response(JSON.stringify({ error: 'cleanup failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

// Netlify scheduled-function config: run every 5 minutes.
export const config = { schedule: '*/5 * * * *' };
