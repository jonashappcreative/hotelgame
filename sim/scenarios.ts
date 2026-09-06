// =============================================================================
// scenarios — the two experiments, and how their records are read
// =============================================================================
// Measurement and analysis are kept apart on purpose. The workers produce one
// DeckRecord per game and nothing else; everything below reads those records
// back. A metric can therefore be re-derived, or a cell re-cut, from the JSONL
// on disk without replaying a single game.
// =============================================================================

import type { DeckJob } from './jobs';
import type { DeckRecord } from './deck-study';
import type { DeckPolicyName } from './deck';
import type { PolicyName } from './policies';
import { wilson, mean, sd, paired, bootstrapCI, percentile, type Interval, type PairedResult } from './stats';

export const SEATS: PolicyName[] = ['hard', 'hard', 'hard', 'hard'];
export const ROTATIONS = [0, 1, 2, 3];
export const PRICES = [200, 300, 400, 500, 600];
/**
 * Control cells, outside the plan's sweep and excluded from the crossing
 * interpolation. They answer the one question the sweep cannot: if the deck
 * holder is not above 25% even when cards are free, then price is not what is
 * holding the deck down and no crossing price exists to be found. Reported
 * separately so the sweep stays exactly the five cells the plan specifies.
 */
export const CONTROL_PRICES = [0, 100];
export const POLICIES: DeckPolicyName[] = ['always-buy-greedy', 'ev-threshold'];

export interface ScenarioConfig {
  /** Base seeds. Each is played once per seat rotation. */
  seeds: number;
  seedBase: number;
  /** Games per worker job. Whole seeds only, so a shard is always complete matched sets. */
  seedsPerJob: number;
}

export const DEFAULT_CONFIG: ScenarioConfig = { seeds: 500, seedBase: 100_000, seedsPerJob: 25 };

export const cellId = (policy: DeckPolicyName, price: number) => `A/${policy}/${price}`;
export const BASELINE_CELL = 'A/baseline';
export const SCENARIO_B_CELL = 'B/symmetric';

function seedChunks(cfg: ScenarioConfig): number[][] {
  const all = Array.from({ length: cfg.seeds }, (_, i) => cfg.seedBase + i);
  const out: number[][] = [];
  for (let i = 0; i < all.length; i += cfg.seedsPerJob) out.push(all.slice(i, i + cfg.seedsPerJob));
  return out;
}

// -----------------------------------------------------------------------------
// Job construction
// -----------------------------------------------------------------------------

export function scenarioAJobs(cfg: ScenarioConfig): DeckJob[] {
  const jobs: DeckJob[] = [];
  const chunks = seedChunks(cfg);

  // The paired baseline. Price-independent, so it is run once and reused
  // against every price cell.
  for (const seeds of chunks) {
    jobs.push({
      kind: 'deck', label: 'baseline (no deck)', cell: BASELINE_CELL,
      seats: SEATS, seeds, rotations: ROTATIONS,
      mode: 'none', policy: 'ev-threshold', price: 0,
    });
  }

  for (const policy of POLICIES) {
    for (const price of [...PRICES, ...CONTROL_PRICES]) {
      for (const seeds of chunks) {
        jobs.push({
          kind: 'deck', label: `${policy} @ $${price}`, cell: cellId(policy, price),
          seats: SEATS, seeds, rotations: ROTATIONS,
          mode: 'one-seat', policy, price,
        });
      }
    }
  }
  return jobs;
}

export function scenarioBJobs(cfg: ScenarioConfig, price: number): DeckJob[] {
  return seedChunks(cfg).map((seeds) => ({
    kind: 'deck', label: `symmetric @ $${price}`, cell: SCENARIO_B_CELL,
    seats: SEATS, seeds, rotations: ROTATIONS,
    mode: 'all-seats', policy: 'ev-threshold', price,
  }));
}

// -----------------------------------------------------------------------------
// Scenario A analysis
// -----------------------------------------------------------------------------

