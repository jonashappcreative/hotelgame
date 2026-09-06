import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RULES,
  CHAIN_SIZE_BRACKETS,
  MAX_STOCKS_PER_TURN,
  getSellPriceFactor,
  getSellPrice,
  getStockPrice,
  settleSale,
  settleTrade,
  isTilePlayable,
  MAX_POWER_TRADES,
  TRADE_GIVE,
  canDeclareGameEnd,
  endConditionReason,
  type ChainName,
  type CustomRules,
} from './rules';
import {
  END_CONDITION_CASES,
  chainsForCase,
} from '../../src/test/endConditionCases';

const ALL: ChainName[] = ['sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial'];

const rulesWith = (overrides: Partial<CustomRules>): CustomRules => ({ ...DEFAULT_RULES, ...overrides });

const zeroStocks = () => Object.fromEntries(ALL.map((c) => [c, 0])) as Record<ChainName, number>;
const fullBank = () => Object.fromEntries(ALL.map((c) => [c, 25])) as Record<ChainName, number>;

// A board where every chain is active at `size` tiles.
const chainsAt = (size: number, activeOnly?: ChainName[]) =>
  Object.fromEntries(
    ALL.map((c) => [c, {
      tiles: Array.from({ length: size }, (_, i) => `${c}-${i}`),
      isActive: activeOnly ? activeOnly.includes(c) : true,
    }])
  ) as Record<ChainName, { tiles: string[]; isActive: boolean }>;

describe('getSellPriceFactor', () => {
  // Epic 15: 'off' is a value of stockSelling, not a separate boolean, so it is
  // the only setting that disables selling.
  it("returns 0 only when stock selling is 'off'", () => {
    expect(getSellPriceFactor(rulesWith({ stockSelling: 'off' }))).toBe(0);
    for (const factor of ['100', '90', '75', '50'] as const) {
      expect(getSellPriceFactor(rulesWith({ stockSelling: factor }))).toBeGreaterThan(0);
    }
  });

  it('returns the configured fraction', () => {
    expect(getSellPriceFactor(rulesWith({ stockSelling: '75' }))).toBe(0.75);
    expect(getSellPriceFactor(rulesWith({ stockSelling: '90' }))).toBe(0.9);
    expect(getSellPriceFactor(rulesWith({ stockSelling: '50' }))).toBe(0.5);
    expect(getSellPriceFactor(rulesWith({ stockSelling: '100' }))).toBe(1);
  });

  it('defaults to off', () => {
    expect(DEFAULT_RULES.stockSelling).toBe('off');
  });
});

describe('getSellPrice', () => {
  it('rounds down to the nearest 10 — a 7-tile Continental sells at 520', () => {
    expect(getStockPrice('continental', 7)).toBe(700);
    expect(getSellPrice('continental', 7, 0.75)).toBe(520); // 525 floored to 520
  });

  it('is the identity of getStockPrice at 100%, for every chain and bracket', () => {
    const sizes = [0, 1, 2, 3, 4, 5, 9, 10, 11, 20, 25, 30, 35, 40, 41, 60];
    for (const chain of ALL) {
      for (const size of sizes) {
        expect(getSellPrice(chain, size, 1)).toBe(getStockPrice(chain, size));
      }
    }
    // Every bracket boundary is covered by the sizes above.
    expect(CHAIN_SIZE_BRACKETS.length).toBe(8);
  });

  it('never pays more than market, and stays a multiple of 10', () => {
    for (const chain of ALL) {
      for (const size of [2, 3, 5, 10, 20, 30, 40, 41]) {
        for (const factor of [0.5, 0.75, 0.9, 1]) {
          const sell = getSellPrice(chain, size, factor);
          expect(sell).toBeLessThanOrEqual(getStockPrice(chain, size));
          expect(sell % 10).toBe(0);
        }
      }
    }
  });

  it('pays nothing for a chain that is off the board', () => {
    expect(getSellPrice('tower', 0, 0.75)).toBe(0);
  });
});

