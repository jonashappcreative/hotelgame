// =============================================================================
// probe-unplayed — why do three quarters of purchased cards never get played?
// =============================================================================
// Scenario B reports that 73.3% of cards bought are still in hand when the game
// ends. That single number has at least five different causes with completely
// different design implications, so it is decomposed here rather than guessed
// at. Every card that finished the game unplayed is attributed to the *best*
// opportunity it ever had:
//
//   no-time            bought so late that the one-round delay never elapsed
//   never-legal        off cooldown, but the engine would never have allowed it
//   blocked            legal AND over the bar, but the seat's one play that
//                      round went to a different card — the rate limit binding
//   below-bar          legal, worth something, but never enough to clear the
//                      policy's hold bar — the bot declining on value
//   invisible          legal, but the estimator scored it exactly $0 every time
//                      it was ever held — a blind spot, not a decision
//
// The last two are the ones that look identical in the aggregate number and mean
// opposite things.
//
//   node .sim-build/sim/probe-unplayed.js [games]
// =============================================================================

import './boot';
import { silenceEngineLogs, report } from './log';
import { playDeckGame, type AuditRound } from './deck';
import { uniformSeats } from './policies';
import { rule, pad, padLeft, pct, money } from './progress';

const PRICE = 200;
const SEED_BASE = 100_000;

type Reason = 'no-time' | 'never-legal' | 'blocked' | 'over-bar-idle' | 'below-bar' | 'invisible';

interface Held {
  key: string;
  cardId: string;
  boughtRound: number;
  everOffCooldown: boolean;
  everLegal: boolean;
  everOverBar: boolean;
  overBarWhileBlocked: boolean;
  overBarWhileIdle: boolean;
  everNonZero: boolean;
  bestValue: number;
  rounds: number;
}

