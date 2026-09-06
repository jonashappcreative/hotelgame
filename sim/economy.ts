// =============================================================================
// economy — scoring the same value distributions against three pricing models
// =============================================================================
// The card doc frames "random deck or selectable, one price or three tiers" as a
// decision that has to be made before any maths can be run. It does not. The
// simulator computes one thing per card — its value distribution across the
// state corpus — and A-random, A-open and three tiers are three different ways
// of *scoring* those same distributions:
//
//   A-random  you pay and draw blind, so only the deck average has to be fair.
//             Individual variance is a feature. The easiest model to balance.
//   A-open    you pay and choose, so every card has to sit inside a narrow band
//             of every other card, because players always take the best thing on
//             the table. The hardest model, harder than three tiers.
//   3 tiers   band width within each tier, plus the separation check: if the
//             best tier-1 card beats the worst tier-2 card, the boundary is
//             fiction and players notice inside two games.
//
// So the pricing-model decision becomes something the data informs rather than a
// prerequisite, and all three scores come out of one simulation run.
// =============================================================================

import type { CardCell } from './valuation';
import { mean, percentile, fmtMoney } from './stats';
import { ACCESS_DEFAULTS, BANDS, TIER_PRICES } from './thresholds';

export interface PricedCard {
  cardId: string;
  cardName: string;
  tier: 1 | 2 | 3;
  value: number;
  ceiling: number;
  deadRate: number;
  availability: number;
}

export function priced(cells: CardCell[]): PricedCard[] {
  return cells.map((c) => ({
    cardId: c.cardId,
    cardName: c.cardName,
    tier: c.tier,
    value: c.mean,
    ceiling: c.ceiling,
    deadRate: c.deadRate,
    availability: c.availability,
  }));
}

export interface ARandomScore {
  model: 'A-random';
  price: number;
  par: number;
  deckAverage: number;
  /** How far the deck average sits from par, as a fraction of par. Zero is perfect. */
  error: number;
  pass: boolean;
  spread: { p10: number; p50: number; p90: number };
}

export function scoreARandom(cards: PricedCard[], lambda: number, price = ACCESS_DEFAULTS.flatPrice): ARandomScore {
  const par = price * lambda;
  const values = cards.map((c) => c.value);
  const deckAverage = mean(values);
  return {
    model: 'A-random',
    price, par, deckAverage,
    error: par === 0 ? 0 : (deckAverage - par) / par,
    pass: Math.abs(deckAverage - par) <= BANDS.meanTolerance * par,
    spread: { p10: percentile(values, 0.1), p50: percentile(values, 0.5), p90: percentile(values, 0.9) },
  };
}

export interface AOpenScore {
  model: 'A-open';
  price: number;
  par: number;
  /** (max - min) / par. The tightest constraint in the whole study. */
  bandWidth: number;
  autoBuys: PricedCard[];
  deadText: PricedCard[];
  pass: boolean;
}

export function scoreAOpen(cards: PricedCard[], lambda: number, price = ACCESS_DEFAULTS.flatPrice): AOpenScore {
  const par = price * lambda;
  const values = cards.map((c) => c.value);
  const bandWidth = par === 0 ? Infinity : (Math.max(...values) - Math.min(...values)) / par;
  const hi = par * (1 + BANDS.meanTolerance);
  const lo = par * (1 - BANDS.meanTolerance);
  const autoBuys = cards.filter((c) => c.value > hi).sort((a, b) => b.value - a.value);
  const deadText = cards.filter((c) => c.value < lo).sort((a, b) => a.value - b.value);
  return {
    model: 'A-open', price, par, bandWidth, autoBuys, deadText,
    pass: autoBuys.length === 0 && deadText.length === 0,
  };
}

export interface TierScore {
  tier: 1 | 2 | 3;
  price: number;
  par: number;
  members: PricedCard[];
  midpointError: number;
  bandWidth: number;
  best: number;
  worst: number;
}

export interface ThreeTierScore {
  model: 'three-tier';
  tiers: TierScore[];
  /** True when every tier boundary holds: worst card of tier n+1 beats best card of tier n. */
  boundariesHold: boolean;
  violations: string[];
  pass: boolean;
}

