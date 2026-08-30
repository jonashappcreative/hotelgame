// =============================================================================
// players — seat management for a waiting room
// =============================================================================
// Everything that moves players between seats goes through here, because seats
// are guarded by `unique_player_per_room UNIQUE (room_id, player_index)`: a
// naive "write the new indices" loop collides with the constraint the moment
// two players swap. Both reseating paths — the host's manual reorder and the
// start-time shuffle — share reindexPlayers() so neither can get it wrong.
// =============================================================================

import { query, withTransaction } from './db';

/** A room starts once this many players are in it and every human is ready. */
export const MIN_PLAYERS_TO_START = 2;

/** Capacity of every room created since Epic 15; max_players is no longer a host choice. */
export const ROOM_CAPACITY = 6;

/**
 * Rewrite `game_players.player_index` so the given ids occupy seats 0..n-1 in
 * order, atomically.
 *
 * Two phases inside one transaction: park every row at a negative index first
 * (nothing else ever uses negatives, so the intermediate state is collision
 * free), then write the final indices. Either both phases land or neither does.
 *
 * `orderedIds` must be exactly the room's current players — validate before
 * calling; this function trusts its input.
 */
export async function reindexPlayers(roomId: string, orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;

  await withTransaction(async (exec) => {
    // Phase 1 — park out of the way. Lock the rows first so a concurrent join
    // can't slot into a seat we are about to hand out.
    await exec(
      'SELECT id FROM game_players WHERE room_id = $1 FOR UPDATE',
      [roomId],
    );
    for (let i = 0; i < orderedIds.length; i++) {
      await exec(
        'UPDATE game_players SET player_index = $1 WHERE id = $2 AND room_id = $3',
        [-1 - i, orderedIds[i], roomId],
      );
    }
    // Phase 2 — write the real seats.
    for (let i = 0; i < orderedIds.length; i++) {
      await exec(
        'UPDATE game_players SET player_index = $1 WHERE id = $2 AND room_id = $3',
        [i, orderedIds[i], roomId],
      );
    }
  });
}

/**
 * Clear every ready flag in a room, except bots — they are permanently ready.
 *
 * Called whenever the group changes (join, leave, bot added or removed). With
 * no fixed player count, "ready" has to mean "ready to play with exactly this
 * group", or a late joiner could land in a game that started without them.
 */
export async function resetReadyFlags(roomId: string): Promise<void> {
  await query(
    'UPDATE game_players SET is_ready = false WHERE room_id = $1 AND is_bot = false',
    [roomId],
  );
}

/**
 * Hand the room to the earliest-joined remaining human. Called when the host
 * leaves a waiting room — a room must never be left hostless, or nobody can
 * add bots, edit rules or arrange the seats.
 *
 * Returns the new host's user id, or null when no human is left (the room is
 * then empty or bots-only and the cleanup job will collect it).
 */
export async function transferHost(roomId: string): Promise<string | null> {
  const rows = await query<{ user_id: string }>(
    `SELECT user_id FROM game_players
      WHERE room_id = $1 AND is_bot = false AND user_id IS NOT NULL
      ORDER BY created_at
      LIMIT 1`,
    [roomId],
  );
  const nextHost = rows[0]?.user_id ?? null;
  await query('UPDATE game_rooms SET host_user_id = $1 WHERE id = $2', [nextHost, roomId]);
  return nextHost;
}
