// =============================================================================
// probe-divergence — the plan's Scenario A spot check, by hand
// =============================================================================
// "Baseline and deck-on runs on the same seed should diverge only after the
// first card purchase." Asserted here against the actual move logs rather than
// argued from the design: for each seed, find the first move index at which the
// two logs differ and check it falls at or after the round the deck seat first
// paid for a card.
//
//   node .sim-build/sim/probe-divergence.js
// =============================================================================

import './boot';
import { silenceEngineLogs, report } from './log';
import { playDeckGame } from './deck';
import { uniformSeats } from './policies';
import { rule, pad, padLeft } from './progress';

async function main() {
  silenceEngineLogs();
  report(rule('divergence spot check — deck-on versus its matched baseline'));
  report(`  ${pad('seed', 8)}${padLeft('moves', 8)}${padLeft('1st diff', 10)}${padLeft('buy round', 11)}` +
    `${padLeft('round @ diff', 14)}  verdict`);

  let failures = 0;
  for (let i = 0; i < 12; i++) {
    const seed = 100_000 + i * 7;
    const opts = { seats: uniformSeats('hard', 4), seed, policy: 'always-buy-greedy' as const, price: 200 };
    const base = await playDeckGame({ ...opts, deckSeats: [] });
    const deck = await playDeckGame({ ...opts, deckSeats: [1] });

    let first = -1;
    const n = Math.min(base.log.length, deck.log.length);
    for (let j = 0; j < n; j++) {
      if (base.log[j] !== deck.log[j]) { first = j; break; }
    }
    if (first === -1 && base.log.length !== deck.log.length) first = n;

    // Which round was the divergent move in? Rounds are not in the log, so they
    // are counted the way the engine advances them: one per full pass of seats
    // through place_tile.
    let round = 1;
    for (let j = 0; j < Math.max(first, 0); j++) {
      if (base.log[j].startsWith('0:place_tile')) round++;
    }

    const buyRounds = deck.deckStats[0].buyRounds;
    const firstBuy = buyRounds.length ? buyRounds[0] : Infinity;
    // The real assertion: nothing may differ before the deck seat has spent a
    // dollar. A divergence in the same round as the purchase is expected — the
    // price comes out of the buyer's cash at the top of that round.
    const ok = first === -1 ? buyRounds.length === 0 : round >= firstBuy;
    if (!ok) failures++;

    report(`  ${pad(String(seed), 8)}${padLeft(String(base.log.length), 8)}` +
      `${padLeft(first === -1 ? 'none' : String(first), 10)}${padLeft(Number.isFinite(firstBuy) ? String(firstBuy) : '-', 11)}` +
      `${padLeft(first === -1 ? '-' : String(round), 14)}  ${ok ? 'ok' : 'DIVERGED BEFORE FIRST PURCHASE'}`);
  }

  report('');
  report(`  ${failures === 0 ? 'all pairs diverge at or after the first purchase' : `${failures} pair(s) diverged early`}`);
}

main().catch((err) => { report(err); process.exit(1); });