export function scoreThreeTier(cards: PricedCard[], lambda: number, prices = TIER_PRICES): ThreeTierScore {
  const tiers: TierScore[] = ([1, 2, 3] as const).map((tier) => {
    const members = cards.filter((c) => c.tier === tier).sort((a, b) => b.value - a.value);
    const values = members.map((m) => m.value);
    const par = prices[tier] * lambda;
    return {
      tier,
      price: prices[tier],
      par,
      members,
      midpointError: par === 0 || values.length === 0 ? 0 : (mean(values) - par) / par,
      bandWidth: values.length ? (Math.max(...values) - Math.min(...values)) / par : 0,
      best: values.length ? Math.max(...values) : 0,
      worst: values.length ? Math.min(...values) : 0,
    };
  });

  const violations: string[] = [];
  for (let i = 0; i < tiers.length - 1; i++) {
    const lower = tiers[i];
    const upper = tiers[i + 1];
    if (lower.members.length === 0 || upper.members.length === 0) continue;
    if (lower.best >= upper.worst) {
      violations.push(
        `tier ${lower.tier}'s best card (${lower.members[0].cardName}, ${fmtMoney(lower.best)}) is worth at least as much as ` +
        `tier ${upper.tier}'s worst (${upper.members[upper.members.length - 1].cardName}, ${fmtMoney(upper.worst)}) — ` +
        `the ${lower.tier}/${upper.tier} boundary is fiction`,
      );
    }
  }

  return {
    model: 'three-tier',
    tiers,
    boundariesHold: violations.length === 0,
    violations,
    pass: violations.length === 0 && tiers.every((t) => Math.abs(t.midpointError) <= BANDS.meanTolerance),
  };
}

export interface EconomyReport {
  lambda: number;
  aRandom: ARandomScore;
  aOpen: AOpenScore;
  threeTier: ThreeTierScore;
  boardSeat: BoardSeatValue;
  /** Which model the data actually favours, and why. */
  recommendation: string;
}

export interface BoardSeatValue {
  /** Expected value of the best of `seen` draws, less the discounted price paid. */
  seen: number;
  discount: number;
  expectedBest: number;
  netValue: number;
  note: string;
}

/**
 * Board Seat cannot be simulated: its value is the value of the deck it draws
 * from, so simulating it before the deck is priced would be circular. It is
 * computed here instead, from the finished pool — the expected maximum of `seen`
 * independent draws, less what the card costs to exercise.
 */
export function valueBoardSeat(
  cards: PricedCard[], lambda: number, seen = 3, discount = 0.5, price = ACCESS_DEFAULTS.flatPrice,
): BoardSeatValue {
  const values = [...cards.map((c) => c.value)].sort((a, b) => a - b);
  const n = values.length;
  if (n === 0) {
    return { seen, discount, expectedBest: 0, netValue: 0, note: 'no priced cards' };
  }
  // E[max of `seen` draws] over the empirical distribution: sum over each card
  // of its value times the probability it is the largest of the sample.
  let expectedBest = 0;
  for (let i = 0; i < n; i++) {
    const pAtMostI = (i + 1) / n;
    const pAtMostPrev = i / n;
    expectedBest += values[i] * (Math.pow(pAtMostI, seen) - Math.pow(pAtMostPrev, seen));
  }
  const netValue = expectedBest - discount * price * lambda;
  return {
    seen, discount, expectedBest, netValue,
    note:
      'Derived, not simulated. Assumes the drawn cards are independent samples of the priced pool and ' +
      'that the buyer always exercises the option, which is the upper bound on the card.',
  };
}

export function buildEconomyReport(cells: CardCell[], lambda: number): EconomyReport {
  const cards = priced(cells);
  const aRandom = scoreARandom(cards, lambda);
  const aOpen = scoreAOpen(cards, lambda);
  const threeTier = scoreThreeTier(cards, lambda);
  const boardSeat = valueBoardSeat(cards, lambda);

  const parts: string[] = [];
  if (aRandom.pass) parts.push('A-random is satisfiable at the current values (the deck average sits at par)');
  else parts.push(`A-random misses par by ${(aRandom.error * 100).toFixed(0)}%`);
  parts.push(`A-open needs a band ${aOpen.bandWidth.toFixed(1)}x par wide to hold every card, with ${aOpen.autoBuys.length} auto-buys and ${aOpen.deadText.length} dead cards`);
  parts.push(threeTier.boundariesHold
    ? 'the three-tier boundaries hold at the current assignment'
    : `the three-tier assignment has ${threeTier.violations.length} boundary violation(s)`);

  return { lambda, aRandom, aOpen, threeTier, boardSeat, recommendation: parts.join('; ') + '.' };
}
