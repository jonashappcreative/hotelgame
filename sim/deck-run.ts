// =============================================================================
// deck-run — the driver for the two deck-balance scenarios
// =============================================================================
//   node .sim-build/sim/deck-run.js --scenario a
//   node .sim-build/sim/deck-run.js --scenario b            (needs A's artifact)
//   node .sim-build/sim/deck-run.js --scenario all --seeds 100
//
// Raw records go to sim/results/*.jsonl; the summaries the report is written
// from go to sim/out/*.json. Scenario B refuses to start until Scenario A has
// produced its artifact, because B's price comes from A.
// =============================================================================

import './boot';
import { mkdirSync, writeFileSync, existsSync, readFileSync, createWriteStream } from 'fs';
import { join } from 'path';
import { silenceEngineLogs, report } from './log';
import { runJobs, defaultWorkers } from './pool';
import { clock, rule, money, pct, pad, padLeft } from './progress';
import { seatsOf } from './policies';
import { playRecord, type DeckRecord } from './deck-study';
import { ACCESS, DECK_POOL, HOLD_MULTIPLE, PHASE_BOUNDS } from './deck';
import type { JobResult } from './jobs';
import {
  scenarioAJobs, scenarioBJobs, summariseCell, baselineHealth, crossingPrice,
  compare, cardFrequencies, frustration, seatFairnessOf,
  PRICES, CONTROL_PRICES, POLICIES, SEATS, ROTATIONS, BASELINE_CELL, SCENARIO_B_CELL, cellId,
  DEFAULT_CONFIG, type ScenarioConfig, type CellSummary,
} from './scenarios';

const ROOT = join(__dirname, '..', '..');
const OUT_DIR = join(ROOT, 'sim', 'out');
const RESULTS_DIR = join(ROOT, 'sim', 'results');

interface Args { scenario: string; seeds: number; workers: number; kingmaking: number }

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    scenario: get('--scenario', 'all'),
    seeds: parseInt(get('--seeds', String(DEFAULT_CONFIG.seeds)), 10),
    workers: parseInt(get('--workers', String(defaultWorkers())), 10),
    kingmaking: parseInt(get('--kingmaking', '200'), 10),
  };
}

function writeJson(name: string, data: unknown): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  report(`  wrote ${path}`);
  return path;
}

function writeJsonl(name: string, records: DeckRecord[]): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const path = join(RESULTS_DIR, name);
  const stream = createWriteStream(path);
  for (const rec of records) stream.write(`${JSON.stringify(rec)}\n`);
  stream.end();
  report(`  wrote ${path}  (${records.length} games)`);
}

const recordsOf = (results: JobResult[], cell?: string): DeckRecord[] =>
  results
    .filter((r): r is Extract<JobResult, { kind: 'deck' }> => r.kind === 'deck' && (!cell || r.cell === cell))
    .flatMap((r) => r.records);

/** Baseline games are deck-disabled, so one game per seed serves all four rotations. */
const baselineIndex = (records: DeckRecord[]) => new Map(records.map((r) => [r.seed, r]));

// -----------------------------------------------------------------------------
// Scenario A
// -----------------------------------------------------------------------------