/**
 * Credit for winning. A tie on net worth splits the win, which is the honest
 * accounting; `soleWins` is carried alongside because Wilson's interval needs
 * whole successes. Both are reported — if they disagree the tie rate is doing
 * work and needs saying out loud.
 */
function winCredit(rec: DeckRecord, seat: number): number {
  return rec.winners.includes(seat) ? 1 / rec.winners.length : 0;
}

export interface CellSummary {
  cell: string;
  policy: DeckPolicyName;
  price: number;
  games: number;

  /** Deck holder's win rate, ties split. */
  winRate: number;
  soleWins: number;
  /** Wilson 95% interval on the sole-winner count. */
  winLo: number;
  winHi: number;
  tieRate: number;

  /** Paired: (deck-on margin) - (deck-off margin), matched on seed and seat. */
  cashMarginDiff: PairedResult;
  cashMarginBootstrap: Interval & { point: number };
  netMarginDiff: PairedResult;
  netMarginBootstrap: Interval & { point: number };

  cardsBought: number;
  cardsPlayed: number;
  cardsUnplayed: number;
  affordabilityDeclines: number;
  /** Declines as a share of the rounds the seat was allowed to buy in. */
  declineRate: number;
  meanIdleRounds: number;
  naturalEndRate: number;
  meanRounds: number;
  meanMergers: number;
  rejections: number;
}

/** Key a record to its matched baseline: same tile bag, same shuffle, same notional deck seat. */
const pairKey = (rec: DeckRecord) => `${rec.seed}:${rec.deck_seat}`;

export function summariseCell(
  cell: string, records: DeckRecord[], baseline: Map<number, DeckRecord>,
): CellSummary {
  const games = records.length;
  const first = records[0];

  let credit = 0;
  let sole = 0;
  let ties = 0;
  const onCash: number[] = [];
  const offCash: number[] = [];
  const onNet: number[] = [];
  const offNet: number[] = [];

  for (const rec of records) {
    const seat = rec.deck_seat!;
    credit += winCredit(rec, seat);
    if (rec.winner_seat === seat) sole++;
    if (rec.winners.length > 1) ties++;

    // The baseline is deck-disabled, so the four rotations of a seed are one
    // game; the notional deck seat picks which column of it to compare.
    const base = baseline.get(rec.seed);
    if (!base) continue;
    const others = <T,>(xs: T[]) => xs.filter((_, i) => i !== seat);
    const m = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    onCash.push(rec.final_cash_by_seat[seat] - m(others(rec.final_cash_by_seat)));
    offCash.push(base.final_cash_by_seat[seat] - m(others(base.final_cash_by_seat)));
    onNet.push(rec.final_net_worth_by_seat[seat] - m(others(rec.final_net_worth_by_seat)));
    offNet.push(base.final_net_worth_by_seat[seat] - m(others(base.final_net_worth_by_seat)));
  }

  const w = wilson(sole, games);
  const sum = (f: (r: DeckRecord) => number) => records.reduce((a, r) => a + f(r), 0);
  const idle = records.flatMap((r) => r.deck_stats_by_seat.flatMap((s) => s.idleRounds));
  const cashDiffs = onCash.map((v, i) => v - offCash[i]);
  const netDiffs = onNet.map((v, i) => v - offNet[i]);
  const opportunities = sum((r) => r.buy_opportunities);

  return {
    cell,
    policy: first.policy,
    price: first.price,
    games,
    winRate: credit / games,
    soleWins: sole,
    winLo: w.lo,
    winHi: w.hi,
    tieRate: ties / games,

    cashMarginDiff: paired(onCash, offCash),
    cashMarginBootstrap: bootstrapCI(cashDiffs),
    netMarginDiff: paired(onNet, offNet),
    netMarginBootstrap: bootstrapCI(netDiffs),

    cardsBought: sum((r) => r.cards_bought) / games,
    cardsPlayed: sum((r) => r.cards_played) / games,
    cardsUnplayed: sum((r) => r.cards_unplayed_at_end) / games,
    affordabilityDeclines: sum((r) => r.affordability_declines) / games,
    declineRate: opportunities ? sum((r) => r.affordability_declines) / opportunities : 0,
    meanIdleRounds: idle.length ? idle.reduce((a, b) => a + b, 0) / idle.length : 0,
    naturalEndRate: records.filter((r) => r.game_ended_naturally).length / games,
    meanRounds: sum((r) => r.rounds_played) / games,
    meanMergers: sum((r) => r.merger_count) / games,
    rejections: sum((r) => r.rejections),
  };
}

