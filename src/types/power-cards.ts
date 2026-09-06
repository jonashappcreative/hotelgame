// =============================================================================
// power-cards — when a power card may be played, and whether it has a use
// =============================================================================
// Epic 17. One rule set, two consumers: server/api/game-action.ts uses
// canPlayPowerCard() as the gate on `play_power_card`, and the client uses the
// same function to disable a card and explain why. The pattern settleSale
// established — the engine persists what a pure function decided.
//
// This module is imported by the browser (src/) and by the backend
// (server/lib/rules.ts re-exports it), so it must stay dependency-free.
// =============================================================================

import {
  ActivePowerCard,
  ChainName,
  MAX_POWER_TRADES,
  MAX_STOCKS_PER_TURN,
  EXTRA_BUY_LIMIT,
  PowerCardId,
  POWER_CARDS,
  TRADE_GIVE,
} from './game';

// -----------------------------------------------------------------------------
// Presentation copy — one definition, read by every dialog and tooltip
// -----------------------------------------------------------------------------
export interface PowerCardInfo {
  id: PowerCardId;
  name: string;
  /** One line, for the hover tooltip and the card bar. */
  summary: string;
  /** The bullet rulings players will otherwise ask about. */
  rulings: string[];
}

export const POWER_CARD_INFO: Record<PowerCardId, PowerCardInfo> = {
  extra_buy: {
    id: 'extra_buy',
    name: 'Extra Purchase',
    summary: `Buy up to ${EXTRA_BUY_LIMIT} shares this turn instead of ${MAX_STOCKS_PER_TURN}.`,
    rulings: [
      'Play it before you buy anything this turn — it raises the cap, it does not raise it retroactively.',
      'Selling still has its own separate allowance of 3.',
      'The shares still have to be in the bank, and you still have to afford them.',
    ],
  },
  extra_tiles: {
    id: 'extra_tiles',
    name: 'Extra Tiles',
    summary: 'Draw 5 tiles immediately, taking your hand well over the limit.',
    rulings: [
      'The tiles arrive the moment you play the card, so you can use them this turn.',
      'You then draw nothing at the end of your turn until your hand is back to the normal limit — about five turns of drought. That is the cost, not a bug.',
      'Only before you have placed a tile this turn, and only while the bag still holds tiles.',
    ],
  },
  free_stock: {
    id: 'free_stock',
    name: 'Free Shares',
    summary: `The ${MAX_STOCKS_PER_TURN} shares you take this turn cost nothing.`,
    rulings: [
      `The cap is still ${MAX_STOCKS_PER_TURN}. Only one card may be played per turn, so this can never combine with Extra Purchase.`,
      'The bank still has to hold the shares and the chain still has to be active — only the price is zero.',
      'Free shares still count as bought this turn, so you cannot sell those chains back on the same turn.',
    ],
  },
  stock_trade: {
    id: 'stock_trade',
    name: 'Stock Trade',
    summary: `Trade ${TRADE_GIVE} shares you own for 1 from the market, up to ${MAX_POWER_TRADES} times.`,
    rulings: [
      'Every chain involved must be active on the board, on both sides of the trade. Defunct certificates cannot be laundered.',
      'The two shares you give may come from two different chains, or both from one.',
      `Trades do not touch your buy allowance — you may still buy ${MAX_STOCKS_PER_TURN} shares normally this turn.`,
      'A chain you bought this turn cannot be given away, and the chain you receive counts as bought this turn.',
    ],
  },
  multi_tile: {
    id: 'multi_tile',
    name: 'Building Spree',
    summary: 'Place up to 4 tiles this turn. You may stop after any tile.',
    rulings: [
      'A merger triggered by one tile is fully resolved — survivor, bonuses, every player’s stock decision — before the next tile is placed.',
      'You still buy only once, at the end, after every placement. There is no per-tile buy step.',
      'Only before you have placed a tile this turn.',
    ],
  },
};

// -----------------------------------------------------------------------------
// The state a legality decision reads
// -----------------------------------------------------------------------------
// Deliberately flat and engine-agnostic: the server builds it from the
// game_states row, the client from GameState. Turn ownership is NOT checked
// here — it is the caller's (the server answers 403, the client already knows).

