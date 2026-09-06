// =============================================================================
// metrics — what a finished game is worth, scored exactly as production scores it
// =============================================================================
// Final standings come from calculateFinalScores (server/lib/rules.ts), the same
// function the game-over screen and the statistics dashboard use. Re-deriving
// the arithmetic here would let the study and the product disagree about who
// won, which is the one thing a fairness model cannot afford.
// =============================================================================

import {
  type ChainName,
  CHAINS,
  calculateFinalScores,
  getStockPrice,
  getBonusTier,
  normalizeRules,
} from '../server/lib/rules';
import type { Sim } from './harness';

export interface SeatScore {
  seat: number;
  label: string;
  /** Cash + liquidated shares + end-of-game bonuses. The number that decides the winner. */
  netWorth: number;
  cash: number;
  stockValue: number;
}

export interface GameRecord {
  seed: number;
  outcome: string;
  stallReason: string | null;
  rounds: number;
  mergers: number;
  moves: number;
  rejections: number;
  seats: SeatScore[];
  winners: number[];
  /** Sum of every seat's cash on hand, sampled once per round. The money-supply trace. */
  moneyInPlay: { round: number; total: number }[];
}

const ALL_CHAINS = Object.keys(CHAINS) as ChainName[];

/**
 * Score the seats of a game in whatever state it is in. Safe to call mid-game:
 * it answers "what would this table be worth if we stopped now", which is
 * exactly the quantity a rollout returns.
 */
export function scoreSeats(sim: Sim): SeatScore[] {
  const state = sim.state();
  const players = sim.players();
  const chains = state?.chains ?? {};
  const bonusTier = getBonusTier(normalizeRules(state?.rules_snapshot));

  // calculateFinalScores shallow-copies its input and then zeroes the stocks
  // object it was handed, so it is fed throwaway deep copies.
  const scored = calculateFinalScores(
    players.map((p) => ({
      id: `player-${p.player_index}`,
      name: p.player_name,
      cash: p.cash,
      stocks: { ...(p.stocks ?? {}) },
    })),
    chains,
    bonusTier,
  );
  const totalById = new Map<string, number>(scored.map((s: any) => [s.id, s.cash]));

  return players.map((p) => {
    let stockValue = 0;
    for (const chain of ALL_CHAINS) {
      const c = chains[chain];
      if (!c?.isActive) continue;
      const held = p.stocks?.[chain] ?? 0;
      if (held > 0) stockValue += held * getStockPrice(chain, c.tiles.length);
    }
    return {
      seat: p.player_index,
      label: sim.seats[p.player_index]?.label ?? 'unknown',
      netWorth: totalById.get(`player-${p.player_index}`) ?? p.cash,
      cash: p.cash,
      stockValue,
    };
  });
}

/** Every seat sharing the top score. Ties are split rather than broken arbitrarily. */
export function winnersOf(seats: SeatScore[]): number[] {
  const best = Math.max(...seats.map((s) => s.netWorth));
  return seats.filter((s) => s.netWorth === best).map((s) => s.seat);
}

/** Net worth of one seat — the scalar a rollout returns. */
export function netWorthOf(sim: Sim, seat: number): number {
  return scoreSeats(sim).find((s) => s.seat === seat)?.netWorth ?? 0;
}

/**
 * Track total cash held by players, once per round. Bank-sourced card effects
 * inflate this trace and player-sourced ones do not, which turns "is the ratio
 * deliberate?" (card doc §7 Q5) from a design opinion into a line on a chart.
 */
export function moneyTracker(): { hook: (ctx: { state: any; players: any[]; round: number }) => void; samples: { round: number; total: number }[] } {
  const samples: { round: number; total: number }[] = [];
  let lastRound = -1;
  return {
    samples,
    hook: (ctx) => {
      if (ctx.round === lastRound) return;
      lastRound = ctx.round;
      samples.push({ round: ctx.round, total: ctx.players.reduce((sum, p) => sum + (p.cash ?? 0), 0) });
    },
  };
}

export function recordOf(
  sim: Sim,
  seed: number,
  run: { outcome: string; stallReason: string | null; rounds: number; mergers: number; moves: number; rejections: number },
  moneyInPlay: { round: number; total: number }[] = [],
): GameRecord {
  const seats = scoreSeats(sim);
  return {
    seed,
    outcome: run.outcome,
    stallReason: run.stallReason,
    rounds: run.rounds,
    mergers: run.mergers,
    moves: run.moves,
    rejections: run.rejections,
    seats,
    winners: winnersOf(seats),
    moneyInPlay,
  };
}