async function scenarioA(args: Args, cfg: ScenarioConfig) {
  report('');
  report(rule('Scenario A — price sweep with asymmetric deck access'));
  report(`  ${cfg.seeds} seeds x ${ROTATIONS.length} rotations x ${PRICES.length} prices x ${POLICIES.length} policies`);
  report(`  = ${cfg.seeds * ROTATIONS.length * PRICES.length * POLICIES.length} games, plus ${cfg.seeds} paired baseline games`);
  report(`  access: ${ACCESS.buysPerRound} buy/round, ${ACCESS.playsPerRound} play/round, ${ACCESS.playDelayRounds}-round delay, ${DECK_POOL.length}-card deck`);

  const started = Date.now();
  const results = await runJobs(scenarioAJobs(cfg), {
    workers: args.workers, label: 'scenario A', verbose: true,
  });
  const wall = (Date.now() - started) / 1000;

  const baseRecords = recordsOf(results, BASELINE_CELL);
  const baseline = baselineIndex(baseRecords);
  const health = baselineHealth(baseRecords);

  report('');
  report(rule('  sanity checks', 78));
  report(`  baseline seat win rates: ${health.seatWinRates.map((r) => pct(r, 1)).join('  ')}   spread ${pct(health.seatSpread, 1)}`);
  report(`  natural end rate: ${pct(health.naturalEndRate, 1)}   rejections: ${health.rejections}   ties: ${pct(health.tieRate, 1)}`);
  report(`  mean rounds ${health.meanRounds.toFixed(1)}   mean mergers ${health.meanMergers.toFixed(1)}   money at end ${money(health.meanTotalMoneyEnd)}`);

  const cells: CellSummary[] = [];
  const controls: CellSummary[] = [];
  const allRecords: DeckRecord[] = [...baseRecords];
  for (const policy of POLICIES) {
    for (const price of [...PRICES, ...CONTROL_PRICES]) {
      const id = cellId(policy, price);
      const recs = recordsOf(results, id);
      allRecords.push(...recs);
      (PRICES.includes(price) ? cells : controls).push(summariseCell(id, recs, baseline));
    }
  }

  report('');
  report(rule('  price curve — deck holder win rate against the 25% null', 78));
  report(`  ${pad('policy', 20)}${padLeft('price', 7)}${padLeft('win%', 8)}${padLeft('95% CI', 18)}` +
    `${padLeft('cash margin', 14)}${padLeft('net margin', 14)}${padLeft('decline%', 10)}`);
  for (const c of cells) {
    report(`  ${pad(c.policy, 20)}${padLeft(`$${c.price}`, 7)}${padLeft(pct(c.winRate, 1), 8)}` +
      `${padLeft(`[${pct(c.winLo, 1)}, ${pct(c.winHi, 1)}]`, 18)}` +
      `${padLeft(money(c.cashMarginDiff.mean), 14)}${padLeft(money(c.netMarginDiff.mean), 14)}` +
      `${padLeft(pct(c.declineRate, 1), 10)}`);
  }

  const crossings: Record<string, ReturnType<typeof crossingPrice>> = {};
  const extendedCrossings: Record<string, ReturnType<typeof crossingPrice>> = {};
  for (const policy of POLICIES) {
    crossings[policy] = crossingPrice(cells.filter((c) => c.policy === policy));
    const x = crossings[policy];
    report(`  crossing (${policy}): ${x.price === null ? 'none — ' : `$${x.price.toFixed(0)} — `}${x.reason}`);
  }

  report('');
  report(rule('  control cells — not part of the sweep', 78));
  for (const c of controls) {
    report(`  ${pad(c.policy, 20)}${padLeft(`$${c.price}`, 7)}${padLeft(pct(c.winRate, 1), 8)}` +
      `${padLeft(`[${pct(c.winLo, 1)}, ${pct(c.winHi, 1)}]`, 18)}` +
      `${padLeft(money(c.cashMarginDiff.mean), 14)}${padLeft(money(c.netMarginDiff.mean), 14)}` +
      `${padLeft(pct(c.declineRate, 1), 10)}`);
  }

  // A curve that has already reached the null at the bottom of the swept range
  // has no crossing *inside* the sweep, but the control cells bracket it. That
  // second estimate is computed and reported separately; it is never silently
  // substituted for the sweep's own answer.
  for (const policy of POLICIES) {
    const all = [...cells, ...controls].filter((c) => c.policy === policy);
    extendedCrossings[policy] = crossingPrice(all);
    const x = extendedCrossings[policy];
    report(`  crossing incl. controls (${policy}): ${x.price === null ? 'none — ' : `$${x.price.toFixed(0)} — `}${x.reason}`);
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    config: { ...cfg, prices: PRICES, controlPrices: CONTROL_PRICES, policies: POLICIES, seats: SEATS, rotations: ROTATIONS },
    access: { ...ACCESS, deckSize: DECK_POOL.length, deckCardIds: DECK_POOL.map((c) => c.id) },
    estimator: { holdMultiple: HOLD_MULTIPLE, phaseBounds: PHASE_BOUNDS },
    wallClockSeconds: wall,
    games: allRecords.length,
    baselineHealth: health,
    cells,
    controls,
    crossings,
    extendedCrossings,
  };
  writeJsonl('scenarioA.jsonl', allRecords);
  writeJson('scenarioA.json', artifact);
  return artifact;
}