export interface BaselineHealth {
  games: number;
  /** Win rate per seat across the deck-disabled games. The null is 25% each. */
  seatWinRates: number[];
  seatSpread: number;
  naturalEndRate: number;
  meanRounds: number;
  meanMergers: number;
  meanTotalMoneyEnd: number;
  rejections: number;
  tieRate: number;
}

export function baselineHealth(records: DeckRecord[]): BaselineHealth {
  const games = records.length;
  const seatWinRates = [0, 1, 2, 3].map(
    (seat) => records.reduce((a, r) => a + winCredit(r, seat), 0) / games,
  );
  return {
    games,
    seatWinRates,
    seatSpread: Math.max(...seatWinRates) - Math.min(...seatWinRates),
    naturalEndRate: records.filter((r) => r.game_ended_naturally).length / games,
    meanRounds: mean(records.map((r) => r.rounds_played)),
    meanMergers: mean(records.map((r) => r.merger_count)),
    meanTotalMoneyEnd: mean(records.map((r) => r.total_money_end)),
    rejections: records.reduce((a, r) => a + r.rejections, 0),
    tieRate: records.filter((r) => r.winners.length > 1).length / games,
  };
}

/**
 * Where the win-rate curve crosses the 25% null, by linear interpolation
 * between the two bracketing price cells. Null when the curve never crosses
 * inside the swept range — which is itself a result, not a failure.
 */
export function crossingPrice(cells: CellSummary[]): { price: number | null; reason: string } {
  const curve = [...cells].sort((a, b) => a.price - b.price);
  if (curve.length < 2) return { price: null, reason: 'not enough price cells' };

  const above = curve.filter((c) => c.winRate > 0.25);
  const below = curve.filter((c) => c.winRate < 0.25);
  if (above.length === 0) {
    return { price: null, reason: `win rate is at or below 25% at every price down to $${curve[0].price}` };
  }
  if (below.length === 0) {
    return { price: null, reason: `win rate stays above 25% at every price up to $${curve[curve.length - 1].price}` };
  }

  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if ((a.winRate - 0.25) * (b.winRate - 0.25) <= 0 && a.winRate !== b.winRate) {
      const t = (a.winRate - 0.25) / (a.winRate - b.winRate);
      return {
        price: a.price + t * (b.price - a.price),
        reason: `interpolated between $${a.price} (${(a.winRate * 100).toFixed(1)}%) and $${b.price} (${(b.winRate * 100).toFixed(1)}%)`,
      };
    }
  }
  return { price: null, reason: 'curve is non-monotonic and does not cross cleanly' };
}

// -----------------------------------------------------------------------------
// Scenario B analysis
// -----------------------------------------------------------------------------

export interface HealthComparison {
  metric: string;
  deck: number;
  baseline: number;
  paired: PairedResult;
  bootstrap: Interval & { point: number };
}

/** Paired difference of one per-game quantity, deck versus its matched baseline. */
export function compare(
  metric: string, deck: DeckRecord[], baseline: Map<number, DeckRecord>, f: (r: DeckRecord) => number,
): HealthComparison {
  const on: number[] = [];
  const off: number[] = [];
  for (const rec of deck) {
    const base = baseline.get(rec.seed);
    if (!base) continue;
    on.push(f(rec));
    off.push(f(base));
  }
  return {
    metric,
    deck: mean(on),
    baseline: mean(off),
    paired: paired(on, off),
    bootstrap: bootstrapCI(on.map((v, i) => v - off[i])),
  };
}

