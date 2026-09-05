import { describe, it, expect } from 'vitest';
import { decideBotMove, type BotDifficulty } from './bot';
import { getStockPrice, settleSale, getSellPriceFactor, normalizeRules, type ChainName } from './rules';

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

  // Story 14.8: bots never sell. Selling is optional and never a required phase
  // transition, so a room with the rule on plays out exactly as one without it.
  for (const diff of DIFFS) {
    it(`${diff}: plays a normal buy turn with stock selling enabled, never selling`, () => {
      const chains = makeChains({ tower: ['1A', '1B'], continental: ['2A', '2B', '2C', '2D'] });
      const rules_snapshot = { stockSelling: '75' };

      for (let i = 0; i < 30; i++) {
        const players = [{
          player_index: 0,
          cash: 6000,
          stocks: { ...zeroStocks(), continental: 4 },
          tiles: [],
          is_bot: true,
          bot_difficulty: diff,
        }];
        const gs = baseState({ phase: 'buy_stock', chains, rules_snapshot });
        const move = decideBotMove(diff, 'buy_stock', gs, players, actorOf(players));
        expect(['buy_stocks', 'skip_buy']).toContain(move.action);
        expect(move.action).not.toBe('sell_stocks');
      }
    });
  }

  it('still ends its turn with the rule on and nothing affordable', () => {
    const chains = makeChains({ continental: ['2A', '2B', '2C', '2D'] });
    const players = [{
      player_index: 0,
      cash: 100,
      stocks: { ...zeroStocks(), continental: 3 },
      tiles: [],
      is_bot: true,
      bot_difficulty: 'hard',
    }];
    const gs = baseState({
      phase: 'buy_stock',
      chains,
      rules_snapshot: { stockSelling: '50' },
    });
    expect(decideBotMove('hard', 'buy_stock', gs, players, actorOf(players)).action).toBe('skip_buy');
  });

  // Buying no longer ends the turn, so the drive loop re-enters the buy phase.
  // A bot commits its whole purchase at once and must then end the turn.
  for (const diff of DIFFS) {
    it(`${diff}: ends the turn instead of buying again in the same turn`, () => {
      const chains = makeChains({ tower: ['1A', '1B'], continental: ['2A', '2B', '2C', '2D'] });
      const players = [{ player_index: 0, cash: 6000, stocks: zeroStocks(), tiles: [], is_bot: true, bot_difficulty: diff }];
      const gs = baseState({ phase: 'buy_stock', chains, stocks_purchased_this_turn: 1 });
      const move = decideBotMove(diff, 'buy_stock', gs, players, actorOf(players));
      expect(move.action).toBe('skip_buy');
    });
  }
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

// =============================================================================
// Strategic behaviour (reworked bot logic).
// Legality is covered above; these assert that each difficulty actually plays
// the way its label promises.
// =============================================================================

/** Mark a chain's tiles as placed on the board. */
function placeChain(board: Record<string, any>, chain: ChainName | null, tiles: string[]) {
  for (const t of tiles) board[t] = { id: t, placed: true, chain };
  return board;
}

function seat(idx: number, over: any = {}) {
  return {
    player_index: idx,
    cash: 6000,
    stocks: zeroStocks(),
    tiles: [],
    is_bot: true,
    bot_difficulty: 'hard',
    ...over,
  };
}

describe('majority awareness', () => {
  for (const diff of ['medium', 'hard'] as BotDifficulty[]) {
    it(`${diff}: stops buying a chain it already holds 13 of`, () => {
      const chains = makeChains({ tower: ['1A', '1B'] });
      const players = [seat(0, {
        bot_difficulty: diff,
        stocks: { ...zeroStocks(), tower: 13 },
      })];
      const gs = baseState({
        phase: 'buy_stock',
        chains,
        stock_bank: { ...Object.fromEntries(ALL.map((c) => [c, 25])), tower: 12 } as any,
      });
      const move = decideBotMove(diff, 'buy_stock', gs, players, actorOf(players));
      expect(move.action).toBe('skip_buy');
    });
  }

  it('medium abandons a race it can no longer win and buys elsewhere', () => {
    const chains = makeChains({ tower: ['1A', '1B'], sackson: ['5A', '5B'] });
    const players = [
      seat(0, { bot_difficulty: 'medium' }),
      seat(1, { bot_difficulty: 'medium', stocks: { ...zeroStocks(), tower: 13 } }),
    ];
    const gs = baseState({
      phase: 'buy_stock',
      chains,
      stock_bank: { ...Object.fromEntries(ALL.map((c) => [c, 25])), tower: 12 } as any,
    });
    const move = decideBotMove('medium', 'buy_stock', gs, players, actorOf(players));
    expect(move.action).toBe('buy_stocks');
    for (const p of move.payload.purchases as { chain: ChainName }[]) {
      expect(p.chain).not.toBe('tower');
    }
  });
});

