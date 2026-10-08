// =============================================================================
// stats — public, read-only aggregate statistics (Epic 16)
// =============================================================================
// This is the ONLY unauthenticated endpoint in the codebase. That is deliberate
// (the dashboard is public), and it carries three rules:
//
//   1. Every op is a SELECT. Nothing here writes.
//   2. Responses carry aggregates and display-name captions only — never a room
//      code, user id or session id, and never a per-game row for a game still
//      in progress. server/api/stats.test.ts asserts this on every payload.
//   3. Everything is cached in-process, so a refresh loop or a crawler cannot
//      turn the dashboard into a way to hammer Postgres.
//
// Reads only game_results / game_result_players, except `live`, which counts
// rows in game_rooms / game_players.
// =============================================================================

import { query } from '../lib/db';
import { getCorsHeaders, jsonResponse } from '../lib/cors';
import { serverError } from '../lib/errors';
import type {
  LiveStats, TotalsStats, RuleDistribution, ChainStat, EconomyStats,
  SeatTypeStat, RecordsStats, ActivityPoint, StatsOverview, SeatType,
} from '../../src/types/stats';
import type { ChainName } from '../../src/types/game';

// -----------------------------------------------------------------------------
// Cache — one entry per op. The live strip moves fast, everything else does not.
// -----------------------------------------------------------------------------
const CACHE_TTL_MS: Record<string, number> = { live: 15_000 };
const DEFAULT_TTL_MS = 60_000;

const cache = new Map<string, { expires: number; payload: unknown }>();

/**
 * A row as Postgres hands it back. Values arrive as strings (COUNT and AVG are
 * numeric/bigint over the wire), so every read below goes through one of the
 * coercers rather than being trusted as a number.
 */
type Row = Record<string, unknown>;

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.payload as T;
  const payload = await load();
  cache.set(key, { expires: Date.now() + (CACHE_TTL_MS[key] ?? DEFAULT_TTL_MS), payload });
  return payload;
}

/** Exposed for tests, which need a cold cache between cases. */
export function clearStatsCache(): void {
  cache.clear();
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
const round1 = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n * 10) / 10;
};

// -----------------------------------------------------------------------------
// Ops
// -----------------------------------------------------------------------------

/**
 * The only op that reads live tables. Counts only — no room codes, so this
 * cannot be used to find a game to join uninvited.
 */
