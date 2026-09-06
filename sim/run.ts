// =============================================================================
// run — the study driver
// =============================================================================
//   node .sim-build/sim/run.js --phase all
//   node .sim-build/sim/run.js --phase cards --rollouts 64 --corpus 40
//   node .sim-build/sim/run.js --card demolition-permit
//
// Writes one JSON artifact per phase into sim/out/. Nothing here formats prose:
// report.ts turns these artifacts into the written report, and the workbench
// reads the card artifact directly. That separation is what lets the pool be
// re-scored against a different price without re-simulating anything.
// =============================================================================

import './boot';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { silenceEngineLogs, report } from './log';
import { runJobs, defaultWorkers } from './pool';
import type { Job, JobResult, CorpusSpec, BatchJob } from './jobs';
import type { GameRecord } from './metrics';
import { summariseCell, harnessHealth, seatFairness, skillGradient, roundRobin, SWEEPS } from './studies';
import { wilson, mean, percentile } from './stats';
import { clock, rule, money, pct, pad, padLeft } from './progress';
import { FAIRNESS, ACCESS_DEFAULTS, TIER_PRICES } from './thresholds';
import { CARDS, DEFAULT_POOL_CONFIG, leverGrid, defaultLevers, leverLabel, type CardDef } from './effects';
import { applyBands, type CardCell } from './valuation';
import { buildEconomyReport } from './economy';
import type { PolicyName } from './policies';

const OUT_DIR = join(__dirname, '..', '..', 'sim', 'out');

interface Args {
  phase: string;
  games: number;
  rollouts: number;
  corpusGames: number;
  perGame: number;
  leverCap: number;
  workers: number;
  card?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    phase: get('--phase', 'all'),
    games: parseInt(get('--games', '400'), 10),
    rollouts: parseInt(get('--rollouts', '48'), 10),
    corpusGames: parseInt(get('--corpus', '30'), 10),
    perGame: parseInt(get('--per-game', '2'), 10),
    leverCap: parseInt(get('--lever-cap', '8'), 10),
    workers: parseInt(get('--workers', String(defaultWorkers())), 10),
    card: argv.indexOf('--card') >= 0 ? argv[argv.indexOf('--card') + 1] : undefined,
  };
}

function write(name: string, data: unknown): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  report(`  wrote ${path}`);
}

/** Split a large game batch into equal shards so the pool has something to parallelise. */
function batchJobs(label: string, seats: PolicyName[], games: number, seedBase: number, shards: number, rules?: Record<string, string>): BatchJob[] {
  const per = Math.ceil(games / shards);
  const out: BatchJob[] = [];
  for (let i = 0; i < shards && i * per < games; i++) {
    out.push({
      kind: 'batch', label,
      seats,
      games: Math.min(per, games - i * per),
      seedBase: seedBase + i * per,
      rules,
    });
  }
  return out;
}

function recordsOf(results: JobResult[], label: string): GameRecord[] {
  return results
    .filter((r): r is Extract<JobResult, { kind: 'batch' }> => r.kind === 'batch' && r.label === label)
    .flatMap((r) => r.records);
}

// -----------------------------------------------------------------------------

async function phaseHealth(args: Args) {
  report('');
  report(rule('PHASE 1 — harness health (does it drive the real engine cleanly?)'));
  const games = Math.min(args.games, 300);
  report(`  ${clock()} playing ${games} four-player games through handleGameAction...`);
  const health = await harnessHealth(games);
  write('health.json', health);

  report('');
  report(`  ${pad('games played', 28)} ${health.games}`);
  report(`  ${pad('rejected moves', 28)} ${health.rejections}   ${health.rejections === 0 ? '(engine fidelity holds)' : '<<< ILLEGAL MOVES — nothing downstream is trustworthy'}`);
  report(`  ${pad('same seed, same move log', 28)} ${health.deterministic ? 'yes' : 'NO — reproducibility is broken'}`);
  report(`  ${pad('outcomes', 28)} ${Object.entries(health.outcomes).map(([k, v]) => `${k} ${v}`).join('   ')}`);
  if (Object.keys(health.stallReasons).length) {
    report(`  ${pad('stall reasons', 28)} ${Object.entries(health.stallReasons).map(([k, v]) => `${k} ${v}`).join('   ')}`);
  }
  report(`  ${pad('median rounds / mergers', 28)} ${health.medianRounds} / ${health.medianMergers}`);
  report(`  ${pad('median engine actions', 28)} ${health.medianMoves}`);
  return health;
}

