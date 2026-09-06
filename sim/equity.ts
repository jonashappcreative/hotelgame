// =============================================================================
// equity — what a position is worth, and what changing it is worth
// =============================================================================
// Three ideas, in order of dependency.
//
// 1. equity(state, seat, n): clone the position, play it out n times with the
//    standard policy population, average the result. Flat Monte-Carlo rollout —
//    classical search, no learning, no model. It is affordable only because a
//    position is a few small plain objects and a rollout is a partial game.
//
// 2. Paired counterfactual: value(effect) = equity(after) - equity(before),
//    with both arms replayed on identical seed sequences. Common random numbers
//    is not an optimisation detail here, it is what makes the measurement
//    possible at all: final net worth has a standard deviation around $15k, so
//    resolving a $500 card unpaired would need tens of thousands of rollouts per
//    state. Paired, the tile-bag luck is identical in both arms and cancels, and
//    a few hundred rollouts resolve the same effect.
//
// 3. lambda: the marginal value of a dollar. Cash compounds through shares and
//    bonuses, so $1 of cash is not $1 of final score. Measuring
//    d(final net worth)/d(cash) gives the exchange rate that makes price and
//    value commensurable — a card is priced at par when its expected value is
//    lambda x its price. The sell-back-factor question and the card-pricing
//    question then become the same question, answered with the same instrument.
// =============================================================================

import { Sim, type SeatSpec, type TurnHook, type SimOptions } from './harness';
import type { Tables } from './memory-db';
import { scoreSeats, winnersOf } from './metrics';
import { reseed } from './rng';
import { meanInterval, paired, type PairedResult } from './stats';

export interface RolloutOutcome {
  /** Net worth per seat index. */
  netWorth: number[];
  /** Seats sharing the top score; a tie credits each of them a fractional win. */
  winners: number[];
  rounds: number;
  finished: boolean;
}

export interface RolloutOptions {
  onTurnStart?: TurnHook;
  onDecision?: (ctx: TurnContextWithPhase) => void;
  maxMoves?: number;
}

export type TurnContextWithPhase = Parameters<NonNullable<SimOptions['onDecision']>>[0];

/**
 * Play one game out from a snapshot. The Sim is rebuilt rather than reused so a
 * rollout can never leak state into the position it branched from.
 */
export async function rolloutFrom(
  tables: Tables,
  seats: SeatSpec[],
  seed: number,
  opts: RolloutOptions = {},
): Promise<RolloutOutcome> {
  const simOpts: SimOptions = {
    seats, seed,
    onTurnStart: opts.onTurnStart,
    onDecision: opts.onDecision,
    maxMoves: opts.maxMoves,
  };
  const sim = new Sim(simOpts);
  sim.activate();
  sim.restore(tables);
  reseed(seed);
  const result = await sim.run();
  const scored = scoreSeats(sim);
  const netWorth: number[] = [];
  for (const s of scored) netWorth[s.seat] = s.netWorth;
  return {
    netWorth,
    winners: winnersOf(scored),
    rounds: result.rounds,
    finished: result.outcome === 'finished',
  };
}

export interface EquitySample {
  /** rollout index -> seat -> net worth. */
  netWorth: number[][];
  /** rollout index -> seat -> 1 / (share of a tie) / 0. */
  win: number[][];
  seeds: number[];
}

/**
 * n rollouts from one position, on a fixed seed sequence. Two calls with the
 * same `seedBase` and `n` replay the same luck, which is what pairs the arms of
 * a counterfactual.
 */
export async function equity(
  tables: Tables,
  seats: SeatSpec[],
  seedBase: number,
  n: number,
  opts: RolloutOptions = {},
): Promise<EquitySample> {
  const netWorth: number[][] = [];
  const win: number[][] = [];
  const seeds: number[] = [];
  for (let i = 0; i < n; i++) {
    const seed = seedBase + i;
    seeds.push(seed);
    const out = await rolloutFrom(tables, seats, seed, opts);
    netWorth.push(out.netWorth);
    win.push(seats.map((_, seat) => (out.winners.includes(seat) ? 1 / out.winners.length : 0)));
  }
  return { netWorth, win, seeds };
}

export function seatColumn(sample: EquitySample, seat: number, field: 'netWorth' | 'win' = 'netWorth'): number[] {
  return sample[field].map((row) => row[seat] ?? 0);
}

export interface CounterfactualValue {
  /** The buyer's number: expected change in final net worth, in dollars. */
  buyer: PairedResult;
  /** Per-seat change in win probability. A skewed profile across opponents is what kingmaking looks like. */
  winDelta: { seat: number; delta: PairedResult }[];
  /** Per-rollout paired differences for the acting seat — the distribution the band tests read. */
  diffs: number[];
  n: number;
}

