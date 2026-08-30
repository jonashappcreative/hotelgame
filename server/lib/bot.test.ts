import { describe, it, expect } from 'vitest';
import { decideBotMove, type BotDifficulty } from './bot';
import { getStockPrice, type ChainName } from './rules';

const DIFFS: BotDifficulty[] = ['easy', 'medium', 'hard'];
const ALL: ChainName[] = ['sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial'];

const zeroStocks = () => Object.fromEntries(ALL.map((c) => [c, 0])) as Record<ChainName, number>;

function makeChains(active: Partial<Record<ChainName, string[]>>) {
  const chains: Record<string, any> = {};
  for (const c of ALL) {
    const tiles = active[c];
    chains[c] = { name: c, tiles: tiles ?? [], isActive: !!tiles, isSafe: (tiles?.length ?? 0) >= 11 };
  }
  return chains;
}

function baseState(overrides: any = {}) {
  return {
    current_player_index: 0,
    phase: 'place_tile',
    board: {} as Record<string, any>,
    chains: makeChains({}),
    stock_bank: Object.fromEntries(ALL.map((c) => [c, 25])) as Record<ChainName, number>,
    last_placed_tile: null,
    pending_chain_foundation: null,
    merger: null,
    stocks_purchased_this_turn: 0,
    round_number: 1,
    rules_snapshot: {},
    ...overrides,
  };
}

function actorOf(players: any[], idx = 0) {
  return players.find((p) => p.player_index === idx);
}

describe('decideBotMove — placement legality', () => {
  for (const diff of DIFFS) {
    it(`${diff}: places or discards a tile it actually holds`, () => {
      for (let i = 0; i < 50; i++) {
        const hand = ['1A', '3D', '5F', '7H', '9K', '2C'];
        const players = [{ player_index: 0, cash: 6000, stocks: zeroStocks(), tiles: hand, is_bot: true, bot_difficulty: diff }];
        const gs = baseState({ phase: 'place_tile' });
        const move = decideBotMove(diff, 'place_tile', gs, players, actorOf(players));
        expect(['place_tile', 'discard_tile']).toContain(move.action);
        expect(hand).toContain(move.payload.tileId);
      }
    });
  }

  it('discards a permanently-dead tile when no legal placement exists', () => {
    // Two safe chains flank tile 2A → playing it would merge two safe chains.
    const board: Record<string, any> = {};
    for (const t of ['1A']) board[t] = { id: t, placed: true, chain: 'tower' };
    for (const t of ['3A']) board[t] = { id: t, placed: true, chain: 'imperial' };
    const chains = makeChains({
      tower: Array.from({ length: 12 }, (_, i) => `T${i}`),
      imperial: Array.from({ length: 12 }, (_, i) => `I${i}`),
    });
    const hand = ['2A']; // only tile, and it's dead
    const players = [{ player_index: 0, cash: 6000, stocks: zeroStocks(), tiles: hand, is_bot: true, bot_difficulty: 'hard' }];
    const gs = baseState({ phase: 'place_tile', board, chains });
    const move = decideBotMove('hard', 'place_tile', gs, players, actorOf(players));
    expect(move.action).toBe('discard_tile');
    expect(move.payload.tileId).toBe('2A');
  });
});

describe('decideBotMove — found chain', () => {
  for (const diff of DIFFS) {
    it(`${diff}: founds an inactive, eligible chain`, () => {
      for (let i = 0; i < 30; i++) {
        const chains = makeChains({ tower: ['1A', '1B'] }); // tower already active
        const players = [{ player_index: 0, cash: 6000, stocks: zeroStocks(), tiles: [], is_bot: true, bot_difficulty: diff }];
        const gs = baseState({ phase: 'found_chain', chains });
        const move = decideBotMove(diff, 'found_chain', gs, players, actorOf(players));
        expect(move.action).toBe('found_chain');
        const chain = move.payload.chainName as ChainName;
        expect(ALL).toContain(chain);
        expect(chains[chain].isActive).toBe(false);
      }
    });
  }
});