describe('hard: hand lookahead and cheap-share arbitrage', () => {
  // Tower (2 tiles) sits next to American (6 tiles); tile 2A touches both, so a
  // bot holding 2A can merge Tower away itself next round.
  function arbitrageState(hand: string[]) {
    const board: Record<string, any> = {};
    placeChain(board, 'tower', ['1A', '1B']);
    placeChain(board, 'american', ['3A', '3B', '3C', '3D', '3E', '3F']);
    const chains = makeChains({
      tower: ['1A', '1B'],
      american: ['3A', '3B', '3C', '3D', '3E', '3F'],
    });
    // Only enough cash for the cheap chain outright, so the first pick shows.
    const players = [seat(0, { cash: 700, tiles: hand })];
    return { gs: baseState({ phase: 'buy_stock', board, chains }), players };
  }

  it('buys the cheap chain it can merge away, not the big one', () => {
    const { gs, players } = arbitrageState(['2A', '9L']);
    const move = decideBotMove('hard', 'buy_stock', gs, players, actorOf(players));
    expect(move.action).toBe('buy_stocks');
    const tower = (move.payload.purchases as any[]).find((p) => p.chain === 'tower');
    expect(tower?.quantity).toBeGreaterThan(0);
  });

  it('prefers the big chain when it holds no tile to force the merge', () => {
    const { gs, players } = arbitrageState(['9L', '8L']);
    const move = decideBotMove('hard', 'buy_stock', gs, players, actorOf(players));
    expect(move.action).toBe('buy_stocks');
    const chainsBought = (move.payload.purchases as any[]).map((p) => p.chain);
    expect(chainsBought).toContain('american');
    expect(chainsBought).not.toContain('tower');
  });
});

describe('hard: founding is cost-to-dominate, not tier-first', () => {
  it('founds a budget chain when a majority there is cheapest', () => {
    const players = [seat(0, { cash: 6000 })];
    const gs = baseState({ phase: 'found_chain', pending_chain_foundation: ['1A', '1B'] });
    const move = decideBotMove('hard', 'found_chain', gs, players, actorOf(players));
    expect(['sackson', 'tower']).toContain(move.payload.chainName);
  });

  it('medium still reaches for the premium chain', () => {
    const players = [seat(0, { bot_difficulty: 'medium' })];
    const gs = baseState({ phase: 'found_chain' });
    // 40% of the time medium just picks at random, so check the tendency.
    const picks = Array.from({ length: 200 }, () =>
      decideBotMove('medium', 'found_chain', gs, players, actorOf(players)).payload.chainName);
    const premium = picks.filter((c) => c === 'continental' || c === 'imperial').length;
    expect(premium).toBeGreaterThan(picks.length / 2);
  });
});

describe('hard: tile play weighs who profits', () => {
  // Tower(2) and American(6) are adjacent via 2A; 3G simply grows American.
  function mergeState(over: any, hand = ['2A', '3G']) {
    const board: Record<string, any> = {};
    placeChain(board, 'tower', ['1A', '1B']);
    placeChain(board, 'american', ['3A', '3B', '3C', '3D', '3E', '3F']);
    const chains = makeChains({
      tower: ['1A', '1B'],
      american: ['3A', '3B', '3C', '3D', '3E', '3F'],
    });
    const players = [seat(0, { tiles: hand, ...over.me }), seat(1, over.rival ?? {})];
    return { gs: baseState({ phase: 'place_tile', board, chains }), players };
  }

  it('fires a merge to liquidate at book price when it cannot afford to buy', () => {
    const { gs, players } = mergeState({
      me: { cash: 0, stocks: { ...zeroStocks(), tower: 6 } },
    });
    const move = decideBotMove('hard', 'place_tile', gs, players, actorOf(players));
    expect(move.action).toBe('place_tile');
    expect(move.payload.tileId).toBe('2A');
  });

  it('declines the same merge when it would only pay an opponent', () => {
    const { gs, players } = mergeState({
      me: { cash: 6000 },
      rival: { stocks: { ...zeroStocks(), tower: 6 } },
    });
    const move = decideBotMove('hard', 'place_tile', gs, players, actorOf(players));
    expect(move.payload.tileId).toBe('3G');
  });

  it('will not grow a rival chain over the safe line', () => {
    const towerTiles = ['1A', '1B', '1C', '1D', '1E', '1F', '1G', '1H', '1I', '1J'];
    const board: Record<string, any> = {};
    placeChain(board, 'tower', towerTiles);
    const chains = makeChains({ tower: towerTiles });
    const players = [
      seat(0, { tiles: ['2A', '9L'] }),
      seat(1, { stocks: { ...zeroStocks(), tower: 8 } }),
    ];
    const gs = baseState({
      phase: 'place_tile',
      board,
      chains,
      rules_snapshot: { chainSafety: '11' },
      stock_bank: { ...Object.fromEntries(ALL.map((c) => [c, 25])), tower: 17 } as any,
    });
    const move = decideBotMove('hard', 'place_tile', gs, players, actorOf(players));
    expect(move.payload.tileId).toBe('9L');
  });
});