// -----------------------------------------------------------------------------
// Scenario B
// -----------------------------------------------------------------------------

/**
 * The counterfactual pass. For every card play made by a seat that was not
 * leading, replay the game with that single play suppressed and see whether the
 * winner changes — and if it does, whether the beneficiary is somebody other
 * than the player who spent the card. Expensive (one full replay per qualifying
 * play), so it runs over a subsample rather than the whole arm.
 */
async function kingmaking(records: DeckRecord[], limit: number, price: number) {
  const subsample = records.slice(0, limit);
  const seats = seatsOf(SEATS);
  let qualifying = 0;
  let decisive = 0;
  let kingmade = 0;
  let selfServing = 0;
  // Placebo arm: same replay, same divergence, card still played.
  let placeboChanged = 0;
  let placeboThirdParty = 0;
  const started = Date.now();

  for (let i = 0; i < subsample.length; i++) {
    const rec = subsample[i];
    if (rec.winners.length !== 1) continue;
    const winner = rec.winners[0];
    for (const play of rec.plays) {
      if (play.leadingAtPlay) continue;
      qualifying++;
      const counterfactual = await playRecord({
        cell: 'B/counterfactual', seats, seatNames: SEATS, seed: rec.seed,
        deckSeat: null, mode: 'all-seats', policy: 'ev-threshold', price,
        suppressPlayIndex: play.index,
      });
      const placebo = await playRecord({
        cell: 'B/placebo', seats, seatNames: SEATS, seed: rec.seed,
        deckSeat: null, mode: 'all-seats', policy: 'ev-threshold', price,
        placeboPlayIndex: play.index,
      });
      if (placebo.winners.length === 1 && placebo.winners[0] !== winner) {
        placeboChanged++;
        if (winner !== play.seat) placeboThirdParty++;
      }

      if (counterfactual.winners.length !== 1) continue;
      if (counterfactual.winners[0] === winner) continue;
      decisive++;
      if (winner === play.seat) selfServing++;
      else kingmade++;
    }
    if ((i + 1) % 25 === 0) {
      report(`  ${clock()} kingmaking ${padLeft(`${i + 1}/${subsample.length}`, 8)} games  ` +
        `${qualifying} qualifying plays  ${decisive} decisive  ${kingmade} kingmaking  ${placeboChanged} placebo`);
    }
  }

  return {
    games: subsample.length,
    qualifyingPlays: qualifying,
    decisivePlays: decisive,
    decisiveRate: qualifying ? decisive / qualifying : 0,
    /** Decisive plays where the winner changed to somebody other than the card's user. */
    kingmakingPlays: kingmade,
    kingmakingRate: qualifying ? kingmade / qualifying : 0,
    selfServingPlays: selfServing,
    placeboChangedWinner: placeboChanged,
    placeboChangeRate: qualifying ? placeboChanged / qualifying : 0,
    placeboThirdPartyRate: qualifying ? placeboThirdParty / qualifying : 0,
    /** Decisive rate net of the placebo's chaos floor. The causal signal, if any. */
    decisiveExcessOverPlacebo: qualifying ? (decisive - placeboChanged) / qualifying : 0,
    seconds: (Date.now() - started) / 1000,
  };
}

