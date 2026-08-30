// =============================================================================
// Sample statistics — a synthetic month of play for the dashboard (Epic 16)
// =============================================================================
// The dashboard is empty on the day it ships: game_results starts at zero rows
// and fills forward, because no outcome was ever recorded before Epic 16. That
// makes the page impossible to design, review or demo against real data.
//
// So this module fabricates a month of games and aggregates them through the
// same shapes the API returns. It generates ~1,200 individual synthetic games
// and then counts them, rather than hand-writing the summary numbers — which
// means every figure on the page agrees with every other one: the activity
// chart sums to the games total, the chain shares sum to 100%, the records are
// really the extremes of the generated set. Hand-written totals would drift
// apart the moment anyone looked closely.
//
// Deterministic: a fixed seed, so the same numbers appear on every load and a
// screenshot stays reproducible. Only the live strip wanders, on purpose.
//
// Nothing here is ever written to the database and nothing imports it on the
// server. It is reachable only through the dashboard's Sample/Live toggle,
// which labels it as demo data on screen.
// =============================================================================

import type {
  ActivityPoint, ChainStat, EconomyStats, LiveStats, RecordsStats,
  RuleDistribution, SeatType, SeatTypeStat, StatsOverview, TotalsStats,
} from '@/types/stats';
import { CHAINS, type ChainName } from '@/types/game';

const SEED = 0x5ACC1E;

/** mulberry32 — small, fast, and stable across engines, so the demo is reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const intBetween = (rng: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rng() * (hi - lo + 1));

/**
 * Fisher-Yates. `sort(() => rng() - 0.5)` is not a shuffle — it biases hard
 * toward the original order, which showed up as Sackson being the largest chain
 * two and a half times as often as Tower for no reason at all.
 */