async function phaseValidate(args: Args) {
  report('');
  report(rule('PHASE 3 — validation (is the model believable before it prices anything?)'));
  const jobs: Job[] = [];
  // Seat fairness at 3, 4 and 5 players, identical agents in every seat.
  for (const players of [3, 4, 5]) {
    jobs.push(...batchJobs(
      `seat-${players}`,
      Array(players).fill('hard') as PolicyName[],
      args.games * 6, 20_000 + players * 100_000, args.workers,
    ));
  }
  const results = await runJobs(jobs, { workers: args.workers, label: 'seat-fairness batches' });

  const seat = [3, 4, 5].map((players) => {
    const records = recordsOf(results, `seat-${players}`);
    const outright = records.filter((r) => r.winners.length === 1).length;
    const share = (outright / records.length) / players;
    const perSeat = Array.from({ length: players }, (_, s) => {
      const wins = records.filter((r) => r.winners.length === 1 && r.winners[0] === s).length;
      const est = wilson(wins, records.length);
      return { seat: s, ...est, deviationPP: est.rate - share, withinInterval: est.lo <= share && share <= est.hi };
    });
    const worst = Math.max(...perSeat.map((p) => Math.abs(p.deviationPP)));
    return {
      players, games: records.length, share, perSeat,
      worstDeviationPP: worst,
      fair: perSeat.every((p) => p.withinInterval) && worst < FAIRNESS.seatWinRatePP,
      medianRounds: percentile(records.map((r) => r.rounds), 0.5),
      finishedRate: records.filter((r) => r.outcome === 'finished').length / records.length,
    };
  });

  const gradient = await skillGradient(Math.max(60, Math.floor(args.games / 2)));
  const strategy = await roundRobin(
    ['budget-focused', 'premium-focused', 'merger-hunter', 'cash-hoarder'],
    4, Math.max(60, Math.floor(args.games / 2)), 50_000,
  );
  const sellStrategy = await roundRobin(
    ['aggressive-seller', 'hard', 'hard', 'hard'],
    4, Math.max(60, Math.floor(args.games / 2)), 60_000, { stockSelling: '75' } as any,
  );

  const out = { seat, gradient, strategy, sellStrategy, thresholds: FAIRNESS };
  write('validate.json', out);

  report('');
  report(`  SEAT FAIRNESS — identical agents in every seat; each should win an equal share`);
  report(`  ${pad('table', 8)}${pad('games', 8)}${pad('per-seat win rate', 44)}${pad('worst dev', 11)}verdict`);
  for (const s of seat) {
    const rates = s.perSeat.map((p) => pct(p.rate, 1)).join('  ');
    report(`  ${pad(`${s.players}p`, 8)}${pad(String(s.games), 8)}${pad(rates, 44)}` +
      `${pad(`${(s.worstDeviationPP * 100).toFixed(2)}pp`, 11)}${s.fair ? 'fair' : 'FLAGGED'}`);
  }
  report(`  pre-registered threshold: a seat edge below ${(FAIRNESS.seatWinRatePP * 100).toFixed(1)}pp is not worth acting on`);

  report('');
  report(`  SKILL GRADIENT — round-robin, every difficulty in every seat, same seeds`);
  for (const st of gradient.standings) {
    report(`  ${pad(st.policy, 20)} win ${padLeft(pct(st.winRate.rate, 1), 6)}  ` +
      `[${pct(st.winRate.lo, 1)}, ${pct(st.winRate.hi, 1)}]  mean net worth ${padLeft(money(st.meanNetWorth), 9)}  (${st.seatsPlayed} seats)`);
  }
  report(`  monotone hard>medium>easy: ${gradient.monotone ? 'yes' : 'NO'}   intervals separated: ${gradient.separated ? 'yes' : 'NO'}`);

  report('');
  report(`  STRATEGY FAIRNESS — is any line dominant? (archetypes, rotated through every seat)`);
  for (const st of strategy) {
    report(`  ${pad(st.policy, 20)} win ${padLeft(pct(st.winRate.rate, 1), 6)}  ` +
      `[${pct(st.winRate.lo, 1)}, ${pct(st.winRate.hi, 1)}]  mean net worth ${padLeft(money(st.meanNetWorth), 9)}`);
  }
  report('');
  report(`  SELLING AS A STRATEGY — aggressive-seller against three "hard" bots, sell factor 75%`);
  for (const st of sellStrategy.slice(0, 2)) {
    report(`  ${pad(st.policy, 20)} win ${padLeft(pct(st.winRate.rate, 1), 6)}  ` +
      `[${pct(st.winRate.lo, 1)}, ${pct(st.winRate.hi, 1)}]  mean net worth ${padLeft(money(st.meanNetWorth), 9)}`);
  }
  return out;
}

