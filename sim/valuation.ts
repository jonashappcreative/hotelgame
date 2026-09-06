// =============================================================================
// valuation — a card's value distribution, and whether it lands in its band
// =============================================================================
// The card doc's definition of balanced is "expected value, averaged across the
// game states in which a player would actually buy it, sits inside the target
// band for its price class". That needs three numbers per card, not one:
//
//   Mean     E[value | legal] against lambda x price. The obvious check, and
//            the only one most balancing passes do.
//   Ceiling  P95 across states. This is what catches a card with a fair mean and
//            a broken tail — the jackpot turn in the right position that players
//            remember and resent.
//   Floor    the dead-draw rate. Catches the card that reads well and does
//            nothing: "steal a share" when nobody holds any, a short on a chain
//            that was never going to be absorbed.
//
// Plus one axis the doc does not have yet: the skill premium. Naive value is the
// mean over every legal state (what a player who plays the card when they draw
// it gets); optimal value is the mean over the best-timed window (what a player
// who waits gets). A large gap means the card rewards expertise; a gap near zero
// means it is a lottery ticket with rules text.
// =============================================================================

import type { SeatSpec } from './harness';
import type { CorpusState } from './corpus';
import {
  counterfactual, equity, type EquitySample, type CounterfactualValue,
} from './equity';
import {
  type CardDef, type Levers, type PoolConfig, DEFAULT_POOL_CONFIG, leverLabel,
} from './effects';
import { mean, meanInterval, percentile, type Interval } from './stats';
import { BANDS } from './thresholds';

export interface StateValue {
  stateId: string;
  stratum: string;
  phase: string;
  standing: string;
  round: number;
  value: number;
  /** Change in the buyer's own win probability. */
  buyerWinDelta: number;
  /**
   * Change in each opponent's win probability, indexed by seat offset from the
   * buyer. Kept relative to the buyer because the buyer's seat differs from
   * state to state, so absolute seat indices could not be averaged.
   */
  opponentWinDeltas: number[];
}

export interface CardCell {
  cardId: string;
  cardName: string;
  tier: 1 | 2 | 3;
  levers: Levers;
  leverLabel: string;
  /** Positions where the card could be played at all. */
  legalStates: number;
  totalStates: number;
  /** legalStates / totalStates — how often the card is live. */
  availability: number;
  rolloutsPerArm: number;

  mean: number;
  meanLo: number;
  meanHi: number;
  ceiling: number;
  /** Share of legal states where the card does approximately nothing. */
  deadRate: number;
  naive: number;
  optimal: number;
  skillPremium: number;

  byPhase: Record<string, number>;
  byStanding: Record<string, number>;

  /** Change in the buyer's own win probability. */
  buyerWinDelta: number;
  /** Change in each opponent's win probability, worst-hit first. The kingmaking column. */
  fieldWinDelta: number[];
  /** Spread across opponents. Uniform means the card hurts the field evenly; skewed means it picks a victim. */
  fieldSkew: number;

  states: StateValue[];
}

export interface CardVerdict {
  price: number;
  par: number;
  meanPass: boolean;
  ceilingPass: boolean;
  floorPass: boolean;
  pass: boolean;
  reasons: string[];
}

export interface ValuationOptions {
  card: CardDef;
  levers: Levers;
  corpus: CorpusState[];
  seats: SeatSpec[];
  rollouts: number;
  seedBase: number;
  config?: PoolConfig;
  /** Shared across every card and every lever cell — the baseline arm is computed once per state. */
  baselines?: Map<string, EquitySample>;
  /** Called after each position is valued, so a slow cell reports itself while it runs. */
  onState?: (done: number, legal: number, total: number) => void;
}

/** Compute (and memoise) the untreated arm for a state. Half of all rollouts, saved. */
export async function baselineFor(
  state: CorpusState, seats: SeatSpec[], seedBase: number, rollouts: number,
  cache?: Map<string, EquitySample>,
): Promise<EquitySample> {
  const cached = cache?.get(state.id);
  if (cached) return cached;
  const sample = await equity(state.tables, seats, seedBase, rollouts);
  cache?.set(state.id, sample);
  return sample;
}

export async function valueCard(opts: ValuationOptions): Promise<CardCell> {
  const config = opts.config ?? DEFAULT_POOL_CONFIG;
  const values: StateValue[] = [];
  let legal = 0;

  for (const state of opts.corpus) {
    const ctx = { tables: state.tables, seat: state.seat, levers: opts.levers, config };
    if (!opts.card.legal(ctx)) continue;
    legal++;

    const baseline = await baselineFor(state, opts.seats, opts.seedBase, opts.rollouts, opts.baselines);
    const result: CounterfactualValue = await counterfactual({
      tables: state.tables,
      seats: opts.seats,
      seat: state.seat,
      seedBase: opts.seedBase,
      n: opts.rollouts,
      baseline,
      // Rebuilt per rollout: hooks carry state, and the patch must land on a
      // fresh copy each time.
      treatment: () => opts.card.treatment(ctx),
    });

    values.push({
      stateId: state.id,
      stratum: state.stratum,
      phase: state.phase,
      standing: state.standing,
      round: state.round,
      value: result.buyer.mean,
      buyerWinDelta: result.winDelta[state.seat]?.delta.mean ?? 0,
      opponentWinDeltas: result.winDelta
        .filter((w) => w.seat !== state.seat)
        .sort((a, b) => ((a.seat - state.seat + opts.seats.length) % opts.seats.length)
          - ((b.seat - state.seat + opts.seats.length) % opts.seats.length))
        .map((w) => w.delta.mean),
    });
    opts.onState?.(values.length, legal, opts.corpus.length);
  }

  return summarise(opts, values, legal, config);
}