async function getLive(): Promise<LiveStats> {
  const [rooms] = await query<Row>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'playing') AS games_in_progress,
       COUNT(*) FILTER (WHERE status = 'waiting') AS rooms_waiting,
       MAX(EXTRACT(EPOCH FROM (now() - created_at)) / 60)
         FILTER (WHERE status = 'playing') AS longest_minutes
     FROM game_rooms`,
  );
  const [players] = await query<Row>(
    `SELECT COUNT(*) AS players_in_game
       FROM game_players gp
       JOIN game_rooms gr ON gr.id = gp.room_id
      WHERE gr.status = 'playing' AND gp.is_bot = false AND gp.is_connected = true`,
  );
  return {
    gamesInProgress: num(rooms?.games_in_progress),
    roomsWaiting: num(rooms?.rooms_waiting),
    playersInGame: num(players?.players_in_game),
    longestRunningMinutes: rooms?.longest_minutes == null
      ? null
      : Math.round(Number(rooms.longest_minutes)),
  };
}

async function getTotals(): Promise<TotalsStats> {
  const [row] = await query<Row>(
    `SELECT
       COUNT(*) AS games_completed,
       COUNT(*) FILTER (WHERE ended_at >= date_trunc('day', now()))       AS games_today,
       COUNT(*) FILTER (WHERE ended_at >= now() - interval '7 days')      AS games_7d,
       COUNT(*) FILTER (WHERE ended_at >= now() - interval '30 days')     AS games_30d,
       AVG(duration_seconds) AS avg_duration,
       AVG(rounds)           AS avg_rounds,
       AVG(player_count)     AS avg_players,
       AVG(mergers_count)    AS avg_mergers
     FROM game_results`,
  );
  return {
    gamesCompleted: num(row?.games_completed),
    gamesToday: num(row?.games_today),
    games7d: num(row?.games_7d),
    games30d: num(row?.games_30d),
    avgDurationSeconds: row?.avg_duration == null ? null : Math.round(Number(row.avg_duration)),
    avgRounds: round1(row?.avg_rounds),
    avgPlayerCount: round1(row?.avg_players),
    avgMergers: round1(row?.avg_mergers),
  };
}

/**
 * Every rule key and the count of games played at each of its values, in one
 * pass over the rules JSONB. Booleans arrive as 'true'/'false' strings; the
 * dashboard labels them.
 */
async function getRules(): Promise<RuleDistribution> {
  const rows = await query<Row>(
    `SELECT kv.key AS rule, kv.value AS value, COUNT(*) AS games
       FROM game_results gr, LATERAL jsonb_each_text(gr.rules) kv
      GROUP BY 1, 2
      ORDER BY 1, 3 DESC`,
  );
  const dist: RuleDistribution = {};
  for (const r of rows) {
    (dist[String(r.rule)] ??= {})[String(r.value)] = num(r.games);
  }
  return dist;
}

async function getChains(): Promise<ChainStat[]> {
  const rows = await query<Row>(
    `SELECT c.key AS chain,
            COUNT(*) FILTER (WHERE c.value::int > 0)          AS times_founded,
            COUNT(*) FILTER (WHERE gr.largest_chain = c.key)  AS times_largest,
            AVG(NULLIF(c.value::int, 0))                      AS avg_size,
            MAX(c.value::int)                                 AS max_size
       FROM game_results gr, LATERAL jsonb_each_text(gr.final_chains) c
      GROUP BY 1
      ORDER BY 3 DESC`,
  );
  return rows.map((r) => ({
    chain: r.chain as ChainName,
    timesFounded: num(r.times_founded),
    timesLargest: num(r.times_largest),
    avgSize: round1(r.avg_size),
    maxSize: numOrNull(r.max_size),
  }));
}

async function getEconomy(): Promise<EconomyStats> {
  const [agg] = await query<Row>(
    `SELECT AVG(winning_total) AS avg_total,
            MAX(winning_total) AS max_total,
            MIN(winning_total) AS min_total
       FROM game_results WHERE winning_total IS NOT NULL`,
  );
  const [spread] = await query<Row>(
    `SELECT AVG(spread) AS avg_spread FROM (
       SELECT MAX(final_total) - MIN(final_total) AS spread
         FROM game_result_players GROUP BY result_id
     ) s`,
  );
  const buckets = await query<Row>(
    `SELECT (winning_total / 10000) * 10000 AS bucket, COUNT(*) AS games
       FROM game_results
      WHERE winning_total IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
  );
  return {
    avgWinningTotal: agg?.avg_total == null ? null : Math.round(Number(agg.avg_total)),
    maxWinningTotal: numOrNull(agg?.max_total),
    minWinningTotal: numOrNull(agg?.min_total),
    avgSpread: spread?.avg_spread == null ? null : Math.round(Number(spread.avg_spread)),
    buckets: buckets.map((b) => ({ from: num(b.bucket), count: num(b.games) })),
  };
}

/**
 * Human vs bot outcomes by seat. bot_difficulty has been written since bots
 * shipped but was never read back — this is the first look at whether the
 * difficulty levels actually differ.
 */
async function getBots(): Promise<SeatTypeStat[]> {
  const rows = await query<Row>(
    `SELECT CASE WHEN is_bot THEN COALESCE(bot_difficulty, 'medium') ELSE 'human' END AS seat_type,
            COUNT(*)                            AS seats,
            COUNT(*) FILTER (WHERE placement = 1) AS wins,
            AVG(placement)                      AS avg_placement,
            AVG(final_total)                    AS avg_total
       FROM game_result_players
      GROUP BY 1`,
  );
  const order: SeatType[] = ['human', 'hard', 'medium', 'easy'];
  return rows
    .map((r) => {
      const seats = num(r.seats);
      return {
        seatType: r.seat_type as SeatType,
        seats,
        wins: num(r.wins),
        winRate: seats > 0 ? num(r.wins) / seats : 0,
        avgPlacement: round1(r.avg_placement),
        avgTotal: r.avg_total == null ? null : Math.round(Number(r.avg_total)),
      };
    })
    .sort((a, b) => order.indexOf(a.seatType) - order.indexOf(b.seatType));
}

