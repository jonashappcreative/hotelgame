// =============================================================================
// studies — the phases of the plan, each as one callable function
// =============================================================================
// Phase 1  harness validation (rejections, determinism, stall accounting)
// Phase 3  seat fairness, skill gradient, strategy fairness
// Phase 4  base-game rule sweeps
// Phase 2  lambda
// Phase 5  the card pass
//
// Every function returns plain data. Rendering lives in report.ts and the
// workbench; nothing here formats anything, so the same run can be re-scored
// against a different price later without re-simulating.
// =============================================================================

import { playGame, BASELINE_RULES, type SeatSpec } from './harness';
import { seatsOf, uniformSeats, type PolicyName, ARCHETYPES } from './policies';
import { recordOf, moneyTracker, type GameRecord } from './metrics';
import { wilson, mean, meanInterval, percentile, type RateEstimate } from './stats';
import { FAIRNESS } from './thresholds';
import type { CustomRules } from '../server/lib/rules';

export interface BatchOptions {
  seats: SeatSpec[];
  games: number;
  seedBase: number;
  rules?: Partial<CustomRules>;
  /** Called after every game, so a long batch can report itself while it runs. */
  onGame?: (done: number, total: number, record: GameRecord) => void;
}

/** Play a batch of games and keep the full per-game record. */
export async function playBatch(opts: BatchOptions): Promise<GameRecord[]> {
  const out: GameRecord[] = [];
  for (let i = 0; i < opts.games; i++) {
    const seed = opts.seedBase + i;
    const money = moneyTracker();
    const { sim, result } = await playGame({
      seats: opts.seats,
      seed,
      rules: opts.rules,
      onTurnStart: money.hook,
    });
    const record = recordOf(sim, seed, result, money.samples);
    out.push(record);
    opts.onGame?.(i + 1, opts.games, record);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Phase 1 — does the harness drive the real engine cleanly?
// -----------------------------------------------------------------------------

export interface HarnessHealth {
  games: number;
  rejections: number;
  outcomes: Record<string, number>;
  stallReasons: Record<string, number>;
  medianRounds: number;
  medianMergers: number;
  medianMoves: number;
  deterministic: boolean;
}

export async function harnessHealth(games: number, seedBase = 1_000): Promise<HarnessHealth> {
  const seats = uniformSeats('hard', 4);
  const records = await playBatch({ seats, games, seedBase });

  const outcomes: Record<string, number> = {};
  const stallReasons: Record<string, number> = {};
  let rejections = 0;
  for (const r of records) {
    outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    if (r.stallReason) stallReasons[r.stallReason] = (stallReasons[r.stallReason] ?? 0) + 1;
    rejections += r.rejections;
  }

  // Determinism: the same seed must produce the same ordered move log.
  const a = await playGame({ seats: uniformSeats('hard', 4), seed: 424242 });
  const b = await playGame({ seats: uniformSeats('hard', 4), seed: 424242 });
  const deterministic = JSON.stringify(a.result.log) === JSON.stringify(b.result.log);

  return {
    games,
    rejections,
    outcomes,
    stallReasons,
    medianRounds: percentile(records.map((r) => r.rounds), 0.5),
    medianMergers: percentile(records.map((r) => r.mergers), 0.5),
    medianMoves: percentile(records.map((r) => r.moves), 0.5),
    deterministic,
  };
}

// -----------------------------------------------------------------------------
// Phase 3 — validation
// -----------------------------------------------------------------------------

export interface SeatFairness {
  players: number;
  games: number;
  expected: number;
  perSeat: (RateEstimate & { seat: number; withinInterval: boolean; deviationPP: number })[];
  /** True when every seat's win rate is inside its Wilson interval of 1/N and below the pre-registered effect size. */
  fair: boolean;
  worstDeviationPP: number;
}

/**
 * The null hypothesis: with identical agents in every seat, seat order carries
 * no information, so each seat wins 1/N of the time. If the model cannot
 * reproduce that, nothing downstream of it is believable.
 */
export async function seatFairness(players: number, games: number, seedBase = 20_000, policyName: PolicyName = 'hard'): Promise<SeatFairness> {
  const seats = uniformSeats(policyName, players);
  const records = await playBatch({ seats, games, seedBase });
  const expected = 1 / players;

  // Ties are rare but real, and Wilson needs whole successes, so only outright
  // wins are counted. The uniform share is then 1/N of the games that had one.
  const outright = records.filter((r) => r.winners.length === 1).length;
  const share = (outright / games) / players;

  const perSeat = Array.from({ length: players }, (_, seat) => {
    const wins = records.filter((r) => r.winners.length === 1 && r.winners[0] === seat).length;
    const est = wilson(wins, games);
    return {
      ...est,
      seat,
      withinInterval: est.lo <= share && share <= est.hi,
      deviationPP: est.rate - share,
    };
  });

  const worst = Math.max(...perSeat.map((s) => Math.abs(s.deviationPP)));
  return {
    players, games, expected, perSeat,
    fair: perSeat.every((s) => s.withinInterval) && worst < FAIRNESS.seatWinRatePP,
    worstDeviationPP: worst,
  };
}

export interface PolicyStanding {
  policy: string;
  seatsPlayed: number;
  wins: number;
  winRate: RateEstimate;
  meanNetWorth: number;
}

export interface SkillGradient {
  standings: PolicyStanding[];
  /** hard > medium > easy, with non-overlapping intervals. */
  monotone: boolean;
  separated: boolean;
}

export async function skillGradient(games: number, seedBase = 40_000): Promise<SkillGradient> {
  const standings = await roundRobin(['easy', 'medium', 'hard'], 3, games, seedBase);
  const by = (name: string) => standings.find((s) => s.policy === name)!;
  const monotone = by('hard').winRate.rate > by('medium').winRate.rate
    && by('medium').winRate.rate > by('easy').winRate.rate;
  const separated = by('hard').winRate.lo > by('easy').winRate.hi;
  return { standings, monotone, separated };
}

export async function strategyFairness(games: number, seedBase = 50_000, rules?: Partial<CustomRules>): Promise<PolicyStanding[]> {
  // Four seats drawn from the five archetypes, rotated so each plays each seat.
  const lineup = ARCHETYPES.slice(0, 4);
  const standings = await roundRobin(lineup, 4, games, seedBase, rules);
  return standings;
}

/**
 * Round-robin between policies. Every policy occupies every seat an equal number
 * of times on the *same* seed sequence, so a difference between them cannot be a
 * seat effect or a bag-luck effect in disguise — the rotation is a duplicate-
 * bridge design applied to bots.
 */
export async function roundRobin(
  names: PolicyName[], players: number, gamesPerRotation: number, seedBase: number, rules?: Partial<CustomRules>,
): Promise<PolicyStanding[]> {
  const wins = new Map<string, number>();
  const seatsPlayed = new Map<string, number>();
  const worth = new Map<string, number[]>();
  for (const name of names) { wins.set(name, 0); seatsPlayed.set(name, 0); worth.set(name, []); }

  for (let rotation = 0; rotation < players; rotation++) {
    const lineup: PolicyName[] = Array.from({ length: players },
      (_, seat) => names[(seat + rotation) % names.length]);
    const records = await playBatch({ seats: seatsOf(lineup), games: gamesPerRotation, seedBase, rules });
    for (const record of records) {
      for (const seat of record.seats) {
        const name = lineup[seat.seat];
        seatsPlayed.set(name, (seatsPlayed.get(name) ?? 0) + 1);
        worth.get(name)!.push(seat.netWorth);
        if (record.winners.length === 1 && record.winners[0] === seat.seat) {
          wins.set(name, (wins.get(name) ?? 0) + 1);
        }
      }
    }
  }

  return names.map((name) => ({
    policy: name,
    seatsPlayed: seatsPlayed.get(name) ?? 0,
    wins: wins.get(name) ?? 0,
    winRate: wilson(wins.get(name) ?? 0, seatsPlayed.get(name) ?? 0),
    meanNetWorth: mean(worth.get(name) ?? []),
  }));
}

// -----------------------------------------------------------------------------
// Phase 4 — base-game rule sweeps
// -----------------------------------------------------------------------------

export interface SweepCell {
  rule: string;
  value: string;
  players: number;
  games: number;
  finishedRate: number;
  stallReasons: Record<string, number>;
  medianRounds: number;
  meanMergers: number;
  meanWinningTotal: number;
  /** Gap between best and worst seat at the table — how decisive the game is. */
  meanSpread: number;
  seatFairness: { worstDeviationPP: number; fair: boolean };
  /** Cash held by players at the end, averaged — the money-supply readout. */
  meanEndMoneyInPlay: number;
}

export const SWEEPS: { rule: keyof CustomRules; values: string[] }[] = [
  { rule: 'stockSelling', values: ['off', '100', '90', '75', '50'] },
  { rule: 'chainSafety', values: ['none', '9', '11', '13', '15'] },
  { rule: 'bonusTier', values: ['standard', 'flat', 'aggressive'] },
  { rule: 'startingCash', values: ['4000', '6000', '8000'] },
  { rule: 'startingTiles', values: ['5', '6', '7'] },
  { rule: 'boardSize', values: ['large', 'small'] },
];

export async function ruleSweep(
  rule: keyof CustomRules, value: string, players: number, games: number, seedBase: number,
): Promise<SweepCell> {
  const seats = uniformSeats('hard', players);
  const rules = { [rule]: value } as Partial<CustomRules>;
  const records = await playBatch({ seats, games, seedBase, rules });
  return summariseCell(String(rule), value, players, records);
}

export function summariseCell(rule: string, value: string, players: number, records: GameRecord[]): SweepCell {
  const stallReasons: Record<string, number> = {};
  for (const r of records) if (r.stallReason) stallReasons[r.stallReason] = (stallReasons[r.stallReason] ?? 0) + 1;

  const spreads = records.map((r) => {
    const totals = r.seats.map((s) => s.netWorth);
    return Math.max(...totals) - Math.min(...totals);
  });
  const winningTotals = records.map((r) => Math.max(...r.seats.map((s) => s.netWorth)));

  const perSeat = Array.from({ length: players }, (_, seat) => {
    const wins = records.filter((r) => r.winners.length === 1 && r.winners[0] === seat).length;
    return wilson(wins, records.length);
  });
  const expected = 1 / players;
  const worstDeviationPP = Math.max(...perSeat.map((s) => Math.abs(s.rate - expected)));

  return {
    rule, value, players,
    games: records.length,
    finishedRate: records.filter((r) => r.outcome === 'finished').length / records.length,
    stallReasons,
    medianRounds: percentile(records.map((r) => r.rounds), 0.5),
    meanMergers: mean(records.map((r) => r.mergers)),
    meanWinningTotal: mean(winningTotals),
    meanSpread: mean(spreads),
    seatFairness: {
      worstDeviationPP,
      fair: perSeat.every((s) => s.lo <= expected && expected <= s.hi) && worstDeviationPP < FAIRNESS.seatWinRatePP,
    },
    meanEndMoneyInPlay: mean(records.map((r) => r.moneyInPlay.at(-1)?.total ?? 0)),
  };
}

/**
 * The sell-factor question specifically. A parameter is fair when it creates a
 * genuine choice, so the test is not "does the metric move" but "does the
 * archetype that uses it beat the field". aggressive-seller against three hard
 * bots, at each factor.
 */
export async function sellFactorChoice(games: number, seedBase = 60_000): Promise<{ value: string; standing: PolicyStanding }[]> {
  const out: { value: string; standing: PolicyStanding }[] = [];
  for (const value of ['100', '90', '75', '50']) {
    const standings = await roundRobin(
      ['aggressive-seller', 'hard', 'hard', 'hard'], 4, games, seedBase,
      { stockSelling: value } as Partial<CustomRules>,
    );
    out.push({ value, standing: standings[0] });
  }
  return out;
}

export { BASELINE_RULES };
export const netWorthSummary = (records: GameRecord[]) =>
  meanInterval(records.flatMap((r) => r.seats.map((s) => s.netWorth)));