function summarise(opts: ValuationOptions, values: StateValue[], legal: number, _config: PoolConfig): CardCell {
  const raw = values.map((v) => v.value);
  const est = meanInterval(raw);
  const sorted = [...raw].sort((a, b) => a - b);

  // Optimal play is the mean over the best-timed window: the top quartile of
  // positions by realised value. Naive play is the mean over all of them.
  const cut = Math.max(1, Math.ceil(raw.length / 4));
  const optimal = mean(sorted.slice(-cut));

  const byPhase: Record<string, number> = {};
  const byStanding: Record<string, number> = {};
  for (const key of ['early', 'mid', 'late']) {
    const subset = values.filter((v) => v.phase === key).map((v) => v.value);
    if (subset.length) byPhase[key] = mean(subset);
  }
  for (const key of ['leading', 'trailing']) {
    const subset = values.filter((v) => v.standing === key).map((v) => v.value);
    if (subset.length) byStanding[key] = mean(subset);
  }

  const buyerWinDelta = mean(values.map((v) => v.buyerWinDelta));
  // Averaged by seat offset from the buyer, then sorted worst-hit first: a
  // denial card that spreads its damage evenly looks flat here, and one that
  // picks a victim shows a step. That step is the kingmaking signal.
  const opponentCount = Math.max(0, opts.seats.length - 1);
  const fieldWinDelta: number[] = [];
  for (let i = 0; i < opponentCount; i++) {
    fieldWinDelta.push(mean(values.map((v) => v.opponentWinDeltas[i] ?? 0)));
  }
  fieldWinDelta.sort((a, b) => a - b);
  const fieldSkew = fieldWinDelta.length > 1
    ? fieldWinDelta[fieldWinDelta.length - 1] - fieldWinDelta[0]
    : 0;

  return {
    cardId: opts.card.id,
    cardName: opts.card.name,
    tier: opts.card.tier,
    levers: opts.levers,
    leverLabel: leverLabel(opts.card, opts.levers),
    legalStates: legal,
    totalStates: opts.corpus.length,
    availability: opts.corpus.length ? legal / opts.corpus.length : 0,
    rolloutsPerArm: opts.rollouts,

    mean: est.mean,
    meanLo: est.lo,
    meanHi: est.hi,
    ceiling: percentile(raw, 0.95),
    deadRate: 0, // filled by applyBands, which needs par to define "approximately nothing"
    naive: est.mean,
    optimal,
    skillPremium: optimal - est.mean,

    byPhase,
    byStanding,
    buyerWinDelta,
    fieldWinDelta,
    fieldSkew,
    states: values,
  };
}

/**
 * Score a cell against a price. Separated from measurement on purpose: the same
 * value distribution is scored against $200 flat, against a tier price, and
 * against whatever a later pass decides — no re-simulation required.
 */
export function applyBands(cell: CardCell, price: number, lambda: number): CardVerdict {
  const par = price * lambda;
  const raw = cell.states.map((s) => s.value);
  const dead = raw.filter((v) => Math.abs(v) < BANDS.deadEpsilon * Math.max(par, 1)).length;
  cell.deadRate = raw.length ? dead / raw.length : 1;

  const reasons: string[] = [];
  const meanPass = Math.abs(cell.mean - par) <= BANDS.meanTolerance * par;
  if (!meanPass) {
    reasons.push(cell.mean > par
      ? `mean $${Math.round(cell.mean)} is above the band ceiling of $${Math.round(par * (1 + BANDS.meanTolerance))}`
      : `mean $${Math.round(cell.mean)} is below the band floor of $${Math.round(par * (1 - BANDS.meanTolerance))}`);
  }
  const ceilingPass = cell.ceiling <= BANDS.ceilingMultiple * par;
  if (!ceilingPass) {
    reasons.push(`ceiling $${Math.round(cell.ceiling)} is more than ${BANDS.ceilingMultiple}x par ($${Math.round(par)}) — a jackpot tail`);
  }
  const floorPass = cell.deadRate <= BANDS.situational;
  if (!floorPass) {
    reasons.push(cell.deadRate > BANDS.deadText
      ? `dead in ${Math.round(cell.deadRate * 100)}% of positions where it is legal — this is dead text, not a situational card`
      : `dead in ${Math.round(cell.deadRate * 100)}% of legal positions — situational, and must be judged in a different band`);
  }

  return { price, par, meanPass, ceilingPass, floorPass, pass: meanPass && ceilingPass && floorPass, reasons };
}

export function intervalOf(cell: CardCell): Interval {
  return { lo: cell.meanLo, hi: cell.meanHi };
}
