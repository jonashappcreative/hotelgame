import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RULES,
  CHAIN_SIZE_BRACKETS,
  MAX_STOCKS_PER_TURN,
  getSellPriceFactor,
  getSellPrice,
  getStockPrice,
  settleSale,
  type ChainName,
  type CustomRules,
} from './rules';

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
