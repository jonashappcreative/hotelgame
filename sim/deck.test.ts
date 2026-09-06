// =============================================================================
// deck.test — the Phase 0 gates the whole study rests on
// =============================================================================
// If determinism fails, nothing downstream is valid: the matched-pair design in
// Scenario A assumes a game is a pure function of its seed, and the kingmaking
// counterfactual assumes a replay reproduces the original up to the suppressed
// play. These are the assertions that make that assumption checkable rather
// than assumed.
// =============================================================================

import './boot';
import { describe, it, expect, beforeAll } from 'vitest';
import { silenceEngineLogs } from './log';
import { playGame } from './harness';
import { uniformSeats } from './policies';
import { playDeckGame, DECK_POOL } from './deck';
import { playRecord } from './deck-study';

const seats = () => uniformSeats('hard', 4);
const seatNames = ['hard', 'hard', 'hard', 'hard'] as const;

beforeAll(() => { silenceEngineLogs(); });

describe('determinism', () => {
  it('replays a base game move for move on the same seed', async () => {
    const a = await playGame({ seats: seats(), seed: 4242 });
    const b = await playGame({ seats: seats(), seed: 4242 });
    expect(a.result.log).toEqual(b.result.log);
    expect(a.result.log.length).toBeGreaterThan(50);
    expect(a.result.rounds).toBe(b.result.rounds);
  });

  it('gives different seeds different games', async () => {
    const a = await playGame({ seats: seats(), seed: 4242 });
    const b = await playGame({ seats: seats(), seed: 4243 });
    expect(a.result.log).not.toEqual(b.result.log);
  });

  it('replays a deck game, including the card sequence', async () => {
    const opts = {
      seats: seats(), seed: 9003, deckSeats: [1],
      policy: 'always-buy-greedy' as const, price: 400,
    };
    const a = await playDeckGame(opts);
    const b = await playDeckGame(opts);
    expect(a.plays).toEqual(b.plays);
    expect(a.seatScores).toEqual(b.seatScores);
    expect(a.rounds).toBe(b.rounds);
  });
});

describe('the deck layer does not disturb the game it measures', () => {
  // The single most load-bearing property in Scenario A: deck-on and deck-off
  // twins must share their luck until the deck actually does something. The
  // ev-threshold policy evaluates all 21 cards every round to decide whether to
  // buy, so if speculation leaked into the game's random stream this would fail.
  it('is identical to the no-deck baseline when no card is ever affordable', async () => {
    const base = await playDeckGame({
      seats: seats(), seed: 5150, deckSeats: [],
      policy: 'ev-threshold', price: 400,
    });
    const priced = await playDeckGame({
      seats: seats(), seed: 5150, deckSeats: [1],
      policy: 'ev-threshold', price: 10_000_000,
    });
    expect(priced.seatScores).toEqual(base.seatScores);
    expect(priced.rounds).toBe(base.rounds);
    expect(priced.mergers).toBe(base.mergers);
    expect(priced.deckStats[0].cardsBought).toBe(0);
  });

  // The same property for the arm that *does* want to buy every round, so the
  // decline counter is exercised too.
  it('records an affordability decline every round a greedy buyer cannot pay', async () => {
    const base = await playDeckGame({
      seats: seats(), seed: 5150, deckSeats: [],
      policy: 'always-buy-greedy', price: 400,
    });
    const priced = await playDeckGame({
      seats: seats(), seed: 5150, deckSeats: [1],
      policy: 'always-buy-greedy', price: 10_000_000,
    });
    expect(priced.seatScores).toEqual(base.seatScores);
    expect(priced.deckStats[0].cardsBought).toBe(0);
    expect(priced.deckStats[0].affordabilityDeclines).toBe(priced.deckStats[0].buyOpportunities);
    expect(priced.deckStats[0].affordabilityDeclines).toBeGreaterThan(0);
  });

  it('plays the same deck-disabled game whichever seat notionally holds the deck', async () => {
    // Sequentially, not Promise.all: Sim.activate installs its MemoryDb as the
    // process-wide db backend, so two games in flight at once would share one
    // table set. Parallelism in this study lives at the worker-thread boundary,
    // where each isolate has its own backend.
    const runs = [];
    for (const deckSeat of [0, 1, 2, 3]) {
      runs.push(await playRecord({
        cell: 'test', seats: seats(), seatNames: [...seatNames], seed: 6161,
        deckSeat, mode: 'none', policy: 'ev-threshold', price: 400,
      }));
    }
    for (const run of runs.slice(1)) {
      expect(run.final_net_worth_by_seat).toEqual(runs[0].final_net_worth_by_seat);
      expect(run.rounds_played).toBe(runs[0].rounds_played);
      expect(run.merger_count).toBe(runs[0].merger_count);
    }
  });
});

describe('the engine accepts every state the deck produces', () => {
  it('drives deck games to a natural end with no rejected moves', async () => {
    for (const policy of ['always-buy-greedy', 'ev-threshold'] as const) {
      for (let i = 0; i < 8; i++) {
        const game = await playDeckGame({
          seats: seats(), seed: 9000 + i, deckSeats: [i % 4], policy, price: 400,
        });
        expect(game.rejections, `${policy} seed ${9000 + i}`).toBe(0);
        expect(game.outcome, `${policy} seed ${9000 + i}`).toBe('finished');
      }
    }
  }, 30_000);

  it('excludes only the two cards that cannot be simulated', () => {
    const ids = DECK_POOL.map((c) => c.id);
    expect(ids).toHaveLength(21);
    expect(ids).not.toContain('insider-tip');
    expect(ids).not.toContain('board-seat');
  });
});

describe('the access rules bind', () => {
  it('never buys or plays more than one card per round, and never plays on the round it bought', async () => {
    const game = await playDeckGame({
      seats: seats(), seed: 7777, deckSeats: [2], policy: 'always-buy-greedy', price: 200,
    });
    const playRounds = game.plays.map((p) => p.round);
    expect(new Set(playRounds).size).toBe(playRounds.length);
    expect(game.deckStats[0].idleRounds.every((n) => n >= 1)).toBe(true);
    expect(game.deckStats[0].cardsBought).toBeLessThanOrEqual(game.rounds + 1);
  });
});
