// =============================================================================
// results — writes the durable record of a finished game (Epic 16)
// =============================================================================
// A finished game is an immutable historical fact, so it is stored in
// game_results / game_result_players, which hold no foreign key to game_rooms.
// The room itself is deleted by cleanup-rooms ~10 minutes after the last
// heartbeat; the record has to outlive it.
//
// Recording is idempotent on source_room_id, because a game reaches 'game_over'
// down several code paths and the caller may fire more than once. Every entry
// point below is safe to call repeatedly.
//
// Nothing in here may ever break a game: recordGameResult swallows its own
// errors after logging them. Statistics are worth strictly less than a playable
// turn.
// =============================================================================

import { readFileSync } from 'fs';
import { join } from 'path';
import { query, withTransaction } from './db';
import {
  type ChainName,
  CHAINS,
  normalizeRules,
  getBonusTier,
  getStockPrice,
  calculateFinalScores,
} from './rules';

export type EndReason = 'threshold' | 'vote' | 'auto' | 'unknown';

/** A row as Postgres hands it back; every read is coerced at the point of use. */
type Row = Record<string, any>;

/** Log actions that mark one completed merger (see game-action.ts). */
const MERGER_LOG_ACTIONS = new Set(['Merger complete', 'Merger auto-resolved']);

// Read once at startup. Recorded per game so a later rules change can be
// correlated with a shift in outcomes — impossible to add retroactively.
const APP_VERSION: string | null = (() => {
  try {
    const pkg = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    const version = JSON.parse(pkg)?.version;
    return typeof version === 'string' ? version.slice(0, 16) : null;
  } catch {
    return null;
  }
})();

/**
 * Map the action that ended the game to the reason we store. The engine reaches
 * 'game_over' from a merger/placement threshold, a majority end-game vote, or
 * the turn timer auto-ending a turn.
 */
export function endReasonForAction(action: string): EndReason {
  if (action === 'end_game_vote') return 'vote';
  if (action === 'auto_end_turn') return 'auto';
  return 'threshold';
}

interface ScoredSeat {
  seat_index: number;
  display_name: string;
  user_id: string | null;
  is_bot: boolean;
  bot_difficulty: string | null;
  final_cash: number;
  final_stock_value: number;
  final_bonus_total: number;
  final_total: number;
  stocks: Record<string, number>;
}

/**
 * Score every seat the way the game-over screen does, but keeping the parts
 * separate: cash on hand, what the shares liquidate for, and what the majority
 * and minority bonuses added. calculateFinalScores only returns the combined
 * total, and it mutates the `stocks` object it is handed (shallow copy), so it
 * is fed throwaway deep copies here.
 */
export function scoreSeats(
  players: Row[],
  chains: Record<string, any>,
  bonusTier: string,
): ScoredSeat[] {
  const stocksBySeat = new Map<number, Record<string, number>>(
    players.map((p) => [p.player_index, { ...(p.stocks ?? {}) }]),
  );

  const scored = calculateFinalScores(
    players.map((p) => ({
      id: `player-${p.player_index}`,
      name: p.player_name,
      cash: p.cash,
      stocks: { ...(p.stocks ?? {}) },
    })),
    chains as Record<ChainName, any>,
    bonusTier,
  );
  const totalById = new Map<string, number>(scored.map((s: Row) => [s.id, s.cash]));

  return players.map((p) => {
    const stocks = stocksBySeat.get(p.player_index) ?? {};
    let stockValue = 0;
    for (const chain of Object.values(chains ?? {}) as Row[]) {
      if (!chain?.isActive) continue;
      const held = stocks[chain.name] ?? 0;
      if (held > 0) stockValue += held * getStockPrice(chain.name as ChainName, chain.tiles.length);
    }
    const total = totalById.get(`player-${p.player_index}`) ?? p.cash;
    return {
      seat_index: p.player_index,
      display_name: p.player_name,
      user_id: p.user_id ?? null,
      is_bot: !!p.is_bot,
      bot_difficulty: p.bot_difficulty ?? null,
      final_cash: p.cash,
      final_stock_value: stockValue,
      // Whatever the engine added beyond cash and liquidated shares is bonus
      // money; deriving it keeps this in step with all three bonus tiers.
      final_bonus_total: Math.max(0, total - p.cash - stockValue),
      final_total: total,
      stocks,
    };
  });
}

/** Chain sizes at game end — 0 for a chain that was never founded or was absorbed. */
export function summariseChains(chains: Record<string, Row>): {
  finalChains: Record<string, number>;
  largest: { name: string; size: number } | null;
} {
  const finalChains: Record<string, number> = {};
  let largest: { name: string; size: number } | null = null;

  for (const name of Object.keys(CHAINS)) {
    const chain = chains?.[name];
    const size = chain?.isActive ? (chain.tiles?.length ?? 0) : 0;
    finalChains[name] = size;
    if (size > 0 && (!largest || size > largest.size)) largest = { name, size };
  }
  return { finalChains, largest };
}

