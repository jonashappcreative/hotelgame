import { describe, it, expect } from 'vitest';
import {
  canPlayPowerCard,
  canUseAnyPowerCard,
  getStockAllowance,
  isFreeStockActive,
  isMultiTileActive,
  normalizeActivePowerCard,
  normalizePowerCards,
  powerCardHasUse,
  remainingPowerTrades,
  type PowerCardTurnState,
  type PowerCardUseState,
} from './power-cards';
import {
  ChainName,
  EXTRA_BUY_LIMIT,
  MAX_POWER_TRADES,
  MAX_STOCKS_PER_TURN,
  POWER_CARDS,
  PowerCardId,
} from './game';
import { getStockPrice } from '@/utils/gameLogic';

// Epic 17. This is the one place card legality is defined, and the server gates
// play_power_card on exactly what the client uses to disable a button — so a
// bug here is a client offering a move the engine rejects, or vice versa.

const turn = (over: Partial<PowerCardTurnState> = {}): PowerCardTurnState => ({
  enabled: true,
  phase: 'place_tile',
  held: [...POWER_CARDS],
  active: null,
  stocksPurchasedThisTurn: 0,
  tilesPlacedThisTurn: 0,
  tileBagCount: 40,
  ...over,
});

const use = (over: Partial<PowerCardUseState> = {}): PowerCardUseState => ({
  chains: {
    tower: { tiles: new Array(7).fill('x'), isActive: true },
    continental: { tiles: new Array(4).fill('x'), isActive: true },
    imperial: { tiles: [], isActive: false },
  },
  stockBank: { tower: 20, continental: 20, imperial: 25 },
  stocks: { tower: 0, continental: 0, imperial: 0 },
  chainsBoughtThisTurn: [],
  cash: 6000,
  handSize: 6,
  ...over,
});

const priceOf = (chain: ChainName, size: number) => getStockPrice(chain, size);

describe('canPlayPowerCard', () => {
  it('accepts every card in its own window', () => {
    for (const card of ['extra_tiles', 'multi_tile'] as PowerCardId[]) {
      expect(canPlayPowerCard(card, turn({ phase: 'place_tile' })).ok).toBe(true);
    }
    for (const card of ['extra_buy', 'free_stock', 'stock_trade'] as PowerCardId[]) {
      expect(canPlayPowerCard(card, turn({ phase: 'buy_stock' })).ok).toBe(true);
      expect(canPlayPowerCard(card, turn({ phase: 'place_tile' })).ok).toBe(true);
    }
  });

  it('refuses every card when the room rule is off', () => {
    for (const card of POWER_CARDS) {
      const result = canPlayPowerCard(card, turn({ enabled: false }));
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/not enabled/i);
    }
  });

  it('refuses a card the player has already spent', () => {
    const result = canPlayPowerCard('extra_buy', turn({ held: ['multi_tile'] }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/already spent/i);
  });

  it('refuses a second card once one is active — the double-click race', () => {
    const result = canPlayPowerCard(
      'free_stock',
      turn({ phase: 'buy_stock', active: { card: 'extra_buy', tradesUsed: 0 } }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/already played a card/i);
  });

  it('refuses the two placement cards once a tile has been placed', () => {
    for (const card of ['extra_tiles', 'multi_tile'] as PowerCardId[]) {
      const result = canPlayPowerCard(card, turn({ tilesPlacedThisTurn: 1 }));
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/before you place/i);
    }
  });

  it('refuses the placement cards outside place_tile', () => {
    for (const card of ['extra_tiles', 'multi_tile'] as PowerCardId[]) {
      expect(canPlayPowerCard(card, turn({ phase: 'buy_stock' })).ok).toBe(false);
    }
  });

  it('refuses the two pre-purchase cards once shares have been bought', () => {
    for (const card of ['extra_buy', 'free_stock'] as PowerCardId[]) {
      const result = canPlayPowerCard(
        card,
        turn({ phase: 'buy_stock', stocksPurchasedThisTurn: 1 }),
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/before you buy/i);
    }
  });

  it('lets Stock Trade be played after buying — the budgets are independent', () => {
    expect(
      canPlayPowerCard('stock_trade', turn({ phase: 'buy_stock', stocksPurchasedThisTurn: 3 })).ok,
    ).toBe(true);
  });

  it('refuses Extra Tiles on an empty bag rather than wasting the card', () => {
    const result = canPlayPowerCard('extra_tiles', turn({ tileBagCount: 0 }));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/bag is empty/i);
  });

  it('refuses every card during a merger phase', () => {
    for (const card of POWER_CARDS) {
      expect(canPlayPowerCard(card, turn({ phase: 'merger_handle_stock' })).ok).toBe(false);
    }
  });
});

describe('powerCardHasUse', () => {
  it('Free Shares is useful precisely when nothing is affordable', () => {
    const broke = use({ cash: 0 });
    expect(powerCardHasUse('free_stock', turn(), broke, priceOf)).toBe(true);
    // Extra Purchase is not: raising a cap you cannot pay for buys nothing.
    expect(powerCardHasUse('extra_buy', turn(), broke, priceOf)).toBe(false);
  });

  it('Free Shares is useless when the bank has no shares of any active chain', () => {
    const empty = use({ stockBank: { tower: 0, continental: 0, imperial: 25 } });
    expect(powerCardHasUse('free_stock', turn(), empty, priceOf)).toBe(false);
  });

  it('Stock Trade needs two givable shares and somewhere to trade into', () => {
    const one = use({ stocks: { tower: 1, continental: 0, imperial: 0 } });
    expect(powerCardHasUse('stock_trade', turn(), one, priceOf)).toBe(false);

    const two = use({ stocks: { tower: 2, continental: 0, imperial: 0 } });
    expect(powerCardHasUse('stock_trade', turn(), two, priceOf)).toBe(true);
  });

  it('shares bought this turn cannot fund a trade', () => {
    const bought = use({
      stocks: { tower: 2, continental: 0, imperial: 0 },
      chainsBoughtThisTurn: ['tower'],
    });
    expect(powerCardHasUse('stock_trade', turn(), bought, priceOf)).toBe(false);
  });

  it('a defunct chain is not tradeable stock', () => {
    const defunct = use({ stocks: { tower: 0, continental: 0, imperial: 5 } });
    expect(powerCardHasUse('stock_trade', turn(), defunct, priceOf)).toBe(false);
  });
});