function scenarioBPrices(): { price: number; note: string; tag: string }[] {
  const aPath = join(OUT_DIR, 'scenarioA.json');
  if (!existsSync(aPath)) {
    throw new Error('Scenario B needs Scenario A first — sim/out/scenarioA.json does not exist. Run --scenario a.');
  }
  const a = JSON.parse(readFileSync(aPath, 'utf8'));
  const swept = a.crossings?.['ev-threshold'];
  const extended = a.extendedCrossings?.['ev-threshold'];

  if (swept?.price != null) {
    return [{ price: Math.round(swept.price), tag: '', note: `Scenario A's ev-threshold crossing inside the swept range — ${swept.reason}.` }];
  }
  if (extended?.price != null) {
    // The plan's fallback exists for "A produced no crossing", meaning the fair
    // price is unknown. Here it is not unknown: the sweep's bottom cell is
    // already at the null and the control cells bracket the crossing. Running
    // the health check at $400 would describe a deck the measurement says
    // nobody would buy, so the bracketed price is the primary arm — and the
    // plan's literal $400 is run alongside it rather than skipped.
    return [
      { price: Math.round(extended.price / 10) * 10, tag: '', note: `no crossing inside the swept $200-$600 range (${swept?.reason}); the control cells bracket it — ${extended.reason}.` },
      { price: 400, tag: '-400', note: "the plan's literal fallback for \"A produced no crossing\", run as a secondary arm for comparison." },
    ];
  }
  return [{ price: 400, tag: '', note: `Scenario A produced no crossing (${swept?.reason}), so the plan's fallback of $400 is used.` }];
}