export interface CardFrequency {
  cardId: string;
  /** Games in which this card was played at least once. */
  gamesPlayedIn: number;
  plays: number;
  /** Games in which a copy of the card reached someone's hand at all — the availability denominator. */
  gamesAvailableIn: number;
  playRateWhenAvailable: number;
  boughtNeverPlayed: number;
  meanIdleRounds: number;
  meanEstValue: number;
}

export function cardFrequencies(records: DeckRecord[]): CardFrequency[] {
  const stats = new Map<string, {
    plays: number; games: Set<number>; available: Set<number>;
    unplayed: number; idle: number[]; est: number[];
  }>();
  const get = (id: string) => {
    let s = stats.get(id);
    if (!s) { s = { plays: 0, games: new Set(), available: new Set(), unplayed: 0, idle: [], est: [] }; stats.set(id, s); }
    return s;
  };

  for (const rec of records) {
    for (const play of rec.plays) {
      const s = get(play.cardId);
      s.plays++;
      s.games.add(rec.seed);
      s.available.add(rec.seed);
      s.est.push(play.estValue);
    }
    for (const seat of rec.deck_stats_by_seat) {
      seat.cardIdsPlayed.forEach((id, i) => get(id).idle.push(seat.idleRounds[i] ?? 0));
      for (const id of seat.cardIdsUnplayed) {
        const s = get(id);
        s.unplayed++;
        s.available.add(rec.seed);
      }
    }
  }

  return [...stats.entries()]
    .map(([cardId, s]) => ({
      cardId,
      gamesPlayedIn: s.games.size,
      plays: s.plays,
      gamesAvailableIn: s.available.size,
      playRateWhenAvailable: s.available.size ? s.games.size / s.available.size : 0,
      boughtNeverPlayed: s.unplayed,
      meanIdleRounds: s.idle.length ? mean(s.idle) : 0,
      meanEstValue: s.est.length ? mean(s.est) : 0,
    }))
    .sort((a, b) => b.plays - a.plays);
}

export interface FrustrationCounters {
  cardsBought: number;
  cardsPlayed: number;
  neverPlayedShare: number;
  meanIdleRounds: number;
  idleP90: number;
  declineRate: number;
}

export function frustration(records: DeckRecord[]): FrustrationCounters {
  const bought = records.reduce((a, r) => a + r.cards_bought, 0);
  const played = records.reduce((a, r) => a + r.cards_played, 0);
  const unplayed = records.reduce((a, r) => a + r.cards_unplayed_at_end, 0);
  const idle = records.flatMap((r) => r.deck_stats_by_seat.flatMap((s) => s.idleRounds));
  const declines = records.reduce((a, r) => a + r.affordability_declines, 0);
  const opportunities = records.reduce((a, r) => a + r.buy_opportunities, 0);
  return {
    cardsBought: bought,
    cardsPlayed: played,
    neverPlayedShare: bought ? unplayed / bought : 0,
    meanIdleRounds: idle.length ? mean(idle) : 0,
    idleP90: idle.length ? percentile(idle, 0.9) : 0,
    declineRate: opportunities ? declines / opportunities : 0,
  };
}

export interface SeatFairness {
  seatWinRates: number[];
  spread: number;
  /** Wilson intervals per seat, on sole wins. */
  intervals: Interval[];
}

export function seatFairnessOf(records: DeckRecord[]): SeatFairness {
  const n = records.length;
  const seatWinRates = [0, 1, 2, 3].map((s) => records.reduce((a, r) => a + winCredit(r, s), 0) / n);
  const intervals = [0, 1, 2, 3].map((s) => {
    const sole = records.filter((r) => r.winner_seat === s).length;
    const w = wilson(sole, n);
    return { lo: w.lo, hi: w.hi };
  });
  return {
    seatWinRates,
    spread: Math.max(...seatWinRates) - Math.min(...seatWinRates),
    intervals,
  };
}

export const spreadOf = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
export { mean, sd };