describe('canUseAnyPowerCard — the auto-end gate term', () => {
  it('keeps the turn open for a broke player still holding Free Shares', () => {
    const state = turn({ phase: 'buy_stock', held: ['free_stock'] });
    expect(canUseAnyPowerCard(state, use({ cash: 0 }), priceOf)).toBe(true);
  });

  it('does NOT keep it open for Stock Trade with nothing tradeable', () => {
    const state = turn({ phase: 'buy_stock', held: ['stock_trade'] });
    expect(canUseAnyPowerCard(state, use(), priceOf)).toBe(false);
  });

  it('does NOT keep the buy phase open for the two placement-only cards', () => {
    const state = turn({ phase: 'buy_stock', held: ['extra_tiles', 'multi_tile'] });
    expect(canUseAnyPowerCard(state, use(), priceOf)).toBe(false);
  });

  it('is false with the rule off, whatever the player holds', () => {
    const state = turn({ phase: 'buy_stock', enabled: false });
    expect(canUseAnyPowerCard(state, use({ cash: 0 }), priceOf)).toBe(false);
  });

  it('is false once every card is spent', () => {
    const state = turn({ phase: 'buy_stock', held: [] });
    expect(canUseAnyPowerCard(state, use({ cash: 0 }), priceOf)).toBe(false);
  });

  it('an active Stock Trade with trades left keeps the turn open on its own', () => {
    const state = turn({
      phase: 'buy_stock',
      held: [],
      active: { card: 'stock_trade', tradesUsed: 2 },
    });
    const tradeable = use({ stocks: { tower: 2, continental: 0, imperial: 0 } });
    expect(canUseAnyPowerCard(state, tradeable, priceOf)).toBe(true);
  });

  it('an exhausted Stock Trade does not', () => {
    const state = turn({
      phase: 'buy_stock',
      held: [],
      active: { card: 'stock_trade', tradesUsed: MAX_POWER_TRADES },
    });
    const tradeable = use({ stocks: { tower: 2, continental: 0, imperial: 0 } });
    expect(canUseAnyPowerCard(state, tradeable, priceOf)).toBe(false);
  });

  it('a spent one-shot card like Extra Purchase does not hold the turn open', () => {
    const state = turn({
      phase: 'buy_stock',
      held: [],
      active: { card: 'extra_buy', tradesUsed: 0 },
    });
    expect(canUseAnyPowerCard(state, use(), priceOf)).toBe(false);
  });
});

describe('derived per-turn values', () => {
  it('Extra Purchase raises the allowance to 5 and nothing else does', () => {
    expect(getStockAllowance(null)).toBe(MAX_STOCKS_PER_TURN);
    expect(getStockAllowance({ card: 'extra_buy', tradesUsed: 0 })).toBe(EXTRA_BUY_LIMIT);
    expect(getStockAllowance({ card: 'free_stock', tradesUsed: 0 })).toBe(MAX_STOCKS_PER_TURN);
  });

  it('reads the active card back for the other three effects', () => {
    expect(isFreeStockActive({ card: 'free_stock', tradesUsed: 0 })).toBe(true);
    expect(isFreeStockActive({ card: 'extra_buy', tradesUsed: 0 })).toBe(false);
    expect(isMultiTileActive({ card: 'multi_tile', tradesUsed: 0 })).toBe(true);
    expect(remainingPowerTrades({ card: 'stock_trade', tradesUsed: 1 })).toBe(MAX_POWER_TRADES - 1);
    expect(remainingPowerTrades({ card: 'extra_buy', tradesUsed: 0 })).toBe(0);
    expect(remainingPowerTrades(null)).toBe(0);
  });
});

describe('normalisation — an unmigrated or pre-epic row must read as "off"', () => {
  it('treats every non-card value as no card active', () => {
    for (const raw of [null, undefined, {}, { card: 'nonsense' }, 'extra_buy', 42]) {
      expect(normalizeActivePowerCard(raw)).toBeNull();
    }
  });

  it('defaults a missing or malformed trade counter to zero', () => {
    expect(normalizeActivePowerCard({ card: 'stock_trade' })).toEqual({
      card: 'stock_trade', tradesUsed: 0,
    });
    expect(normalizeActivePowerCard({ card: 'stock_trade', tradesUsed: -3 })).toEqual({
      card: 'stock_trade', tradesUsed: 0,
    });
  });

  it('drops unrecognised entries from a power_cards array', () => {
    expect(normalizePowerCards(['extra_buy', 'bogus', 'multi_tile'])).toEqual([
      'extra_buy', 'multi_tile',
    ]);
    expect(normalizePowerCards(undefined)).toEqual([]);
    expect(normalizePowerCards('extra_buy')).toEqual([]);
  });
});
