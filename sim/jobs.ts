// =============================================================================
// jobs — the unit of work a worker thread executes
// =============================================================================
// Two shapes cover the whole study: a batch of games (base-game sweeps, seat
// fairness, round-robins) and a card (every lever cell of one card, across the
// corpus). Cards are sharded whole rather than by cell so a worker computes the
// baseline arm for a position once and reuses it across that card's cells.
//
// A job carries a *description* of the corpus, not the corpus itself. Corpus
// construction is deterministic in its seeds, so every worker rebuilds an
// identical one for a few hundred milliseconds instead of shipping megabytes of
// board state across the thread boundary.
// =============================================================================

import type { PolicyName } from './policies';
import type { PoolConfig } from './effects';
import type { CardCell } from './valuation';
import type { GameRecord } from './metrics';
import type { DeckRecord, DeckMode } from './deck-study';
import type { DeckPolicyName } from './deck';

export interface CorpusSpec {
  seats: PolicyName[];
  games: number;
  seedBase: number;
  perGame: number;
}

export interface BatchJob {
  kind: 'batch';
  label: string;
  seats: PolicyName[];
  games: number;
  seedBase: number;
  rules?: Record<string, string>;
}

export interface CardJob {
  kind: 'card';
  cardId: string;
  corpus: CorpusSpec;
  rollouts: number;
  seedBase: number;
  config: PoolConfig;
  leverCap: number;
}

export interface LambdaJob {
  kind: 'lambda';
  corpus: CorpusSpec;
  states: number;
  /** Which slice of the corpus this job takes, so lambda can be sharded like everything else. */
  offset: number;
  rollouts: number;
  seedBase: number;
}

/**
 * One cell of the deck study, or a slice of one. A job carries seeds rather
 * than games: the seat rotation is expanded inside the worker, so every seed's
 * four rotations stay on one thread and a shard is always a whole number of
 * matched sets.
 */
export interface DeckJob {
  kind: 'deck';
  label: string;
  cell: string;
  seats: PolicyName[];
  seeds: number[];
  /** Seat positions the deck holder rotates through. Ignored when mode is 'all-seats'. */
  rotations: number[];
  mode: DeckMode;
  policy: DeckPolicyName;
  price: number;
}

export type Job = BatchJob | CardJob | LambdaJob | DeckJob;

export type JobResult =
  | { kind: 'batch'; label: string; records: GameRecord[] }
  | { kind: 'card'; cardId: string; cells: CardCell[] }
  | { kind: 'deck'; cell: string; records: DeckRecord[] }
  | { kind: 'lambda'; lambda: number; lo: number; hi: number; perState: { id: string; lambda: number; round: number; stratum: string }[] };