/**
 * Record a finished game. Safe to call on a room that is not over (no-op), on
 * one already recorded (no-op), or twice concurrently (the unique index on
 * source_room_id decides). Never throws.
 *
 * @returns true when this call is the one that wrote the record.
 */
export async function recordGameResult(
  roomId: string,
  endReason: EndReason = 'unknown',
): Promise<boolean> {
  try {
    const [room] = await query<Row>(
      'SELECT id, room_code, created_at FROM game_rooms WHERE id = $1',
      [roomId],
    );
    if (!room) return false;

    const [state] = await query<Row>(
      `SELECT phase, chains, game_log, round_number, rules_snapshot, updated_at
         FROM game_states WHERE room_id = $1`,
      [roomId],
    );
    if (!state || state.phase !== 'game_over') return false;

    // Cheap pre-check so the common "already recorded" path costs one indexed
    // lookup instead of a transaction. The unique index is still the authority.
    const existing = await query<{ id: string }>(
      'SELECT id FROM game_results WHERE source_room_id = $1',
      [roomId],
    );
    if (existing.length > 0) return false;

    const players = await query<Row>(
      `SELECT player_index, player_name, user_id, is_bot, bot_difficulty, cash, stocks
         FROM game_players WHERE room_id = $1 ORDER BY player_index`,
      [roomId],
    );
    if (players.length === 0) return false;

    const rules = normalizeRules(state.rules_snapshot);
    const chains = state.chains ?? {};
    const seats = scoreSeats(players, chains, getBonusTier(rules));
    const ranked = [...seats].sort((a, b) => b.final_total - a.final_total);
    const winner = ranked[0];

    const { finalChains, largest } = summariseChains(chains);
    const gameLog: Row[] = Array.isArray(state.game_log) ? state.game_log : [];
    const mergers = gameLog.filter((e) => MERGER_LOG_ACTIONS.has(e?.action)).length;

    const endedAt: Date = state.updated_at ? new Date(state.updated_at) : new Date();
    const startedAt: Date | null = room.created_at ? new Date(room.created_at) : null;
    const durationSeconds = startedAt
      ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
      : null;

    return await withTransaction(async (exec) => {
      const inserted = await exec(
        `INSERT INTO game_results (
           source_room_id, room_code, started_at, ended_at, duration_seconds, rounds,
           end_reason, player_count, human_count, bot_count,
           winner_name, winner_is_bot, winner_difficulty, winning_total,
           rules, final_chains, mergers_count, largest_chain, largest_chain_size, app_version
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11, $12, $13, $14,
           $15::jsonb, $16::jsonb, $17, $18, $19, $20
         )
         ON CONFLICT (source_room_id) DO NOTHING
         RETURNING id`,
        [
          roomId, room.room_code, startedAt, endedAt, durationSeconds, state.round_number ?? 0,
          endReason, seats.length, seats.filter((s) => !s.is_bot).length, seats.filter((s) => s.is_bot).length,
          winner?.display_name ?? null, winner?.is_bot ?? null, winner?.bot_difficulty ?? null,
          winner?.final_total ?? null,
          JSON.stringify(rules), JSON.stringify(finalChains), mergers,
          largest?.name ?? null, largest?.size ?? null, APP_VERSION,
        ],
      );

      // Lost the race with a concurrent recorder — that call wrote the seats.
      if (inserted.length === 0) return false;
      const resultId = inserted[0].id;

      for (const seat of seats) {
        await exec(
          `INSERT INTO game_result_players (
             result_id, user_id, display_name, seat_index, is_bot, bot_difficulty,
             final_cash, final_stock_value, final_bonus_total, final_total, placement, stocks
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
          [
            resultId, seat.user_id, seat.display_name, seat.seat_index,
            seat.is_bot, seat.bot_difficulty,
            seat.final_cash, seat.final_stock_value, seat.final_bonus_total, seat.final_total,
            ranked.findIndex((r) => r.seat_index === seat.seat_index) + 1,
            JSON.stringify(seat.stocks),
          ],
        );
      }

      console.log(`results: recorded game ${room.room_code} (${seats.length}p, ${endReason})`);
      return true;
    });
  } catch (err) {
    // Deliberately swallowed: a statistics write must never fail a player's
    // action or block room cleanup.
    console.error('results: failed to record game result', err);
    return false;
  }
}

/**
 * Gate + record. One indexed lookup decides whether anything happened, so this
 * is cheap enough to call after every successful game action — which is how the
 * engine uses it. Recording at the single exit point rather than at each of the
 * seven sites that set phase = 'game_over' means a path added later cannot be
 * forgotten.
 */
export async function recordIfFinished(
  roomId: string,
  endReason: EndReason = 'unknown',
): Promise<boolean> {
  try {
    const rows = await query(
      `SELECT 1 FROM game_states WHERE room_id = $1 AND phase = 'game_over'`,
      [roomId],
    );
    if (rows.length === 0) return false;
    return await recordGameResult(roomId, endReason);
  } catch (err) {
    console.error('results: recordIfFinished failed', err);
    return false;
  }
}