/**
 * A treatment is the card: a one-off patch to the position plus, where the
 * effect is windowed or permanent, hooks that keep acting as the game plays on.
 * Hooks carry state ("the next merger", "for four rounds"), so a fresh one is
 * built for every rollout rather than shared across them.
 */
export interface Treatment {
  patch: (tables: Tables) => void;
  onTurnStart?: TurnHook;
  onDecision?: (ctx: TurnContextWithPhase) => void;
}

export type TreatmentFactory = () => Treatment;

/** The treated arm: n rollouts, each from its own freshly patched copy of the position. */
export async function equityUnderTreatment(
  tables: Tables,
  seats: SeatSpec[],
  seedBase: number,
  n: number,
  makeTreatment: TreatmentFactory,
): Promise<EquitySample> {
  const netWorth: number[][] = [];
  const win: number[][] = [];
  const seeds: number[] = [];
  for (let i = 0; i < n; i++) {
    const seed = seedBase + i;
    seeds.push(seed);
    const treatment = makeTreatment();
    const patched = cloneTables(tables);
    treatment.patch(patched);
    const out = await rolloutFrom(patched, seats, seed, {
      onTurnStart: treatment.onTurnStart,
      onDecision: treatment.onDecision,
    });
    netWorth.push(out.netWorth);
    win.push(seats.map((_, seat) => (out.winners.includes(seat) ? 1 / out.winners.length : 0)));
  }
  return { netWorth, win, seeds };
}

/**
 * The measurement. Both arms replay the same seed sequence, so the difference
 * between them is the treatment and nothing else.
 */
export async function counterfactual(opts: {
  tables: Tables;
  seats: SeatSpec[];
  seat: number;
  seedBase: number;
  n: number;
  treatment: TreatmentFactory;
  /** Reuse a baseline computed once and shared across every card and lever cell. */
  baseline?: EquitySample;
}): Promise<CounterfactualValue> {
  const { tables, seats, seat, seedBase, n, treatment } = opts;

  const before = opts.baseline ?? (await equity(tables, seats, seedBase, n));
  const after = await equityUnderTreatment(tables, seats, seedBase, n, treatment);

  const buyer = paired(seatColumn(after, seat), seatColumn(before, seat));
  const winDelta = seats.map((_, s) => ({
    seat: s,
    delta: paired(seatColumn(after, s, 'win'), seatColumn(before, s, 'win')),
  }));

  const beforeCol = seatColumn(before, seat);
  const afterCol = seatColumn(after, seat);
  return {
    buyer,
    winDelta,
    diffs: afterCol.map((v, i) => v - beforeCol[i]),
    n,
  };
}

export function cloneTables(tables: Tables): Tables {
  const out: Tables = {};
  for (const key of Object.keys(tables)) out[key] = JSON.parse(JSON.stringify(tables[key]));
  return out;
}

// -----------------------------------------------------------------------------
// lambda
// -----------------------------------------------------------------------------

export interface LambdaEstimate {
  /** Dollars of final net worth per dollar of cash in hand. */
  lambda: number;
  lo: number;
  hi: number;
  /** Per-state estimates, so the phase-dependence of lambda is visible rather than averaged away. */
  perState: { id: string; lambda: number; round: number; stratum: string }[];
}

/** Grant used to measure the derivative. Large enough to buy real shares, small enough to stay local. */
export const LAMBDA_PROBE = 1000;

export async function estimateLambda(opts: {
  states: { id: string; tables: Tables; seat: number; round: number; stratum: string }[];
  seats: SeatSpec[];
  n: number;
  seedBase: number;
  baselines?: Map<string, EquitySample>;
}): Promise<LambdaEstimate> {
  const perState: LambdaEstimate['perState'] = [];
  const all: number[] = [];

  for (const state of opts.states) {
    const value = await counterfactual({
      tables: state.tables,
      seats: opts.seats,
      seat: state.seat,
      seedBase: opts.seedBase,
      n: opts.n,
      baseline: opts.baselines?.get(state.id),
      treatment: () => ({ patch: (tables) => grantCash(tables, state.seat, LAMBDA_PROBE) }),
    });
    const perDollar = value.diffs.map((d) => d / LAMBDA_PROBE);
    all.push(...perDollar);
    perState.push({
      id: state.id,
      lambda: value.buyer.mean / LAMBDA_PROBE,
      round: state.round,
      stratum: state.stratum,
    });
  }

  const est = meanInterval(all);
  return { lambda: est.mean, lo: est.lo, hi: est.hi, perState };
}

/** The one state patch every other one is calibrated against. */
export function grantCash(tables: Tables, seat: number, amount: number): void {
  const player = (tables.game_players ?? []).find((p) => p.player_index === seat);
  if (player) player.cash += amount;
}
