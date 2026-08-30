// =============================================================================
// cleanup-rooms — closes idle rooms. Driven by the setInterval in
// server/server.ts (every 5 minutes); not an HTTP route.
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
//
// Before deleting, every idle room is offered to recordIfFinished (Epic 16).
// The engine already records a game the moment it ends, so this is a safety
// net: it catches games that finished while the recorder was down, rooms that
// were already over when the feature deployed, and any future game_over path
// that somehow bypasses the engine's exit point. Recording is idempotent, so
// the overwhelmingly common case — an abandoned lobby, or a game already
// recorded — costs one indexed lookup and writes nothing.
// =============================================================================

import { query } from '../lib/db';
import { recordIfFinished } from '../lib/results';

const IDLE_MINUTES = 10;

export default async (_req: Request): Promise<Response> => {
  try {
    // Identify the idle rooms first, so a finished game can be recorded before
    // its state row is cascaded away.
    const idle = await query<{ id: string }>(
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
       SELECT id FROM room_activity
        WHERE last_active < now() - interval '${IDLE_MINUTES} minutes'`,
    );

    if (idle.length === 0) {
      console.log('cleanup-rooms: closed 0 idle room(s)');
      return new Response(JSON.stringify({ closed: 0, recorded: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Safety net (Epic 16). recordIfFinished never throws and is idempotent.
    let recorded = 0;
    for (const room of idle) {
      if (await recordIfFinished(room.id, 'unknown')) recorded += 1;
    }

    const closed = await query<{ id: string }>(
      `DELETE FROM game_rooms WHERE id = ANY($1::uuid[]) RETURNING id`,
      [idle.map((r) => r.id)],
    );

    console.log(
      `cleanup-rooms: closed ${closed.length} idle room(s)` +
      (recorded > 0 ? `, recorded ${recorded} unrecorded finished game(s)` : ''),
    );
    return new Response(JSON.stringify({ closed: closed.length, recorded }), {
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