function shuffled<T>(rng: () => number, items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Local YYYY-MM-DD. Deliberately not toISOString().slice(0, 10): that reports
 * the UTC date, so east of Greenwich every evening game lands on the wrong day
 * and the chart's last bar is yesterday's.
 */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Draw from a weighted distribution, e.g. { none: 58, '11': 24, ... }. */
function weighted<T extends string>(rng: () => number, weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [value, w] of entries) {
    roll -= w;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

const NAMES = [
  'Ada', 'Bruno', 'Cleo', 'Dmitri', 'Elif', 'Farid', 'Greta', 'Hugo', 'Ingrid',
  'Jonas', 'Kaya', 'Lena', 'Malik', 'Nora', 'Otto', 'Pia', 'Quinn', 'Rosa',
  'Sami', 'Tomas', 'Ulla', 'Vera', 'Wim', 'Xenia', 'Yusuf', 'Zoë',
];
const BOT_NAMES: Record<Exclude<SeatType, 'human'>, string> = {
  easy: 'Bot (Easy)', medium: 'Bot (Medium)', hard: 'Bot (Hard)',
};

const CHAIN_NAMES = Object.keys(CHAINS) as ChainName[];

// How often each rule value gets picked. Loosely: most rooms keep the defaults,
// a meaningful minority does not, and the Epic 15 defaults are visibly the
// most-used values without being unanimous.
const RULE_WEIGHTS = {
  boardSize:               { large: 86, small: 14 },
  stockSelling:            { off: 61, '100': 6, '90': 18, '75': 11, '50': 4 },
  chainSafety:             { none: 54, '11': 27, '9': 7, '13': 9, '15': 3 },
  turnTimer:               { off: 68, '30': 5, '60': 19, '90': 8 },
  disableTimerFirstRounds: { true: 81, false: 19 },
  cashVisibility:          { visible: 72, hidden: 21, aggregate: 7 },
  bonusTier:               { standard: 79, flat: 8, aggressive: 13 },
  maxChains:               { '7': 88, '6': 8, '5': 4 },
  startingCash:            { '6000': 77, '4000': 9, '8000': 14 },
  startingTiles:           { '6': 83, '5': 6, '7': 11 },
  startWithTileOnBoard:    { true: 74, false: 26 },
} as const;

interface SampleSeat {
  name: string;
  seatType: SeatType;
  finalTotal: number;
  placement: number;
}

interface SampleGame {
  endedAt: Date;
  durationSeconds: number;
  rounds: number;
  playerCount: number;
  mergers: number;
  winnerName: string;
  winningTotal: number;
  rules: Record<string, string>;
  finalChains: Record<string, number>;
  largestChain: ChainName | null;
  largestChainSize: number;
  seats: SampleSeat[];
}

/** Games finished per day: a weekly rhythm (busier at weekends) plus mild growth. */
function gamesOnDay(rng: () => number, daysAgo: number, weekday: number): number {
  const weekendLift = weekday === 0 || weekday === 6 ? 1.55 : weekday === 5 ? 1.2 : 1;
  const growth = 1 + (29 - daysAgo) * 0.012;
  const noise = 0.78 + rng() * 0.44;
  return Math.max(4, Math.round(26 * weekendLift * growth * noise));
}

function makeGame(rng: () => number, endedAt: Date): SampleGame {
  const rules = Object.fromEntries(
    Object.entries(RULE_WEIGHTS).map(([key, weights]) =>
      [key, weighted(rng, weights as Record<string, number>)]),
  ) as Record<string, string>;

  const playerCount = weighted(rng, { '2': 17, '3': 27, '4': 34, '5': 14, '6': 8 });
  const seatCount = Number(playerCount);
  // Bots fill in when fewer humans show up; solo-vs-bots is common at 2-3 seats.
  const botWeights: Record<string, number> = seatCount <= 3
    ? { '0': 55, '1': 27, '2': 18 }
    : { '0': 68, '1': 20, '2': 9, '3': 3 };
  const bots = Math.min(Number(weighted(rng, botWeights)), seatCount - 1);

  const smallBoard = rules.boardSize === 'small';
  const rounds = intBetween(rng, smallBoard ? 12 : 17, smallBoard ? 26 : 38);
  // rounds x seats = total turns taken; 20-50s each, plus a couple of minutes
  // of lobby. A 4-player game lands around 45 minutes.
  const durationSeconds = Math.round(rounds * seatCount * (20 + rng() * 30) + 150);
  const mergers = intBetween(rng, 1, smallBoard ? 5 : 8);

  // Chain sizes at the end. Not every chain gets founded; the survivor of the
  // last merger is usually much larger than the rest.
  const activeCount = intBetween(rng, 3, Number(rules.maxChains));
  const chainOrder = shuffled(rng, CHAIN_NAMES);
  const finalChains: Record<string, number> = Object.fromEntries(CHAIN_NAMES.map((c) => [c, 0]));
  let largestChain: ChainName | null = null;
  let largestChainSize = 0;
  for (let i = 0; i < activeCount; i++) {
    const chain = chainOrder[i];
    const size = i === 0
      ? intBetween(rng, smallBoard ? 18 : 24, smallBoard ? 30 : 41)
      : intBetween(rng, 2, smallBoard ? 14 : 19);
    finalChains[chain] = size;
    if (size > largestChainSize) { largestChainSize = size; largestChain = chain; }
  }

  // Net worth: a winner in the high tens of thousands, the rest trailing off.
  const cashRule = Number(rules.startingCash);
  const winningTotal = Math.round(
    (26000 + rng() * 30000) * (cashRule / 6000) * (smallBoard ? 0.72 : 1),
  );

  const humanNames = shuffled(rng, NAMES).slice(0, seatCount - bots);
  const seatTypes: SeatType[] = [
    ...humanNames.map(() => 'human' as SeatType),
    ...Array.from({ length: bots }, () => weighted(rng, { easy: 22, medium: 46, hard: 32 }) as SeatType),
  ];

  const seats: SampleSeat[] = seatTypes.map((seatType, i) => ({
    name: seatType === 'human' ? humanNames[i] : BOT_NAMES[seatType as Exclude<SeatType, 'human'>],
    seatType,
    finalTotal: 0,
    placement: 0,
  }));

  // Score seats by drawing a strength per seat, so bots win at a rate that
  // tracks difficulty rather than being uniform.
  const strengthFor = (t: SeatType) =>
    ({ human: 1.0, hard: 0.94, medium: 0.72, easy: 0.5 } as Record<SeatType, number>)[t];
  const scored = seats
    .map((s) => ({ seat: s, roll: strengthFor(s.seatType) * (0.55 + rng() * 0.9) }))
    .sort((a, b) => b.roll - a.roll);

  scored.forEach(({ seat }, rank) => {
    seat.placement = rank + 1;
    seat.finalTotal = rank === 0
      ? winningTotal
      : Math.round(winningTotal * (0.9 - rank * 0.14) * (0.82 + rng() * 0.2));
  });

  return {
    endedAt, durationSeconds, rounds, playerCount: seatCount, mergers,
    winnerName: scored[0].seat.name,
    winningTotal,
    rules, finalChains, largestChain, largestChainSize,
    seats,
  };
}

/** A month of finished games, newest last. Deterministic for a given `now`. */
export function generateSampleGames(now: Date = new Date()): SampleGame[] {
  const rng = makeRng(SEED);
  const games: SampleGame[] = [];

  for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
    const day = new Date(now);
    day.setDate(day.getDate() - daysAgo);
    day.setHours(0, 0, 0, 0);

    let count = gamesOnDay(rng, daysAgo, day.getDay());
    // Today is only partly played out, so it should not look like a collapse.
    if (daysAgo === 0) {
      count = Math.max(1, Math.round(count * (now.getHours() / 24)));
    }

    for (let i = 0; i < count; i++) {
      const endedAt = new Date(day);
      // Evening-heavy: most games finish between 17:00 and 23:00.
      const hour = rng() < 0.68 ? intBetween(rng, 17, 23) : intBetween(rng, 9, 16);
      endedAt.setHours(
        daysAgo === 0 ? Math.min(hour, Math.max(0, now.getHours())) : hour,
        intBetween(rng, 0, 59),
        0, 0,
      );
      games.push(makeGame(rng, endedAt));
    }
  }
  return games.sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime());
}