async function phaseSweeps(args: Args) {
  report('');
  report(rule('PHASE 4 — base-game rule sweeps (a rule is a permanent, always-on card)'));
  const jobs: Job[] = [];
  const cells: { rule: string; value: string; players: number; label: string }[] = [];

  for (const sweep of SWEEPS) {
    for (const value of sweep.values) {
      const label = `${sweep.rule}=${value}`;
      cells.push({ rule: String(sweep.rule), value, players: 4, label });
      jobs.push(...batchJobs(label, Array(4).fill('hard') as PolicyName[], args.games * 2,
        70_000 + cells.length * 10_000, Math.max(2, Math.floor(args.workers / 2)), { [String(sweep.rule)]: value }));
    }
  }
  for (const players of [2, 3, 4, 5, 6]) {
    const label = `players=${players}`;
    cells.push({ rule: 'playerCount', value: String(players), players, label });
    jobs.push(...batchJobs(label, Array(players).fill('hard') as PolicyName[], args.games * 2,
      200_000 + players * 10_000, Math.max(2, Math.floor(args.workers / 2))));
  }

  const results = await runJobs(jobs, { workers: args.workers, label: 'sweep batches' });
  const out = cells.map((cell) =>
    summariseCell(cell.rule, cell.value, cell.players, recordsOf(results, cell.label)));
  write('sweeps.json', out);

  report('');
  report(`  ${pad('rule', 16)}${pad('value', 10)}${padLeft('games', 6)}  ${padLeft('finish', 7)}  ${padLeft('rounds', 7)}  ` +
    `${padLeft('mergers', 8)}  ${padLeft('winner', 10)}  ${padLeft('spread', 10)}  ${padLeft('end cash', 10)}  seat`);
  let lastRule = '';
  for (const cell of out) {
    const ruleName = cell.rule === lastRule ? '' : cell.rule;
    lastRule = cell.rule;
    report(`  ${pad(ruleName, 16)}${pad(cell.value, 10)}${padLeft(String(cell.games), 6)}  ` +
      `${padLeft(pct(cell.finishedRate), 7)}  ${padLeft(cell.medianRounds.toFixed(0), 7)}  ` +
      `${padLeft(cell.meanMergers.toFixed(1), 8)}  ${padLeft(money(cell.meanWinningTotal), 10)}  ` +
      `${padLeft(money(cell.meanSpread), 10)}  ${padLeft(money(cell.meanEndMoneyInPlay), 10)}  ` +
      `${cell.seatFairness.fair ? 'ok' : 'FLAG'}`);
  }
  report(`  finish = share of games reaching a real end condition; spread = best seat minus worst`);
  return out;
}

function corpusSpec(args: Args): CorpusSpec {
  return { seats: ['hard', 'hard', 'hard', 'hard'], games: args.corpusGames, seedBase: 500_000, perGame: args.perGame };
}

async function phaseLambda(args: Args) {
  report('');
  report(rule('PHASE 2 — lambda, the marginal value of a dollar'));
  report('  Cash compounds through shares and bonuses, so $1 in hand is not $1 of final');
  report('  score. lambda is the exchange rate that makes a price and a value comparable.');
  const spec = corpusSpec(args);
  const total = spec.games * spec.perGame;
  const shards = Math.min(args.workers, Math.max(1, Math.floor(total / 4)));
  const per = Math.ceil(total / shards);
  const jobs: Job[] = Array.from({ length: shards }, (_, i) => ({
    kind: 'lambda', corpus: spec, states: per, offset: i * per,
    rollouts: Math.max(32, args.rollouts), seedBase: 900_000,
  }));
  const results = await runJobs(jobs, { workers: args.workers, label: 'lambda shards' });

  const perState = results.flatMap((r) => (r.kind === 'lambda' ? r.perState : []));
  const value = mean(perState.map((s) => s.lambda));
  const byStratum: Record<string, number> = {};
  for (const key of [...new Set(perState.map((s) => s.stratum))]) {
    byStratum[key] = mean(perState.filter((s) => s.stratum === key).map((s) => s.lambda));
  }
  const out = {
    lambda: value,
    p10: percentile(perState.map((s) => s.lambda), 0.1),
    p90: percentile(perState.map((s) => s.lambda), 0.9),
    states: perState.length,
    byStratum,
    perState,
  };
  write('lambda.json', out);

  report('');
  report(`  lambda = ${value.toFixed(3)}  — one dollar of cash in hand is worth $${value.toFixed(2)} of final score`);
  report(`  measured across ${perState.length} positions, ${Math.max(32, args.rollouts)} paired rollouts each (P10 ${out.p10.toFixed(2)}, P90 ${out.p90.toFixed(2)})`);
  report('');
  report(`  by game phase and standing:`);
  for (const [key, v] of Object.entries(byStratum).sort()) {
    report(`  ${pad(key, 20)} ${v.toFixed(3)}`);
  }
  report(`  par value of a $${ACCESS_DEFAULTS.flatPrice} card is therefore ${money(ACCESS_DEFAULTS.flatPrice * value)}`);
  return out;
}

