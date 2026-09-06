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
import {
  type ChainName,
  type TileId,
  type ActivePowerCard,
  type CustomRules,
  getEligibleChains,
  getBoardDimensions,
  isMultiTileActive,
  isTilePlayable,
  MULTI_TILE_LIMIT,
} from './rules';

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

// =============================================================================
// Turn mechanics shared by every path that ends a turn or finishes a placement
// =============================================================================
// Both helpers exist because Epic 17 breaks an assumption the engine had wired
// into several places at once, and a missed call site is a stuck turn.

/**
 * Refill a hand up to the room's tile limit, drawing from the end of the bag.
 *
 * "Draw one tile at the end of your turn" was only ever correct because exactly
 * one tile had been placed. The moment a turn can place four tiles or draw five
 * at once, the invariant that actually matters has to be stated explicitly:
 * **your hand is topped back up to the limit when your turn ends.**
 *
 * Behaviour-preserving for ordinary play — a hand one below the limit draws
 * exactly one tile. A hand at or above the limit draws nothing, which is what
 * makes Extra Tiles' drought a consequence of this rule rather than a separate
 * mechanism. An empty bag simply stops early.
 *
 * Returns fresh arrays; neither input is mutated.
 */
export function refillHand(
  tiles: TileId[],
  bag: TileId[],
  limit: number,
): { tiles: TileId[]; bag: TileId[] } {
  const newTiles = [...(tiles ?? [])];
  const newBag = [...(bag ?? [])];

  while (newTiles.length < limit && newBag.length > 0) {
    newTiles.push(newBag.pop()!);
  }

  return { tiles: newTiles, bag: newBag };
}

/** The room's hand limit — the same number of tiles each player was dealt. */
export function getHandLimit(rules: CustomRules): number {
  return parseInt(rules.startingTiles, 10);
}

/**
 * The phase a turn moves to once a placement is fully resolved — including
 * after a merger has run to completion.
 *
 * Every exit from a placement routes through here so all four agree: without a
 * single definition, a missed exit leaves a Building Spree stuck in `place_tile`
 * forever. Returns `place_tile` only while the spree has tiles left in its
 * budget *and* the player still holds one they could legally play; `buy_stock`
 * otherwise, which is also today's answer whenever no card is active.
 */
export function phaseAfterPlacement(opts: {
  activePowerCard: ActivePowerCard | null;
  tilesPlacedThisTurn: number;
  playerTiles: TileId[];
  board: Record<string, any>;
  chains: Record<string, any>;
  rules: CustomRules;
}): 'place_tile' | 'buy_stock' {
  const { activePowerCard, tilesPlacedThisTurn, playerTiles, board, chains, rules } = opts;

  if (!isMultiTileActive(activePowerCard)) return 'buy_stock';
  if ((tilesPlacedThisTurn ?? 0) >= MULTI_TILE_LIMIT) return 'buy_stock';

  const { boardRows, boardColsCount } = getBoardDimensions(rules);
  const eligibleChains: ChainName[] = getEligibleChains(rules);

  // Out of playable tiles mid-spree simply ends the spree. The unplayable-tile
  // modal is for the *start* of a turn and must not appear here.
  const hasPlayable = (playerTiles ?? []).some((tileId) =>
    isTilePlayable({ tileId, board, chains, eligibleChains, boardRows, boardColsCount }),
  );

  return hasPlayable ? 'place_tile' : 'buy_stock';
}