// -----------------------------------------------------------------------------
// Aggregation — mirrors the SQL in server/api/stats.ts
// -----------------------------------------------------------------------------

const avg = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
const round1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);

function aggregate(games: SampleGame[], now: Date): StatsOverview {
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const since = (days: number) => new Date(now.getTime() - days * 86_400_000);

  const totals: TotalsStats = {
    gamesCompleted: games.length,
    gamesToday: games.filter((g) => g.endedAt >= startOfToday).length,
    games7d: games.filter((g) => g.endedAt >= since(7)).length,
    games30d: games.filter((g) => g.endedAt >= since(30)).length,
    avgDurationSeconds: Math.round(avg(games.map((g) => g.durationSeconds)) ?? 0),
    avgRounds: round1(avg(games.map((g) => g.rounds))),
    avgPlayerCount: round1(avg(games.map((g) => g.playerCount))),
    avgMergers: round1(avg(games.map((g) => g.mergers))),
  };

  const rules: RuleDistribution = {};
  for (const game of games) {
    for (const [key, value] of Object.entries(game.rules)) {
      (rules[key] ??= {})[value] = (rules[key][value] ?? 0) + 1;
    }
  }

  const chains: ChainStat[] = CHAIN_NAMES.map((chain) => {
    const sizes = games.map((g) => g.finalChains[chain] ?? 0).filter((s) => s > 0);
    return {
      chain,
      timesFounded: sizes.length,
      timesLargest: games.filter((g) => g.largestChain === chain).length,
      avgSize: round1(avg(sizes)),
      maxSize: sizes.length ? Math.max(...sizes) : null,
    };
  }).sort((a, b) => b.timesLargest - a.timesLargest);

  const winningTotals = games.map((g) => g.winningTotal);
  const spreads = games.map((g) => {
    const totalsInGame = g.seats.map((s) => s.finalTotal);
    return Math.max(...totalsInGame) - Math.min(...totalsInGame);
  });
  const bucketCounts = new Map<number, number>();
  for (const total of winningTotals) {
    const bucket = Math.floor(total / 10000) * 10000;
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }
  const economy: EconomyStats = {
    avgWinningTotal: Math.round(avg(winningTotals) ?? 0),
    maxWinningTotal: Math.max(...winningTotals),
    minWinningTotal: Math.min(...winningTotals),
    avgSpread: Math.round(avg(spreads) ?? 0),
    buckets: [...bucketCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([from, count]) => ({ from, count })),
  };

  const seatOrder: SeatType[] = ['human', 'hard', 'medium', 'easy'];
  const bots: SeatTypeStat[] = seatOrder.map((seatType) => {
    const seats = games.flatMap((g) => g.seats).filter((s) => s.seatType === seatType);
    const wins = seats.filter((s) => s.placement === 1).length;
    return {
      seatType,
      seats: seats.length,
      wins,
      winRate: seats.length ? wins / seats.length : 0,
      avgPlacement: round1(avg(seats.map((s) => s.placement))),
      avgTotal: Math.round(avg(seats.map((s) => s.finalTotal)) ?? 0),
    };
  }).filter((s) => s.seats > 0);

  const best = <T,>(items: T[], by: (t: T) => number): T | null =>
    items.length === 0 ? null : items.reduce((a, b) => (by(b) > by(a) ? b : a));

  const topSeatGame = best(games, (g) => Math.max(...g.seats.map((s) => s.finalTotal)));
  const topSeat = topSeatGame
    ? topSeatGame.seats.reduce((a, b) => (b.finalTotal > a.finalTotal ? b : a))
    : null;
  const longest = best(games, (g) => g.durationSeconds);
  const mostRounds = best(games, (g) => g.rounds);
  const biggestChain = best(games, (g) => g.largestChainSize);
  const blowout = best(
    games.map((g, i) => ({ game: g, spread: spreads[i] })),
    (x) => x.spread,
  );

  const records: RecordsStats = {
    highestScore: topSeat && topSeatGame
      ? { name: topSeat.name, value: topSeat.finalTotal, at: topSeatGame.endedAt.toISOString() }
      : null,
    longestGame: longest
      ? { name: longest.winnerName, value: longest.durationSeconds, at: longest.endedAt.toISOString() }
      : null,
    mostRounds: mostRounds
      ? { name: mostRounds.winnerName, value: mostRounds.rounds, at: mostRounds.endedAt.toISOString() }
      : null,
    largestChain: biggestChain
      ? {
          name: biggestChain.winnerName,
          value: biggestChain.largestChainSize,
          at: biggestChain.endedAt.toISOString(),
          detail: biggestChain.largestChain,
        }
      : null,
    biggestBlowout: blowout
      ? { name: blowout.game.winnerName, value: blowout.spread, at: blowout.game.endedAt.toISOString() }
      : null,
  };

  const byDay = new Map<string, number>();
  for (const game of games) {
    const key = dayKey(game.endedAt);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  const activity: ActivityPoint[] = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(now);
    day.setDate(day.getDate() - (29 - i));
    const key = dayKey(day);
    return { day: key, games: byDay.get(key) ?? 0 };
  });

  return {
    totals, rules, chains, economy, bots, records, activity,
    meta: {
      countingSince: games[0]?.endedAt.toISOString() ?? null,
      generatedAt: now.toISOString(),
    },
  };
}

let cachedOverview: { key: string; value: StatsOverview } | null = null;

/** The synthetic month, aggregated. Memoised per hour so panels don't re-derive it. */
export function sampleOverview(now: Date = new Date()): StatsOverview {
  const key = now.toISOString().slice(0, 13);
  if (cachedOverview?.key === key) return cachedOverview.value;
  const value = aggregate(generateSampleGames(now), now);
  cachedOverview = { key, value };
  return value;
}

/**
 * The live strip, and the one thing here that deliberately does NOT hold still:
 * it re-rolls every 15 seconds so the "live" indicator has something to show
 * while someone is looking at sample data.
 */
export function sampleLive(now: Date = new Date()): LiveStats {
  const rng = makeRng(SEED ^ Math.floor(now.getTime() / 15_000));
  const gamesInProgress = intBetween(rng, 1, 6);
  return {
    gamesInProgress,
    roomsWaiting: intBetween(rng, 0, 4),
    playersInGame: gamesInProgress === 0 ? 0 : intBetween(rng, gamesInProgress * 2, gamesInProgress * 4),
    longestRunningMinutes: gamesInProgress === 0 ? null : intBetween(rng, 6, 74),
  };
}