async function phaseCards(args: Args, lambda: number) {
  report('');
  report(rule('PHASE 5 — card pricing'));
  const spec = corpusSpec(args);
  const measurable = CARDS.filter((c) => c.fidelity === 'exact' || c.fidelity === 'approx')
    .filter((c) => !args.card || c.id === args.card);

  const jobs: Job[] = measurable.map((card) => ({
    kind: 'card', cardId: card.id, corpus: spec,
    rollouts: args.rollouts, seedBase: 1_100_000,
    config: DEFAULT_POOL_CONFIG, leverCap: args.leverCap,
  }));

  const results = await runJobs(jobs, { workers: args.workers, label: 'cards' });
  const cellsByCard = new Map<string, CardCell[]>();
  for (const result of results) {
    if (result.kind === 'card') cellsByCard.set(result.cardId, result.cells);
  }

  const pool = CARDS.map((card) => renderCard(card, cellsByCard.get(card.id) ?? [], lambda));

  // The pool is scored at each card's default lever setting — the card doc's own
  // leaning — so the economy numbers describe the pool as currently written,
  // not the best cell of each card cherry-picked after the fact.
  const chosen: CardCell[] = [];
  for (const card of CARDS) {
    const cells = cellsByCard.get(card.id) ?? [];
    if (cells.length === 0) continue;
    const defaultLabel = leverLabel(card, defaultLevers(card));
    chosen.push(cells.find((c) => c.leverLabel === defaultLabel) ?? cells[0]);
  }

  const economy = buildEconomyReport(chosen, lambda);
  const out = {
    generatedAt: new Date().toISOString(),
    lambda,
    access: ACCESS_DEFAULTS,
    tierPrices: TIER_PRICES,
    config: DEFAULT_POOL_CONFIG,
    corpus: spec,
    rollouts: args.rollouts,
    leverCap: args.leverCap,
    pool,
    economy,
  };
  write('cards.json', out);

  report('');
  report(`  POOL AT DEFAULT LEVERS — par for a $${ACCESS_DEFAULTS.flatPrice} card is ${money(ACCESS_DEFAULTS.flatPrice * lambda)}`);
  report(`  ${pad('card', 22)}${pad('T', 3)}${padLeft('mean', 10)}${padLeft('P95', 10)}${padLeft('dead', 6)}` +
    `${padLeft('avail', 7)}${padLeft('skill+', 10)}  ${pad('@$200', 8)}${pad('@tier', 8)}fidelity`);
  for (const card of pool) {
    const best = card.cells.find((c) => c.isDefault) ?? card.cells[0];
    if (!best) {
      report(`  ${pad(card.name, 22)}${pad(String(card.tier), 3)}${padLeft('—', 10)}${padLeft('—', 10)}${padLeft('—', 6)}` +
        `${padLeft('—', 7)}${padLeft('—', 10)}  ${pad('—', 8)}${pad('—', 8)}${card.fidelity}`);
      continue;
    }
    report(`  ${pad(card.name, 22)}${pad(String(card.tier), 3)}${padLeft(money(best.mean), 10)}${padLeft(money(best.ceiling), 10)}` +
      `${padLeft(pct(best.deadRate), 6)}${padLeft(pct(best.availability), 7)}${padLeft(money(best.skillPremium), 10)}  ` +
      `${pad(best.verdictFlat.pass ? 'in band' : 'OUT', 8)}${pad(best.verdictTier.pass ? 'in band' : 'OUT', 8)}${card.fidelity}`);
  }

  report('');
  report(`  ECONOMY MODELS — the same value distributions, scored three ways`);
  report(`  A-random   deck average ${money(economy.aRandom.deckAverage)} vs par ${money(economy.aRandom.par)}  ` +
    `(error ${pct(economy.aRandom.error, 0)})  ${economy.aRandom.pass ? 'PASS' : 'FAIL'}`);
  report(`  A-open     band width ${economy.aOpen.bandWidth.toFixed(1)}x par  ` +
    `${economy.aOpen.autoBuys.length} auto-buy(s), ${economy.aOpen.deadText.length} dead  ${economy.aOpen.pass ? 'PASS' : 'FAIL'}`);
  for (const tier of economy.threeTier.tiers) {
    report(`  tier ${tier.tier} ($${tier.price})  ${tier.members.length} cards  ` +
      `midpoint error ${pct(tier.midpointError, 0)}  best ${money(tier.best)}  worst ${money(tier.worst)}`);
  }
  for (const violation of economy.threeTier.violations) report(`  !! ${violation}`);
  report(`  Board Seat (derived): expected best of ${economy.boardSeat.seen} draws ${money(economy.boardSeat.expectedBest)}, ` +
    `net ${money(economy.boardSeat.netValue)}`);
  return out;
}

