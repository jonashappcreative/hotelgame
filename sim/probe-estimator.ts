// =============================================================================
// probe-estimator — is a never-played card weak, or invisible?
// =============================================================================
// Scenario B reports several cards at a 0% play rate. That has two very
// different explanations and the difference decides whether it is a finding
// about the design or a caveat about the instrument:
//
//   the card is rarely legal            — a fact about the card
//   the card is legal and worth nothing — a fact about the card
//   the card is legal and worth a lot,
//     but its worth is not the actor's
//     own immediate net worth           — a blind spot in the estimator
//
// This walks real positions from live games and reports, per card, how often it
// was legal and what the estimator said it was worth. A card that is legal
// almost everywhere and valued at exactly $0 everywhere is the third case.
//
//   node .sim-build/sim/probe-estimator.js
// =============================================================================

import './boot';
import { silenceEngineLogs, report } from './log';
import { Sim } from './harness';
import { uniformSeats } from './policies';
import { DECK_POOL, myopicValue, type EvalContext } from './deck';
import { DEFAULT_POOL_CONFIG } from './effects';
import { rule, pad, padLeft, money, pct } from './progress';

const PRICE = 200;

async function main() {
  silenceEngineLogs();
  const stats = new Map<string, { legal: number; seen: number; values: number[] }>();
  for (const card of DECK_POOL) stats.set(card.id, { legal: 0, seen: 0, values: [] });

  const seats = uniformSeats('hard', 4);
  const scratch = new Sim({ seats, seed: 1 });
  let positions = 0;

  for (let g = 0; g < 40; g++) {
    const sim = new Sim({
      seats, seed: 300_000 + g,
      onTurnStart: (ctx) => {
        // Every third turn, so positions are spread across the whole game arc
        // rather than clustered where turns are cheapest.
        if (ctx.round % 3 !== 0) return;
        positions++;
        const base = sim.db.snapshot();
        const evalCtx: EvalContext = {
          sim, seat: ctx.seat, config: DEFAULT_POOL_CONFIG,
          rnd: Math.random, scratch, base,
        };
        for (const card of DECK_POOL) {
          const s = stats.get(card.id)!;
          s.seen++;
          const v = myopicValue(evalCtx, card, PRICE);
          if (!Number.isFinite(v)) continue;
          s.legal++;
          s.values.push(v);
        }
      },
    });
    await sim.setup();
    await sim.run();
  }

  report(rule(`estimator probe — ${positions} live positions from 40 games, price $${PRICE}`));
  report(`  ${pad('card', 24)}${padLeft('legal%', 9)}${padLeft('mean', 11)}${padLeft('max', 11)}` +
    `${padLeft('exactly $0', 12)}${padLeft('>= 1x price', 13)}  reading`);

  const rows = DECK_POOL.map((card) => {
    const s = stats.get(card.id)!;
    const vals = s.values;
    const zero = vals.filter((v) => Math.abs(v) < 1).length;
    const overBar = vals.filter((v) => v >= PRICE).length;
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const max = vals.length ? Math.max(...vals) : 0;
    const legalRate = s.seen ? s.legal / s.seen : 0;
    const zeroRate = vals.length ? zero / vals.length : 1;

    const reading =
      legalRate < 0.05 ? 'rarely legal — a fact about the card'
      : zeroRate > 0.95 ? 'BLIND SPOT — legal everywhere, estimator scores it $0'
      : overBar === 0 ? 'legal but never clears one price — genuinely weak here'
      : 'measured';
    return { card, legalRate, mean, max, zeroRate, overBar, reading };
  }).sort((a, b) => a.reading.localeCompare(b.reading) || b.mean - a.mean);

  for (const r of rows) {
    report(`  ${pad(r.card.id, 24)}${padLeft(pct(r.legalRate, 0), 9)}${padLeft(money(r.mean), 11)}` +
      `${padLeft(money(r.max), 11)}${padLeft(pct(r.zeroRate, 0), 12)}${padLeft(String(r.overBar), 13)}  ${r.reading}`);
  }
}

main().catch((err) => { report(err); process.exit(1); });