/**
 * Hall of fame. A name here captions an event; it is not a claim that a
 * particular person holds a rank — player_name is free text typed per room,
 * which is exactly why there is no leaderboard.
 */
async function getRecords(): Promise<RecordsStats> {
  const [highest] = await query<Row>(
    `SELECT p.display_name, p.final_total AS value, r.ended_at
       FROM game_result_players p JOIN game_results r ON r.id = p.result_id
      ORDER BY p.final_total DESC LIMIT 1`,
  );
  const [longest] = await query<Row>(
    `SELECT winner_name AS display_name, duration_seconds AS value, ended_at
       FROM game_results WHERE duration_seconds IS NOT NULL
      ORDER BY duration_seconds DESC LIMIT 1`,
  );
  const [rounds] = await query<Row>(
    `SELECT winner_name AS display_name, rounds AS value, ended_at
       FROM game_results WHERE rounds IS NOT NULL
      ORDER BY rounds DESC LIMIT 1`,
  );
  const [chain] = await query<Row>(
    `SELECT winner_name AS display_name, largest_chain_size AS value, ended_at, largest_chain
       FROM game_results WHERE largest_chain_size IS NOT NULL
      ORDER BY largest_chain_size DESC LIMIT 1`,
  );
  const [blowout] = await query<Row>(
    `SELECT r.winner_name AS display_name, s.spread AS value, r.ended_at
       FROM (SELECT result_id, MAX(final_total) - MIN(final_total) AS spread
               FROM game_result_players GROUP BY result_id) s
       JOIN game_results r ON r.id = s.result_id
      ORDER BY s.spread DESC LIMIT 1`,
  );

  const entry = (row: Row | undefined, detail?: string | null) => row ? {
    name: (row.display_name as string | null) ?? null,
    value: num(row.value),
    at: row.ended_at ? new Date(row.ended_at as string).toISOString() : null,
    detail: detail ?? null,
  } : null;

  return {
    highestScore: entry(highest),
    longestGame: entry(longest),
    mostRounds: entry(rounds),
    largestChain: entry(chain, (chain?.largest_chain as string | null) ?? null),
    biggestBlowout: entry(blowout),
  };
}

/** 30 days, gap-filled server-side so the chart never has to guess. */
async function getActivity(): Promise<ActivityPoint[]> {
  const rows = await query<Row>(
    `SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COUNT(gr.id) AS games
       FROM generate_series(now()::date - interval '29 days', now()::date, interval '1 day') d
       LEFT JOIN game_results gr ON date_trunc('day', gr.ended_at) = d
      GROUP BY 1 ORDER BY 1`,
  );
  return rows.map((r) => ({ day: r.day as string, games: num(r.games) }));
}

async function getOverview(): Promise<StatsOverview> {
  const [totals, rules, chains, economy, bots, records, activity, since] = await Promise.all([
    getTotals(), getRules(), getChains(), getEconomy(), getBots(), getRecords(), getActivity(),
    query<Row>('SELECT MIN(ended_at) AS since FROM game_results'),
  ]);
  return {
    totals, rules, chains, economy, bots, records, activity,
    meta: {
      countingSince: since[0]?.since ? new Date(since[0].since as string).toISOString() : null,
      generatedAt: new Date().toISOString(),
    },
  };
}

const OPS: Record<string, () => Promise<unknown>> = {
  live: getLive,
  totals: getTotals,
  rules: getRules,
  chains: getChains,
  economy: getEconomy,
  bots: getBots,
  records: getRecords,
  activity: getActivity,
  overview: getOverview,
};

export default async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  // No verifyAuth: the dashboard is public and every op below is a SELECT.

  try {
    const body = await req.json().catch(() => ({})) as { op?: unknown };
    const op = String(body?.op ?? 'overview');
    const load = OPS[op];
    if (!load) return jsonResponse({ error: `Unknown op: ${op}` }, 400, cors);

    return jsonResponse(await cached(op, load), 200, cors);
  } catch (err) {
    return serverError('stats error', err, cors);
  }
};