describe('merger stock decision', () => {
  const mergerState = (over: any = {}) => baseState({
    phase: 'merger_handle_stock',
    chains: makeChains({ tower: ['1A', '1B'], american: ['3A', '3B', '3C', '3D', '3E', '3F'] }),
    merger: {
      survivingChain: 'american',
      defunctChains: ['tower'],
      currentDefunctChain: 'tower',
      currentPlayerIndex: 0,
      bonusesPaid: true,
    },
    ...over,
  });

  it('easy picks a random legal split, and does vary', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const players = [seat(0, {
        bot_difficulty: 'easy',
        stocks: { ...zeroStocks(), tower: 6 },
      })];
      const move = decideBotMove('easy', 'merger_handle_stock', mergerState(), players, actorOf(players));
      const { sell, trade, keep } = move.payload.decision;
      expect(sell + trade + keep).toBe(6);
      expect(trade % 2).toBe(0);
      expect(trade / 2).toBeLessThanOrEqual(25);
      expect(Math.min(sell, trade, keep)).toBeGreaterThanOrEqual(0);
      seen.add(`${sell}-${trade}-${keep}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('easy is bounded by the surviving chain in the bank', () => {
    for (let i = 0; i < 50; i++) {
      const players = [seat(0, {
        bot_difficulty: 'easy',
        stocks: { ...zeroStocks(), tower: 6 },
      })];
      const gs = mergerState({
        stock_bank: { ...Object.fromEntries(ALL.map((c) => [c, 25])), american: 1 } as any,
      });
      const move = decideBotMove('easy', 'merger_handle_stock', gs, players, actorOf(players));
      expect(move.payload.decision.trade / 2).toBeLessThanOrEqual(1);
    }
  });

  it('hard never keeps a defunct share', () => {
    const players = [seat(0, { stocks: { ...zeroStocks(), tower: 7 } })];
    const move = decideBotMove('hard', 'merger_handle_stock', mergerState(), players, actorOf(players));
    expect(move.payload.decision.keep).toBe(0);
    expect(move.payload.decision.sell + move.payload.decision.trade).toBe(7);
  });
});

describe('selling (Mode B)', () => {
  // Tower is cheap and mergeable from hand; Continental is a dead position the
  // bot is hopelessly behind on, so it is the natural thing to liquidate.
  function blockedState(over: any = {}) {
    const board: Record<string, any> = {};
    placeChain(board, 'tower', ['1A', '1B']);
    placeChain(board, 'american', ['3A', '3B', '3C', '3D', '3E', '3F']);
    placeChain(board, 'continental', ['5A', '5B', '5C', '5D']);
    const chains = makeChains({
      tower: ['1A', '1B'],
      american: ['3A', '3B', '3C', '3D', '3E', '3F'],
      continental: ['5A', '5B', '5C', '5D'],
    });
    const players = [
      seat(0, { cash: 100, tiles: ['2A'], stocks: { ...zeroStocks(), continental: 1 } }),
      seat(1, { stocks: { ...zeroStocks(), continental: 10 } }),
      seat(2, { stocks: { ...zeroStocks(), continental: 5 } }),
    ];
    const gs = baseState({
      phase: 'buy_stock',
      board,
      chains,
      rules_snapshot: { stockSelling: '75' },
      stock_bank: { ...Object.fromEntries(ALL.map((c) => [c, 25])), continental: 9 } as any,
      ...over,
    });
    return { gs, players };
  }

  it('hard sells a dead position to fund the share it actually wants', () => {
    const { gs, players } = blockedState();
    const move = decideBotMove('hard', 'buy_stock', gs, players, actorOf(players));
    expect(move.action).toBe('sell_stocks');
    expect(move.payload.sales).toEqual([{ chain: 'continental', quantity: 1 }]);
  });

  it('hard never sells the chain it is buying into', () => {
    const { gs, players } = blockedState();
    const move = decideBotMove('hard', 'buy_stock', gs, players, actorOf(players));
    for (const s of move.payload.sales as { chain: ChainName }[]) {
      expect(s.chain).not.toBe('tower');
    }
  });

  it('does not sell twice in one turn', () => {
    const { gs, players } = blockedState({ stocks_sold_this_turn: 1 });
    const move = decideBotMove('hard', 'buy_stock', gs, players, actorOf(players));
    expect(move.action).not.toBe('sell_stocks');
  });

  it('does not sell when the rule is off', () => {
    const { gs, players } = blockedState({ rules_snapshot: {} });
    const move = decideBotMove('hard', 'buy_stock', gs, players, actorOf(players));
    expect(move.action).not.toBe('sell_stocks');
  });

  it('easy never sells, even when it cannot afford anything', () => {
    const { gs, players } = blockedState();
    for (let i = 0; i < 30; i++) {
      const move = decideBotMove('easy', 'buy_stock', gs, players, actorOf(players));
      expect(move.action).not.toBe('sell_stocks');
    }
  });

  it('medium sells scrap only once it is cash-blocked', () => {
    const board: Record<string, any> = {};
    placeChain(board, 'tower', ['1A', '1B']);
    placeChain(board, 'continental', ['5A', '5B', '5C', '5D']);
    const chains = makeChains({ tower: ['1A', '1B'], continental: ['5A', '5B', '5C', '5D'] });
    const rivals = [seat(1, { stocks: { ...zeroStocks(), continental: 5 } })];

    const blocked = [
      seat(0, {
        bot_difficulty: 'medium',
        cash: 100,
        stocks: { ...zeroStocks(), tower: 1, continental: 2 },
      }),
      ...rivals,
    ];
    const gsBlocked = baseState({
      phase: 'buy_stock', board, chains, rules_snapshot: { stockSelling: '75' },
    });
    const sold = decideBotMove('medium', 'buy_stock', gsBlocked, blocked, actorOf(blocked));
    expect(sold.action).toBe('sell_stocks');
    expect(sold.payload.sales).toEqual([{ chain: 'continental', quantity: 1 }]);

    // Same position, enough cash — no reason to take the haircut.
    const flush = [
      seat(0, {
        bot_difficulty: 'medium',
        cash: 6000,
        stocks: { ...zeroStocks(), tower: 1, continental: 2 },
      }),
      ...rivals,
    ];
    const kept = decideBotMove('medium', 'buy_stock', gsBlocked, flush, actorOf(flush));
    expect(kept.action).not.toBe('sell_stocks');
  });
});

// Every sell the bot emits must survive the engine's own validator — a rejected
// move stops the drive loop for that turn, so this path has to be airtight.
describe('sell payloads round-trip through settleSale', () => {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const int = (n: number) => Math.floor(Math.random() * (n + 1));

  for (const diff of ['medium', 'hard'] as BotDifficulty[]) {
    it(`${diff}: never proposes a sale the engine would reject`, () => {
      let sells = 0;

      for (let iter = 0; iter < 400; iter++) {
        const activeChains = ALL.filter(() => Math.random() < 0.5);
        const active: Partial<Record<ChainName, string[]>> = {};
        for (const c of activeChains) {
          active[c] = Array.from({ length: 2 + int(18) }, (_, i) => `${c}-${i}`);
        }
        const chains = makeChains(active);

        const stockBank = Object.fromEntries(ALL.map((c) => [c, int(25)])) as Record<ChainName, number>;
        const mine = Object.fromEntries(ALL.map((c) => [c, int(6)])) as Record<ChainName, number>;
        const players = [
          seat(0, {
            bot_difficulty: diff,
            cash: int(3000),
            stocks: mine,
            tiles: [`${1 + int(8)}${pick(['A', 'B', 'C', 'D', 'E'])}`],
          }),
          seat(1, { stocks: Object.fromEntries(ALL.map((c) => [c, int(9)])) }),
          seat(2, { stocks: Object.fromEntries(ALL.map((c) => [c, int(9)])) }),
        ];

        const rules_snapshot = { stockSelling: pick(['50', '75', '90']) };
        const gs = baseState({
          phase: 'buy_stock',
          chains,
          stock_bank: stockBank,
          rules_snapshot,
          chains_bought_this_turn: ALL.filter(() => Math.random() < 0.15),
        });

        const move = decideBotMove(diff, 'buy_stock', gs, players, actorOf(players));
        if (move.action !== 'sell_stocks') continue;
        sells++;

        const outcome = settleSale({
          sales: move.payload.sales,
          chains: chains as any,
          stocks: mine,
          stockBank,
          soldThisTurn: 0,
          chainsBoughtThisTurn: gs.chains_bought_this_turn,
          factor: getSellPriceFactor(normalizeRules(rules_snapshot)),
        });

        expect(outcome.error ?? 'ok').toBe('ok');
        expect(outcome.ok).toBe(true);
      }

      // The fuzz is only meaningful if it actually exercised the sell path.
      expect(sells).toBeGreaterThan(0);
    });
  }
});