export interface PowerCardTurnState {
  /** Whether the room rule is on. Everything is refused when it is not. */
  enabled: boolean;
  phase: string;
  /** Cards this player still holds. */
  held: PowerCardId[];
  /** The card already played this turn, or null. */
  active: ActivePowerCard | null;
  stocksPurchasedThisTurn: number;
  tilesPlacedThisTurn: number;
  /** Tiles left in the bag — extra_tiles is refused on an empty bag. */
  tileBagCount: number;
}

/** Everything the "is there actually a use for this card" half needs. */
export interface PowerCardUseState {
  chains: Record<string, { tiles: unknown[]; isActive: boolean }>;
  stockBank: Record<string, number>;
  /** The player's own holdings. */
  stocks: Record<string, number>;
  chainsBoughtThisTurn: string[];
  cash: number;
  /** Tiles in hand — a spree needs something to place. */
  handSize: number;
}

/**
 * A flat shape rather than a discriminated union, for the same reason
 * ValidationResult is flat: the backend compiles with `strictNullChecks: false`,
 * which switches off narrowing on boolean discriminants, so `if (!x.ok)` would
 * not reveal `reason` there. `reason` is empty when ok.
 */
export interface PowerCardLegality {
  ok: boolean;
  reason: string;
}

const OK: PowerCardLegality = { ok: true, reason: '' };
const no = (reason: string): PowerCardLegality => ({ ok: false, reason });

/** Cards that may only be played before anything has been placed this turn. */
const PLACEMENT_CARDS: PowerCardId[] = ['extra_tiles', 'multi_tile'];
/** Cards that may only be played before anything has been bought this turn. */
const PRE_PURCHASE_CARDS: PowerCardId[] = ['extra_buy', 'free_stock'];

export function isPowerCardId(value: unknown): value is PowerCardId {
  return typeof value === 'string' && (POWER_CARDS as string[]).includes(value);
}

/**
 * Whether `card` may be played right now — the single definition of card
 * legality, used by the server as its gate and by the client to disable a
 * button and say why. The reason is written to be shown to a player verbatim.
 */
export function canPlayPowerCard(
  card: PowerCardId,
  s: PowerCardTurnState,
): PowerCardLegality {
  if (!s.enabled) return no('Power cards are not enabled in this room');
  if (!isPowerCardId(card)) return no('Unknown power card');
  if (!s.held.includes(card)) return no('You have already spent this card');
  if (s.active) return no('You have already played a card this turn');

  const placementPhase = s.phase === 'place_tile';
  const buyPhase = s.phase === 'buy_stock';

  if (PLACEMENT_CARDS.includes(card)) {
    if (!placementPhase) return no('Only while you still have a tile to place');
    if (s.tilesPlacedThisTurn > 0) return no('Only before you place a tile this turn');
  } else if (!placementPhase && !buyPhase) {
    return no('Not available during a merger');
  }

  if (PRE_PURCHASE_CARDS.includes(card) && s.stocksPurchasedThisTurn > 0) {
    return no('Only before you buy shares this turn');
  }

  if (card === 'extra_tiles' && s.tileBagCount <= 0) {
    return no('The tile bag is empty');
  }

  return OK;
}

// -----------------------------------------------------------------------------
// "Has an available use" — the second half of the auto-end gate
// -----------------------------------------------------------------------------
// Modelled on canSellStock, which deliberately checks that the player holds
// sellable shares rather than merely that the rule is on. Without this half a
// player holding only Stock Trade and nothing tradeable would have every turn
// hang waiting for a manual End Turn.

/** Chains the player could hand over in a trade right now. */
function tradeableGiveTotal(u: PowerCardUseState): number {
  return Object.keys(u.chains).reduce((total, chain) => {
    if (!u.chains[chain]?.isActive) return total;
    if (u.chainsBoughtThisTurn.includes(chain)) return total;
    return total + (u.stocks[chain] ?? 0);
  }, 0);
}

/** True when some active chain still has a share in the bank to receive. */
function anyReceivableChain(u: PowerCardUseState): boolean {
  return Object.keys(u.chains).some(
    (chain) => u.chains[chain]?.isActive && (u.stockBank[chain] ?? 0) > 0,
  );
}

