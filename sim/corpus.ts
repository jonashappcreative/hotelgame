// =============================================================================
// corpus — the population of positions a card is priced across
// =============================================================================
// "What is this card worth" has no answer without saying *where*. A card is
// worth one thing on turn 3 with $6,000 and no chains on the board, and another
// on turn 25 holding a contested majority. The corpus is a stratified sample of
// real decision points taken from baseline games, so every card's mean is
// averaged over states a player would actually be in — and the phase-conditional
// profile falls out for free, which is what answers the card doc's open question
// about whether price needs to scale with game phase.
//
// Sampled at the top of a turn (the place_tile decision), because that is where
// a card bought a round earlier would be played under the one-round delay the
// access rules assume.
// =============================================================================

import { Sim, type SeatSpec } from './harness';
import type { Tables } from './memory-db';
import { scoreSeats } from './metrics';
import { randInt } from './rng';

export type GamePhase = 'early' | 'mid' | 'late';
export type Standing = 'leading' | 'trailing';

export interface CorpusState {
  id: string;
  tables: Tables;
  /** The seat on turn — the hypothetical card buyer. */
  seat: number;
  round: number;
  phase: GamePhase;
  standing: Standing;
  stratum: string;
  /** Snapshot facts, cached so legality predicates do not have to re-derive them. */
  activeChains: number;
  cash: number;
  gameSeed: number;
}

/**
 * Round boundaries for the three phases. Chosen from the baseline length
 * distribution rather than picked round numbers: the median game runs into the
 * low twenties, so these cut it into thirds that each contain real decisions.
 */
export const PHASE_BOUNDS = { earlyMax: 6, midMax: 14 };

function phaseOf(round: number): GamePhase {
  if (round <= PHASE_BOUNDS.earlyMax) return 'early';
  if (round <= PHASE_BOUNDS.midMax) return 'mid';
  return 'late';
}

export interface CorpusOptions {
  seats: SeatSpec[];
  games: number;
  seedBase: number;
  /** Positions kept per game. Spread across the game rather than clustered. */
  perGame: number;
  rules?: Record<string, unknown>;
}

/**
 * Play `games` baseline games, keeping `perGame` positions from each. Reservoir
 * sampling over the turns of a game, so the keep decision does not need to know
 * how long the game will run — which matters, because game length varies by
 * nearly a factor of two and taking the first N turns would sample only openings.
 */
export async function buildCorpus(opts: CorpusOptions): Promise<CorpusState[]> {
  const out: CorpusState[] = [];

  for (let g = 0; g < opts.games; g++) {
    const seed = opts.seedBase + g;
    const reservoir: { tables: Tables; seat: number; round: number }[] = [];
    let seen = 0;
    let lastKey = '';

    const sim = new Sim({
      seats: opts.seats,
      seed,
      rules: opts.rules as any,
      onDecision: (ctx) => {
        if (ctx.phase !== 'place_tile') return;
        const key = `${ctx.round}:${ctx.seat}`;
        if (key === lastKey) return;
        lastKey = key;
        seen++;
        const candidate = { tables: ctx.db.snapshot(), seat: ctx.seat, round: ctx.round };
        if (reservoir.length < opts.perGame) {
          reservoir.push(candidate);
        } else {
          const slot = randInt(seen);
          if (slot < opts.perGame) reservoir[slot] = candidate;
        }
      },
    });
    await sim.setup();
    await sim.run();

    for (let i = 0; i < reservoir.length; i++) {
      const entry = reservoir[i];
      out.push(describe(entry.tables, entry.seat, entry.round, `g${g}s${i}`, seed));
    }
  }

  return out;
}

/** Attach the strata and the cached facts a legality predicate needs. */
function describe(tables: Tables, seat: number, round: number, id: string, gameSeed: number): CorpusState {
  const players = [...(tables.game_players ?? [])].sort((a, b) => a.player_index - b.player_index);
  const state = (tables.game_states ?? [])[0] ?? {};
  const chains = state.chains ?? {};

  // Standing is by current liquidation value, not cash: a player holding a
  // contested majority is leading even with an empty wallet.
  const ranked = rankByNetWorth(tables);
  const rank = ranked.indexOf(seat);
  const standing: Standing = rank < Math.ceil(ranked.length / 2) ? 'leading' : 'trailing';
  const gamePhase = phaseOf(round);

  return {
    id,
    tables,
    seat,
    round,
    phase: gamePhase,
    standing,
    stratum: `${gamePhase}/${standing}`,
    activeChains: Object.values(chains).filter((c: any) => c?.isActive).length,
    cash: players.find((p) => p.player_index === seat)?.cash ?? 0,
    gameSeed,
  };
}

/** Seats ordered best-first by what they would score if the game stopped now. */
export function rankByNetWorth(tables: Tables): number[] {
  const fake = {
    state: () => (tables.game_states ?? [])[0],
    players: () => [...(tables.game_players ?? [])].sort((a, b) => a.player_index - b.player_index),
    seats: [] as any[],
  } as unknown as Sim;
  return scoreSeats(fake)
    .sort((a, b) => b.netWorth - a.netWorth)
    .map((s) => s.seat);
}

/** Corpus composition, for the report — a corpus skewed to one stratum invalidates every mean drawn from it. */
export function corpusProfile(corpus: CorpusState[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of corpus) counts[s.stratum] = (counts[s.stratum] ?? 0) + 1;
  return counts;
}