describe('decideBotMove — merger stock choice', () => {
  for (const diff of DIFFS) {
    it(`${diff}: returns a valid sell/trade/keep split`, () => {
      for (const shares of [1, 2, 3, 5, 8]) {
        const stocks = zeroStocks();
        stocks.tower = shares;
        const players = [{ player_index: 0, cash: 6000, stocks, tiles: [], is_bot: true, bot_difficulty: diff }];
        const gs = baseState({
          phase: 'merger_handle_stock',
          chains: makeChains({ tower: ['1A'], american: ['2A', '2B', '2C'] }),
          merger: { survivingChain: 'american', defunctChains: ['tower'], currentDefunctChain: 'tower', currentPlayerIndex: 0, bonusesPaid: true },
          stock_bank: { ...Object.fromEntries(ALL.map((c) => [c, 25])), american: 2 } as Record<ChainName, number>,
        });
        const move = decideBotMove(diff, 'merger_handle_stock', gs, players, actorOf(players));
        expect(move.action).toBe('merger_stock_choice');
        const { sell, trade, keep } = move.payload.decision;
        expect(sell + trade + keep).toBe(shares);
        expect(trade % 2).toBe(0);
        expect(trade / 2).toBeLessThanOrEqual(2); // bounded by surviving bank
      }
    });
  }
});

describe('decideBotMove — buy stock', () => {
  for (const diff of DIFFS) {
    it(`${diff}: buys only affordable, active, in-stock shares (<=3 total)`, () => {
      for (let i = 0; i < 50; i++) {
        const chains = makeChains({ tower: ['1A', '1B'], continental: ['2A', '2B', '2C', '2D'] });
        const players = [{ player_index: 0, cash: 6000, stocks: zeroStocks(), tiles: [], is_bot: true, bot_difficulty: diff }];
        const gs = baseState({ phase: 'buy_stock', chains });
        const move = decideBotMove(diff, 'buy_stock', gs, players, actorOf(players));
        expect(['buy_stocks', 'skip_buy']).toContain(move.action);
        if (move.action === 'buy_stocks') {
          const purchases = move.payload.purchases as { chain: ChainName; quantity: number }[];
          const total = purchases.reduce((s, p) => s + p.quantity, 0);
          expect(total).toBeGreaterThan(0);
          expect(total).toBeLessThanOrEqual(3);
          let cost = 0;
          for (const p of purchases) {
            expect(chains[p.chain].isActive).toBe(true);
            cost += getStockPrice(p.chain, chains[p.chain].tiles.length) * p.quantity;
          }
          expect(cost).toBeLessThanOrEqual(6000);
        }
      }
    });
  }

  it('skips buying when no chain is affordable', () => {
    const chains = makeChains({ tower: ['1A', '1B'] });
    const players = [{ player_index: 0, cash: 100, stocks: zeroStocks(), tiles: [], is_bot: true, bot_difficulty: 'hard' }];
    const gs = baseState({ phase: 'buy_stock', chains });
    const move = decideBotMove('hard', 'buy_stock', gs, players, actorOf(players));
    expect(move.action).toBe('skip_buy');
  });
});

describe('decideBotMove — pay merger bonuses', () => {
  it('emits the trigger action', () => {
    const players = [{ player_index: 0, cash: 6000, stocks: zeroStocks(), tiles: [], is_bot: true, bot_difficulty: 'medium' }];
    const gs = baseState({
      phase: 'merger_pay_bonuses',
      merger: { survivingChain: 'american', defunctChains: ['tower'], currentDefunctChain: 'tower', currentPlayerIndex: 0, bonusesPaid: false },
    });
    const move = decideBotMove('medium', 'merger_pay_bonuses', gs, players, actorOf(players));
    expect(move.action).toBe('pay_merger_bonuses');
  });
});