/** Attach every band verdict a card needs, at both the flat price and its tier price. */
function renderCard(card: CardDef, cells: CardCell[], lambda: number) {
  const grid = leverGrid(card, 12);
  const defaults = defaultLevers(card);
  const defaultLabel = leverLabel(card, defaults);

  return {
    id: card.id,
    name: card.name,
    group: card.group,
    tier: card.tier,
    effect: card.effect,
    source: card.source,
    fidelity: card.fidelity,
    note: card.note ?? null,
    riskNote: card.riskNote ?? null,
    levers: card.levers,
    gridSize: grid.length,
    cells: cells.map((cell) => {
      // applyBands writes deadRate onto the cell, and "approximately nothing"
      // is defined relative to par — so the two prices give two dead rates and
      // each must be captured next to the verdict it belongs to.
      const verdictFlat = applyBands(cell, ACCESS_DEFAULTS.flatPrice, lambda);
      const deadRateFlat = cell.deadRate;
      const verdictTier = applyBands(cell, TIER_PRICES[card.tier], lambda);
      const deadRateTier = cell.deadRate;
      return {
        levers: cell.levers,
        label: cell.leverLabel,
        isDefault: cell.leverLabel === defaultLabel,
        mean: cell.mean,
        meanLo: cell.meanLo,
        meanHi: cell.meanHi,
        ceiling: cell.ceiling,
        deadRate: deadRateFlat,
        deadRateTier,
        naive: cell.naive,
        optimal: cell.optimal,
        skillPremium: cell.skillPremium,
        availability: cell.availability,
        legalStates: cell.legalStates,
        totalStates: cell.totalStates,
        rolloutsPerArm: cell.rolloutsPerArm,
        byPhase: cell.byPhase,
        byStanding: cell.byStanding,
        buyerWinDelta: cell.buyerWinDelta,
        fieldWinDelta: cell.fieldWinDelta,
        fieldSkew: cell.fieldSkew,
        verdictFlat,
        verdictTier,
        // Per-position values, for the workbench's distribution view. Kept as
        // bare arrays rather than objects to keep the artifact small.
        stateValues: cell.states.map((s) => Math.round(s.value)),
        stateRounds: cell.states.map((s) => s.round),
      };
    }),
  };
}

// -----------------------------------------------------------------------------

async function main() {
  silenceEngineLogs();
  const args = parseArgs(process.argv.slice(2));
  report(rule('Hotel Game — fairness and card valuation study'));
  report(`  phase=${args.phase}  workers=${args.workers}  games/cell=${args.games}  rollouts/arm=${args.rollouts}  ` +
    `corpus=${args.corpusGames}x${args.perGame}  lever-cap=${args.leverCap}`);
  report(`  baseline rules: the shipped defaults (chain safety off), 4 seats of "hard"`);
  const started = Date.now();

  const wants = (phase: string) => args.phase === 'all' || args.phase === phase;

  if (wants('health')) await phaseHealth(args);
  if (wants('validate')) await phaseValidate(args);
  if (wants('sweeps')) await phaseSweeps(args);

  let lambda = 1;
  if (wants('lambda') || wants('cards')) {
    const result = await phaseLambda(args);
    lambda = result.lambda;
  }
  if (wants('cards')) await phaseCards(args, lambda);

  report('');
  report(rule('done'));
  report(`  total ${((Date.now() - started) / 1000).toFixed(1)}s — artifacts in sim/out/`);
}

main().catch((err) => { report(err); process.exit(1); });