describe('settleSale', () => {
  const base = {
    chains: chainsAt(7),
    stocks: { ...zeroStocks(), continental: 5, tower: 2 },
    stockBank: { ...fullBank(), continental: 20, tower: 23 },
    soldThisTurn: 0,
    chainsBoughtThisTurn: [] as ChainName[],
    factor: 0.75,
  };

  it('rejects when the rule is off (factor 0)', () => {
    const res = settleSale({ ...base, sales: [{ chain: 'continental', quantity: 1 }], factor: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not enabled/i);
  });

  it('rejects an empty basket', () => {
    expect(settleSale({ ...base, sales: [] }).ok).toBe(false);
  });

  it('rejects selling more shares than held', () => {
    const res = settleSale({ ...base, sales: [{ chain: 'tower', quantity: 3 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/only hold 2 Tower/);
  });

  it('rejects selling 2 when 2 were already sold this turn (cap is 3)', () => {
    const res = settleSale({ ...base, sales: [{ chain: 'continental', quantity: 2 }], soldThisTurn: 2 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(new RegExp(`${MAX_STOCKS_PER_TURN} stocks per turn`));
    // ...but exactly one more still settles.
    expect(settleSale({ ...base, sales: [{ chain: 'continental', quantity: 1 }], soldThisTurn: 2 }).ok).toBe(true);
  });

  it('counts duplicate entries for the same chain against the cap together', () => {
    const res = settleSale({
      ...base,
      sales: [{ chain: 'continental', quantity: 2 }, { chain: 'continental', quantity: 2 }],
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a chain bought this turn', () => {
    const res = settleSale({
      ...base,
      sales: [{ chain: 'continental', quantity: 1 }],
      chainsBoughtThisTurn: ['continental'],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/bought this turn/i);
  });

  it('rejects an inactive chain', () => {
    const res = settleSale({
      ...base,
      chains: chainsAt(7, ['tower']),
      sales: [{ chain: 'continental', quantity: 1 }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/inactive/i);
  });

  it('rejects a non-positive or fractional quantity', () => {
    expect(settleSale({ ...base, sales: [{ chain: 'tower', quantity: 0 }] }).ok).toBe(false);
    expect(settleSale({ ...base, sales: [{ chain: 'tower', quantity: -1 }] }).ok).toBe(false);
    expect(settleSale({ ...base, sales: [{ chain: 'tower', quantity: 1.5 }] }).ok).toBe(false);
  });

  it('pays the sum of getSellPrice per share and moves the shares to the bank', () => {
    const res = settleSale({
      ...base,
      sales: [{ chain: 'continental', quantity: 2 }, { chain: 'tower', quantity: 1 }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const expected =
      getSellPrice('continental', 7, 0.75) * 2 + getSellPrice('tower', 7, 0.75) * 1;
    expect(res.settlement.proceeds).toBe(expected);
    expect(res.settlement.totalQuantity).toBe(3);
    expect(res.settlement.newStocks.continental).toBe(3);
    expect(res.settlement.newStocks.tower).toBe(1);
    expect(res.settlement.newStockBank.continental).toBe(22);
    expect(res.settlement.newStockBank.tower).toBe(24);
    expect(res.settlement.lines).toHaveLength(2);
  });

  it('conserves shares: bank + holdings stays at 25 per chain', () => {
    // One holder of everything, so bank + holdings is the whole supply.
    const stocks = { ...zeroStocks(), continental: 5, tower: 2 };
    const stockBank = { ...fullBank(), continental: 20, tower: 23 };
    const res = settleSale({
      ...base,
      stocks,
      stockBank,
      sales: [{ chain: 'continental', quantity: 2 }, { chain: 'tower', quantity: 1 }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    for (const chain of ALL) {
      expect(res.settlement.newStockBank[chain] + res.settlement.newStocks[chain]).toBe(25);
    }
  });

  it('leaves the caller\'s objects untouched', () => {
    const stocks = { ...zeroStocks(), continental: 5 };
    const stockBank = { ...fullBank(), continental: 20 };
    settleSale({ ...base, stocks, stockBank, sales: [{ chain: 'continental', quantity: 2 }] });
    expect(stocks.continental).toBe(5);
    expect(stockBank.continental).toBe(20);
  });

  it('at 100% pays exactly the market price', () => {
    const res = settleSale({ ...base, factor: 1, sales: [{ chain: 'continental', quantity: 2 }] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.settlement.proceeds).toBe(getStockPrice('continental', 7) * 2);
  });
});

// Epic 18. Runs the shared truth table (src/test/endConditionCases.ts) that
// src/utils/gameLogic.test.ts runs against the browser mirror, so the two
// implementations of one rule cannot drift apart.
describe('canDeclareGameEnd', () => {
  for (const c of END_CONDITION_CASES) {
    it(c.name, () => {
      const chains = chainsForCase(c) as unknown as Record<ChainName, any>;
      expect(canDeclareGameEnd(chains, c.boardRows, c.safeChainSize)).toBe(c.canDeclare);
      expect(endConditionReason(chains, c.boardRows, c.safeChainSize)).toBe(c.reason);
    });
  }

  it('defaults to safety off, so an all-safe board alone cannot end a game', () => {
    const chains = chainsForCase({
      name: '', sizes: { tower: 11 }, safe: ['tower'], boardRows: 9,
      safeChainSize: 11, canDeclare: true, reason: 'all_safe',
    }) as unknown as Record<ChainName, any>;
    expect(canDeclareGameEnd(chains)).toBe(false);
  });
});


// =============================================================================
// Epic 17 — Stock Trade
// =============================================================================
describe('settleTrade', () => {
  const active: ChainName[] = ['tower', 'continental', 'imperial'];
  const base = {
    chains: chainsAt(7, active),
    stocks: { ...zeroStocks(), tower: 4, continental: 2, imperial: 0, festival: 6 },
    stockBank: fullBank(),
    tradesUsed: 0,
    chainsBoughtThisTurn: [] as ChainName[],
  };

  it('gives 2 and takes 1, moving both sides through the bank', () => {
    const res = settleTrade({
      ...base,
      give: [{ chain: 'tower', quantity: 2 }],
      receive: 'continental',
    });
    expect(res.ok).toBe(true);
    expect(res.settlement.newStocks.tower).toBe(2);
    expect(res.settlement.newStocks.continental).toBe(3);
    expect(res.settlement.newStockBank.tower).toBe(27);
    expect(res.settlement.newStockBank.continental).toBe(24);
  });

  it('accepts the 2 given across two different chains', () => {
    const res = settleTrade({
      ...base,
      give: [{ chain: 'tower', quantity: 1 }, { chain: 'continental', quantity: 1 }],
      receive: 'imperial',
    });
    expect(res.ok).toBe(true);
    expect(res.settlement.newStocks.tower).toBe(3);
    expect(res.settlement.newStocks.continental).toBe(1);
    expect(res.settlement.newStocks.imperial).toBe(1);
  });

  it(`requires exactly ${TRADE_GIVE} shares given, not fewer and not more`, () => {
    for (const quantity of [1, 3]) {
      const res = settleTrade({ ...base, give: [{ chain: 'tower', quantity }], receive: 'continental' });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/exactly/i);
    }
  });

  it(`allows ${MAX_POWER_TRADES} trades and refuses the next`, () => {
    const res = settleTrade({
      ...base,
      tradesUsed: MAX_POWER_TRADES,
      give: [{ chain: 'tower', quantity: 2 }],
      receive: 'continental',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/all 3 trades/i);
  });

  // Defunct certificates are worthless paper; laundering them into live stock
  // would be the single most valuable thing the card could do.
  it('refuses a defunct chain on the give side', () => {
    const res = settleTrade({ ...base, give: [{ chain: 'festival', quantity: 2 }], receive: 'tower' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not on the board/i);
  });

  it('refuses a defunct chain on the receive side', () => {
    const res = settleTrade({ ...base, give: [{ chain: 'tower', quantity: 2 }], receive: 'festival' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not on the board/i);
  });

  // Both halves of Epic 14's guard, or buy-then-trade routes around it.
  it('refuses to give away a chain bought this turn', () => {
    const res = settleTrade({
      ...base,
      chainsBoughtThisTurn: ['tower'],
      give: [{ chain: 'tower', quantity: 2 }],
      receive: 'continental',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/bought this turn/i);
  });

  it('adds the chain received to chains_bought_this_turn', () => {
    const res = settleTrade({
      ...base,
      chainsBoughtThisTurn: ['imperial'],
      give: [{ chain: 'tower', quantity: 2 }],
      receive: 'continental',
    });
    expect(res.ok).toBe(true);
    expect(res.settlement.newChainsBoughtThisTurn.sort()).toEqual(['continental', 'imperial']);
  });

  it('refuses more shares than the player holds', () => {
    const res = settleTrade({
      ...base,
      stocks: { ...zeroStocks(), tower: 1 },
      give: [{ chain: 'tower', quantity: 2 }],
      receive: 'continental',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/only hold/i);
  });

  it('refuses to receive from an empty bank', () => {
    const res = settleTrade({
      ...base,
      stockBank: { ...fullBank(), continental: 0 },
      give: [{ chain: 'tower', quantity: 2 }],
      receive: 'continental',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no continental shares left/i);
  });

  // The given shares return to the bank first, so the last share you just
  // handed back is available to trade into.
  it('lets the returned shares themselves fund the receive side', () => {
    const res = settleTrade({
      ...base,
      stockBank: { ...fullBank(), tower: 0 },
      give: [{ chain: 'tower', quantity: 2 }],
      receive: 'tower',
    });
    expect(res.ok).toBe(true);
    expect(res.settlement.newStocks.tower).toBe(3);
    expect(res.settlement.newStockBank.tower).toBe(1);
  });

  it('collapses a chain named twice rather than letting it dodge the checks', () => {
    const res = settleTrade({
      ...base,
      stocks: { ...zeroStocks(), tower: 1 },
      give: [{ chain: 'tower', quantity: 1 }, { chain: 'tower', quantity: 1 }],
      receive: 'continental',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/only hold 1/i);
  });

  it("leaves the caller's objects untouched", () => {
    const stocks = { ...zeroStocks(), tower: 4 };
    const stockBank = { ...fullBank() };
    settleTrade({ ...base, stocks, stockBank, give: [{ chain: 'tower', quantity: 2 }], receive: 'continental' });
    expect(stocks.tower).toBe(4);
    expect(stockBank.tower).toBe(25);
  });
});

// =============================================================================
// isTilePlayable — one definition for the timer, the stalemate backstop, the
// Building Spree exit and the bot, which each carried their own copy before.
// =============================================================================
describe('isTilePlayable', () => {
  const eligibleChains: ChainName[] = ['tower', 'continental', 'imperial'];
  const emptyBoard = () => ({} as Record<string, any>);

  const placed = (tile: string, chain: ChainName | null) => ({ id: tile, placed: true, chain });

  const call = (board: Record<string, any>, chains: Record<string, any>, tileId = '5F') =>
    isTilePlayable({ tileId, board, chains, eligibleChains, boardRows: 9, boardColsCount: 12 });

  it('an isolated tile is always playable', () => {
    expect(call(emptyBoard(), chainsAt(0, []))).toBe(true);
  });

  it('a tile merging two safe chains is dead', () => {
    const chains = {
      tower: { tiles: [], isActive: true, isSafe: true },
      continental: { tiles: [], isActive: true, isSafe: true },
    };
    expect(call({ '4F': placed('4F', 'tower'), '6F': placed('6F', 'continental') }, chains)).toBe(false);
  });

  it('a tile merging one safe chain with an unsafe one is fine', () => {
    const chains = {
      tower: { tiles: [], isActive: true, isSafe: true },
      continental: { tiles: [], isActive: true, isSafe: false },
    };
    expect(call({ '4F': placed('4F', 'tower'), '6F': placed('6F', 'continental') }, chains)).toBe(true);
  });

  it('a tile that would found a chain when none are left is dead', () => {
    const allActive = Object.fromEntries(
      eligibleChains.map((c) => [c, { tiles: [], isActive: true, isSafe: false }]),
    );
    expect(call({ '4F': placed('4F', null) }, allActive)).toBe(false);
  });

  it('the same tile is playable while an eligible chain is still free', () => {
    const someActive = {
      tower: { tiles: [], isActive: true, isSafe: false },
      continental: { tiles: [], isActive: false, isSafe: false },
      imperial: { tiles: [], isActive: false, isSafe: false },
    };
    expect(call({ '4F': placed('4F', null) }, someActive)).toBe(true);
  });
});