async function main() {
  silenceEngineLogs();
  const games = parseInt(process.argv[2] ?? '150', 10);
  const seats = uniformSeats('hard', 4);

  const reasons: Record<Reason, number> = {
    'no-time': 0, 'never-legal': 0, blocked: 0, 'over-bar-idle': 0, 'below-bar': 0, invisible: 0,
  };
  const perCard = new Map<string, Record<Reason, number>>();
  const bestValues: Record<Reason, number[]> = {
    'no-time': [], 'never-legal': [], blocked: [], 'over-bar-idle': [], 'below-bar': [], invisible: [],
  };
  let bought = 0;
  let played = 0;
  let unplayed = 0;
  let auditedRounds = 0;
  // Of the cards declined on value, how many ever reached one price? Those would
  // have been played under a flat par bar, so they measure the cost of the
  // policy's decaying hold multiple rather than the weakness of the card.
  let belowBarButEverReachedPar = 0;
  let belowBarTotal = 0;

  for (let g = 0; g < games; g++) {
    // One tracker per (seat, cardId, boughtRound) — the identity of a card sitting
    // in a hand across rounds.
    const held = new Map<string, Held>();

    const onAudit = (info: AuditRound) => {
      auditedRounds++;
      const slotUsed = info.played !== null;
      for (const card of info.hand) {
        const key = `${info.seat}:${card.cardId}:${card.boughtRound}`;
        let h = held.get(key);
        if (!h) {
          h = {
            key, cardId: card.cardId, boughtRound: card.boughtRound,
            everOffCooldown: false, everLegal: false, everOverBar: false,
            overBarWhileBlocked: false, overBarWhileIdle: false, everNonZero: false,
            bestValue: Number.NEGATIVE_INFINITY, rounds: 0,
          };
          held.set(key, h);
        }
        h.rounds++;
        if (!card.offCooldown) continue;
        h.everOffCooldown = true;
        if (!card.legal) continue;
        h.everLegal = true;
        const v = card.value ?? 0;
        if (v > h.bestValue) h.bestValue = v;
        if (Math.abs(v) >= 1) h.everNonZero = true;
        if (v >= card.bar) {
          h.everOverBar = true;
          if (slotUsed) h.overBarWhileBlocked = true;
          else h.overBarWhileIdle = true;
        }
      }
    };

    const game = await playDeckGame({
      seats, seed: SEED_BASE + g, deckSeats: [0, 1, 2, 3],
      policy: 'ev-threshold', price: PRICE, onAudit,
    });

    for (const stat of game.deckStats) {
      bought += stat.cardsBought;
      played += stat.cardsPlayed;
    }

    // Attribute every card still in hand at the end.
    for (const stat of game.deckStats) {
      for (const card of stat.cardIdsUnplayed) {
        // Match the tracker for this seat's unplayed copy — the latest one that
        // was never resolved is the one still in hand.
        const candidates = [...held.values()].filter(
          (h) => h.key.startsWith(`${stat.seat}:${card}:`),
        );
        const h = candidates[candidates.length - 1];
        unplayed++;
        let reason: Reason;
        if (!h || !h.everOffCooldown) reason = 'no-time';
        else if (!h.everLegal) reason = 'never-legal';
        else if (h.everOverBar) reason = h.overBarWhileBlocked ? 'blocked' : 'over-bar-idle';
        else if (!h.everNonZero) reason = 'invisible';
        else reason = 'below-bar';

        if (reason === 'below-bar') {
          belowBarTotal++;
          if (h && h.bestValue >= PRICE) belowBarButEverReachedPar++;
        }
        reasons[reason]++;
        if (h && Number.isFinite(h.bestValue)) bestValues[reason].push(h.bestValue);
        if (!perCard.has(card)) {
          perCard.set(card, { 'no-time': 0, 'never-legal': 0, blocked: 0, 'over-bar-idle': 0, 'below-bar': 0, invisible: 0 });
        }
        perCard.get(card)![reason]++;
      }
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  report(rule(`unplayed-card autopsy — ${games} symmetric games at $${PRICE}`));
  report(`  ${bought} cards bought, ${played} played, ${unplayed} still in hand at the end (${pct(unplayed / bought, 1)})`);
  report(`  ${auditedRounds} audited seat-rounds`);
  report('');
  report(`  ${pad('reason', 16)}${padLeft('cards', 9)}${padLeft('share', 9)}${padLeft('best value seen', 18)}  meaning`);

  const meanings: Record<Reason, string> = {
    'no-time': 'bought too late — the delay never elapsed',
    'never-legal': 'the engine would never have allowed it',
    blocked: 'wanted to play it, the one-play-per-round slot was taken',
    'over-bar-idle': 'cleared the bar in an idle round — audit/policy value drift, not a decision',
    'below-bar': 'legal and valued, but the bot judged it not worth playing yet',
    invisible: 'estimator scored it $0 every round — a blind spot, not a decision',
  };
  const order: Reason[] = ['blocked', 'below-bar', 'invisible', 'no-time', 'never-legal', 'over-bar-idle'];
  for (const reason of order) {
    report(`  ${pad(reason, 16)}${padLeft(String(reasons[reason]), 9)}${padLeft(pct(reasons[reason] / unplayed, 1), 9)}` +
      `${padLeft(money(mean(bestValues[reason])), 18)}  ${meanings[reason]}`);
  }

  report('');
  report(`  of the ${belowBarTotal} declined on value, ${belowBarButEverReachedPar} ` +
    `(${pct(belowBarTotal ? belowBarButEverReachedPar / belowBarTotal : 0, 1)}) did reach one price at some point — ` +
    `those are the ones the decaying hold bar cost, the rest never reached par at all`);
  report('');
  report(rule('  by card', 78));
  report(`  ${pad('card', 24)}${padLeft('unplayed', 10)}${order.map((r) => padLeft(r, 12)).join('')}`);
  for (const [card, counts] of [...perCard.entries()].sort(
    (a, b) => Object.values(b[1]).reduce((x, y) => x + y, 0) - Object.values(a[1]).reduce((x, y) => x + y, 0),
  )) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    report(`  ${pad(card, 24)}${padLeft(String(total), 10)}${order.map((r) => padLeft(pct(counts[r] / total, 0), 12)).join('')}`);
  }
}

main().catch((err) => { report(err); process.exit(1); });