async function scenarioB(args: Args, cfg: ScenarioConfig, spec: { price: number; note: string; tag: string }) {
  const price = spec.price;
  const priceNote = spec.note;

  report('');
  report(rule('Scenario B — symmetric deck health run'));
  report(`  price: $${price}. ${priceNote}`);
  report(`  ${cfg.seeds} seeds x ${ROTATIONS.length} rotations, all four seats on ev-threshold`);

  const started = Date.now();
  const results = await runJobs(scenarioBJobs(cfg, price), {
    workers: args.workers, label: 'scenario B', verbose: true,
  });
  const deckRecords = recordsOf(results, SCENARIO_B_CELL);

  // The matched baseline is Scenario A's, replayed from its JSONL rather than
  // re-simulated: same seeds, same games, by construction.
  const baseRecords: DeckRecord[] = readFileSync(join(RESULTS_DIR, 'scenarioA.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line) as DeckRecord)
    .filter((r) => r.cell === BASELINE_CELL);
  const baseline = baselineIndex(baseRecords);

  const comparisons = [
    compare('rounds per game', deckRecords, baseline, (r) => r.rounds_played),
    compare('mergers per game', deckRecords, baseline, (r) => r.merger_count),
    compare('money in play at end', deckRecords, baseline, (r) => r.total_money_end),
    compare('winner net worth', deckRecords, baseline, (r) => Math.max(...r.final_net_worth_by_seat)),
    compare('net worth spread', deckRecords, baseline,
      (r) => Math.max(...r.final_net_worth_by_seat) - Math.min(...r.final_net_worth_by_seat)),
  ];

  report('');
  report(rule('  deck versus no-deck baseline, paired on seed', 78));
  report(`  ${pad('metric', 24)}${padLeft('deck', 14)}${padLeft('baseline', 14)}${padLeft('diff', 14)}${padLeft('95% CI', 24)}`);
  for (const c of comparisons) {
    report(`  ${pad(c.metric, 24)}${padLeft(c.deck.toFixed(1), 14)}${padLeft(c.baseline.toFixed(1), 14)}` +
      `${padLeft(c.paired.mean.toFixed(1), 14)}${padLeft(`[${c.bootstrap.lo.toFixed(1)}, ${c.bootstrap.hi.toFixed(1)}]`, 24)}`);
  }

  const natural = deckRecords.filter((r) => r.game_ended_naturally).length / deckRecords.length;
  const fairness = seatFairnessOf(deckRecords);
  const frequencies = cardFrequencies(deckRecords);
  const counters = frustration(deckRecords);

  report('');
  report(`  natural end rate: ${pct(natural, 1)} (baseline ${pct(baseRecords.filter((r) => r.game_ended_naturally).length / baseRecords.length, 1)})`);
  report(`  seat win rates: ${fairness.seatWinRates.map((r) => pct(r, 1)).join('  ')}   spread ${pct(fairness.spread, 1)}`);
  report(`  cards bought ${counters.cardsBought}, played ${counters.cardsPlayed}, never played ${pct(counters.neverPlayedShare, 1)}, mean idle ${counters.meanIdleRounds.toFixed(1)} rounds`);

  report('');
  report(rule('  per-card play frequency', 78));
  report(`  ${pad('card', 24)}${padLeft('plays', 8)}${padLeft('games', 8)}${padLeft('play% avail', 13)}${padLeft('unplayed', 10)}${padLeft('idle', 7)}`);
  for (const f of frequencies) {
    report(`  ${pad(f.cardId, 24)}${padLeft(String(f.plays), 8)}${padLeft(String(f.gamesPlayedIn), 8)}` +
      `${padLeft(pct(f.playRateWhenAvailable, 1), 13)}${padLeft(String(f.boughtNeverPlayed), 10)}${padLeft(f.meanIdleRounds.toFixed(1), 7)}`);
  }

  report('');
  const king = await kingmaking(deckRecords, args.kingmaking, price);
  report(`  kingmaking: ${king.qualifyingPlays} plays by a non-leader over ${king.games} games — ` +
    `${king.decisivePlays} changed the winner (${pct(king.decisiveRate, 1)}), ` +
    `${king.kingmakingPlays} handed it to a third party (${pct(king.kingmakingRate, 1)}) in ${king.seconds.toFixed(0)}s`);
  report(`  placebo (card still played, one random draw burned): ${king.placeboChangedWinner} winner changes ` +
    `(${pct(king.placeboChangeRate, 1)}) — excess attributable to the card: ${pct(king.decisiveExcessOverPlacebo, 1)}`);

  const artifact = {
    generatedAt: new Date().toISOString(),
    price,
    priceNote,
    config: { ...cfg, seats: SEATS },
    wallClockSeconds: (Date.now() - started) / 1000,
    games: deckRecords.length,
    naturalEndRate: natural,
    baselineNaturalEndRate: baseRecords.filter((r) => r.game_ended_naturally).length / baseRecords.length,
    comparisons,
    seatFairness: fairness,
    cardFrequencies: frequencies,
    frustration: counters,
    kingmaking: king,
  };
  writeJsonl(`scenarioB${spec.tag}.jsonl`, deckRecords);
  writeJson(`scenarioB${spec.tag}.json`, artifact);
  return artifact;
}

// -----------------------------------------------------------------------------

async function main() {
  silenceEngineLogs();
  const args = parseArgs(process.argv.slice(2));
  const cfg: ScenarioConfig = { ...DEFAULT_CONFIG, seeds: args.seeds };

  report(rule('Hotel Game — event card deck balance'));
  report(`  scenario=${args.scenario}  seeds=${cfg.seeds}  workers=${args.workers}`);
  const started = Date.now();

  if (args.scenario === 'a' || args.scenario === 'all') await scenarioA(args, cfg);
  if (args.scenario === 'b' || args.scenario === 'all') {
    for (const spec of scenarioBPrices()) await scenarioB(args, cfg, spec);
  }

  report('');
  report(rule('done'));
  report(`  total ${((Date.now() - started) / 1000).toFixed(1)}s — artifacts in sim/out/, raw games in sim/results/`);
}

main().catch((err) => { report(err); process.exit(1); });