/** True when some active chain has a share in the bank the player can afford. */
function anyAffordableShare(
  u: PowerCardUseState,
  priceOf: (chain: ChainName, size: number) => number,
): boolean {
  return Object.keys(u.chains).some((chain) => {
    const c = u.chains[chain];
    if (!c?.isActive || (u.stockBank[chain] ?? 0) <= 0) return false;
    return priceOf(chain as ChainName, c.tiles.length) <= u.cash;
  });
}

/**
 * Whether playing `card` right now would actually achieve anything. Legality is
 * a separate question — a card can be perfectly legal and completely pointless,
 * and only a card that is both keeps the turn open.
 */
export function powerCardHasUse(
  card: PowerCardId,
  s: PowerCardTurnState,
  u: PowerCardUseState,
  priceOf: (chain: ChainName, size: number) => number,
): boolean {
  switch (card) {
    case 'extra_buy':
      return anyAffordableShare(u, priceOf);
    // The card that matters most here: on the turn nothing is affordable, Free
    // Shares is precisely what the player wants, so price is not consulted.
    case 'free_stock':
      return anyReceivableChain(u);
    case 'stock_trade':
      return tradeableGiveTotal(u) >= TRADE_GIVE && anyReceivableChain(u);
    case 'extra_tiles':
      return s.tileBagCount > 0;
    case 'multi_tile':
      return u.handSize > 0;
  }
}

/**
 * True when the player still has a power card worth playing, or an active card
 * with an unspent use. The third term of the auto-end gate Epic 14 widened with
 * canSellAnything and Epic 18 with canDeclareGameEnd — a turn must never be
 * swept past a decision the player could still make.
 */
export function canUseAnyPowerCard(
  s: PowerCardTurnState,
  u: PowerCardUseState,
  priceOf: (chain: ChainName, size: number) => number,
): boolean {
  if (!s.enabled) return false;

  // An active Stock Trade with trades left keeps the turn open on its own; the
  // other four cards are spent the instant their effect lands.
  if (s.active) {
    return s.active.card === 'stock_trade' &&
      s.active.tradesUsed < MAX_POWER_TRADES &&
      powerCardHasUse('stock_trade', s, u, priceOf);
  }

  return s.held.some(
    (card) => canPlayPowerCard(card, s).ok && powerCardHasUse(card, s, u, priceOf),
  );
}

// -----------------------------------------------------------------------------
// Derived per-turn values
// -----------------------------------------------------------------------------

/**
 * Shares the player may buy this turn. The per-turn allowance stops being a
 * constant the moment Extra Purchase exists, so both engines route their cap
 * and their auto-end check through this.
 */
export function getStockAllowance(active: ActivePowerCard | null): number {
  return active?.card === 'extra_buy' ? EXTRA_BUY_LIMIT : MAX_STOCKS_PER_TURN;
}

/** True while shares taken this turn cost nothing. */
export function isFreeStockActive(active: ActivePowerCard | null): boolean {
  return active?.card === 'free_stock';
}

/** True while the player may keep placing tiles after resolving one. */
export function isMultiTileActive(active: ActivePowerCard | null): boolean {
  return active?.card === 'multi_tile';
}

/** Trades still available this turn; 0 unless Stock Trade is the active card. */
export function remainingPowerTrades(active: ActivePowerCard | null): number {
  if (active?.card !== 'stock_trade') return 0;
  return Math.max(0, MAX_POWER_TRADES - (active.tradesUsed ?? 0));
}

/**
 * Normalise whatever the `active_power_card` column holds. The column is JSONB
 * written by this codebase, but a row from before Epic 17 has NULL and a row
 * mid-migration could hold anything, so nothing downstream may assume a shape.
 */
export function normalizeActivePowerCard(raw: unknown): ActivePowerCard | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const card = (raw as { card?: unknown }).card;
  if (!isPowerCardId(card)) return null;
  const used = (raw as { tradesUsed?: unknown }).tradesUsed;
  return {
    card,
    tradesUsed: typeof used === 'number' && used >= 0 ? Math.floor(used) : 0,
  };
}

/** Normalise the `power_cards` array, dropping anything unrecognised. */
export function normalizePowerCards(raw: unknown): PowerCardId[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPowerCardId);
}
