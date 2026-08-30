// =============================================================================
// Statistics types (Epic 16) — the contract for /api/stats and /dashboard
// =============================================================================
// Shared by the server handler (server/api/stats.ts), the sample-data generator
// (src/data/sampleStats.ts) and the dashboard panels, so the demo data and the
// live data are the same shape by construction — if one drifts, it stops
// compiling.
//
// Nothing here may carry an identifier. No room codes, no user ids, no session
// ids: /api/stats is the only unauthenticated endpoint in the codebase and it
// returns aggregates plus display-name captions on records, nothing more.
// =============================================================================

import type { ChainName } from './game';

/** Read straight from game_rooms — works from day one, before any game is recorded. */
export interface LiveStats {
  gamesInProgress: number;
  roomsWaiting: number;
  playersInGame: number;
  longestRunningMinutes: number | null;
}

export interface TotalsStats {
  gamesCompleted: number;
  gamesToday: number;
  games7d: number;
  games30d: number;
  avgDurationSeconds: number | null;
  avgRounds: number | null;
  avgPlayerCount: number | null;
  avgMergers: number | null;
}

/** { ruleKey: { value: gamesPlayedWithThatValue } }, e.g. chainSafety.none = 812. */
export type RuleDistribution = Record<string, Record<string, number>>;

export interface ChainStat {
  chain: ChainName;
  timesFounded: number;
  timesLargest: number;
  avgSize: number | null;
  maxSize: number | null;
}

export interface EconomyBucket {
  /** Inclusive lower bound of a 10,000-wide bucket of winning net worth. */
  from: number;
  count: number;
}

export interface EconomyStats {
  avgWinningTotal: number | null;
  maxWinningTotal: number | null;
  minWinningTotal: number | null;
  /** Mean gap between first and last place — how one-sided games tend to be. */
  avgSpread: number | null;
  buckets: EconomyBucket[];
}

export type SeatType = 'human' | 'easy' | 'medium' | 'hard';

export interface SeatTypeStat {
  seatType: SeatType;
  seats: number;
  wins: number;
  winRate: number;
  avgPlacement: number | null;
  avgTotal: number | null;
}

export interface RecordEntry {
  /** Display name captioning the event. Not an identity — see Epic 16. */
  name: string | null;
  value: number;
  at: string | null;
  /** Extra context, e.g. the chain that reached the record size. */
  detail?: string | null;
}

export interface RecordsStats {
  highestScore: RecordEntry | null;
  longestGame: RecordEntry | null;
  mostRounds: RecordEntry | null;
  largestChain: RecordEntry | null;
  biggestBlowout: RecordEntry | null;
}

export interface ActivityPoint {
  /** YYYY-MM-DD. */
  day: string;
  games: number;
}

export interface StatsMeta {
  /** Timestamp of the earliest recorded game — "counting since". */
  countingSince: string | null;
  generatedAt: string;
}

/** Everything except the live strip, refreshed on the slow interval. */
export interface StatsOverview {
  totals: TotalsStats;
  rules: RuleDistribution;
  chains: ChainStat[];
  economy: EconomyStats;
  bots: SeatTypeStat[];
  records: RecordsStats;
  activity: ActivityPoint[];
  meta: StatsMeta;
}

/**
 * Minimum recorded games before a panel is worth showing. Publishing a
 * 100%-Aggressive rules chart off two games would be worse than publishing
 * nothing, so panels below their threshold render a "needs N games" state.
 */
export const PANEL_MINIMUMS = {
  totals: 1,
  activity: 1,
  rules: 10,
  chains: 10,
  economy: 10,
  bots: 20,
  records: 1,
} as const;

export type PanelKey = keyof typeof PANEL_MINIMUMS;
