// Core game types for Hotel Game

export type Coordinate = {
  row: number; // 1-9
  col: string; // A-L
};

export type TileId = `${number}${string}`; // e.g., "3C", "5F"

export type ChainName = 
  | 'sackson' 
  | 'tower' 
  | 'worldwide' 
  | 'american' 
  | 'festival' 
  | 'continental' 
  | 'imperial';

export type ChainTier = 'budget' | 'midrange' | 'premium';

export interface ChainInfo {
  name: ChainName;
  displayName: string;
  tier: ChainTier;
  color: string;
  textColor: string;
}

export interface TileState {
  id: TileId;
  placed: boolean;
  chain: ChainName | null;
}

export interface PlayerState {
  id: string;
  name: string;
  cash: number;
  tiles: TileId[];
  stocks: Record<ChainName, number>;
  isConnected: boolean;
  /**
   * Power cards this player still holds (Epic 17). Public on purpose — knowing
   * an opponent can still spend Building Spree changes how you leave the board,
   * and every play is logged anyway. Empty when the room rule is off.
   */
  powerCards: PowerCardId[];
}

export interface ChainState {
  name: ChainName;
  tiles: TileId[];
  isActive: boolean;
  isSafe: boolean; // 11+ tiles
}

export type GamePhase = 
  | 'waiting' 
  | 'place_tile' 
  | 'found_chain' 
  | 'buy_stock' 
  | 'merger_choose_survivor'
  | 'merger_pay_bonuses'
  | 'merger_handle_stock'
  | 'game_over';

export interface MergerState {
  survivingChain: ChainName | null;
  defunctChains: ChainName[];
  currentDefunctChain: ChainName | null;
  currentPlayerIndex: number;
  bonusesPaid: boolean;
}

export interface GameState {
  roomCode: string;
  players: PlayerState[];
  currentPlayerIndex: number;
  phase: GamePhase;
  board: Map<TileId, TileState>;
  chains: Record<ChainName, ChainState>;
  stockBank: Record<ChainName, number>;
  tileBag: TileId[];
  lastPlacedTile: TileId | null;
  pendingChainFoundation: TileId[] | null;
  merger: MergerState | null;
  mergerAdjacentChains: ChainName[] | null;
  stocksPurchasedThisTurn: number;
  /** Shares sold back to the bank this turn — a budget separate from buying. */
  stocksSoldThisTurn: number;
  /** Chains bought this turn; they cannot be sold again in the same turn. */
  chainsBoughtThisTurn: ChainName[];
  /** The power card in effect for the current turn, or null (Epic 17). */
  activePowerCard: ActivePowerCard | null;
  /**
   * Tiles placed this turn. Maintained always, not just under Building Spree —
   * it is what lets "only before you have placed" be checked without inspecting
   * lastPlacedTile, which the starting tile also writes.
   */
  tilesPlacedThisTurn: number;
  gameLog: GameLogEntry[];
  winner: string | null;
  endGameVotes: string[];
  /**
   * Seat that declared the game will end (Epic 18); null until someone does.
   * The game ends when that player's turn ends, not when they declare.
   */
  endDeclaredBy: number | null;
  roundNumber: number;
  rulesSnapshot: CustomRules | null;
  turnDeadlineEpoch: number | null;
  safeChainSize: number | null;
  bonusTier: 'standard' | 'flat' | 'aggressive';
  boardRows: number;
  boardCols: string[];
  maxChains: number;
  eligibleChains: ChainName[];
}

export interface GameLogEntry {
  timestamp: number;
  playerId: string;
  playerName: string;
  action: string;
  details?: string;
}

export interface StockPurchase {
  chain: ChainName;
  quantity: number;
}

export interface MergerStockDecision {
  sell: number;
  trade: number;
  keep: number;
}

// Price matrix
export const CHAIN_SIZE_BRACKETS = [2, 3, 5, 10, 20, 30, 40, Infinity] as const;
export const BASE_PRICES: Record<ChainTier, number[]> = {
  budget: [200, 300, 400, 500, 600, 700, 800, 900],
  midrange: [300, 400, 500, 600, 700, 800, 900, 1000],
  premium: [400, 500, 600, 700, 800, 900, 1000, 1100],
};

export const CHAINS: Record<ChainName, ChainInfo> = {
  sackson: { name: 'sackson', displayName: 'Sackson', tier: 'budget', color: 'hsl(25, 95%, 53%)', textColor: 'white' },
  tower: { name: 'tower', displayName: 'Tower', tier: 'budget', color: 'hsl(45, 93%, 47%)', textColor: 'black' },
  worldwide: { name: 'worldwide', displayName: 'Worldwide', tier: 'midrange', color: 'hsl(280, 67%, 60%)', textColor: 'white' },
  american: { name: 'american', displayName: 'American', tier: 'midrange', color: 'hsl(217, 91%, 60%)', textColor: 'white' },
  festival: { name: 'festival', displayName: 'Festival', tier: 'midrange', color: 'hsl(142, 71%, 45%)', textColor: 'white' },
  continental: { name: 'continental', displayName: 'Continental', tier: 'premium', color: 'hsl(0, 84%, 60%)', textColor: 'white' },
  imperial: { name: 'imperial', displayName: 'Imperial', tier: 'premium', color: 'hsl(330, 81%, 60%)', textColor: 'white' },
};

export const INITIAL_CASH = 6000;
export const INITIAL_TILES_PER_PLAYER = 6;
export const MAX_STOCKS_PER_TURN = 3;
export const STOCKS_PER_CHAIN = 25;
export const SAFE_CHAIN_SIZE = 11;
export const END_GAME_CHAIN_SIZE = 41;
export const MAJORITY_BONUS_MULTIPLIER = 10;
export const MINORITY_BONUS_MULTIPLIER = 5;

// -----------------------------------------------------------------------------
// Power cards (Epic 17) — one identical set of five per player, each spent once
// -----------------------------------------------------------------------------
// Every player holds the same hand, so the cards add timing decisions rather
// than luck: the question is never "who drew the good card", it is "is this the
// turn worth spending it on". The rules that decide when a card may be played
// live in ./power-cards.ts, which both engines read.
export type PowerCardId =
  | 'extra_buy'     // buy up to 5 shares this turn instead of 3
  | 'extra_tiles'   // draw 5 tiles immediately
  | 'free_stock'    // the 3 shares taken this turn cost nothing
  | 'stock_trade'   // trade 2 shares you own for 1 from the market, up to 3x
  | 'multi_tile';   // place up to 4 tiles this turn

/** Fixed display and dealing order. Every seat is dealt exactly this set. */
export const POWER_CARDS: PowerCardId[] = [
  'extra_buy', 'extra_tiles', 'free_stock', 'stock_trade', 'multi_tile',
];

export const EXTRA_BUY_LIMIT = 5;      // shares, replaces MAX_STOCKS_PER_TURN for the turn
export const EXTRA_TILES_DRAW = 5;     // tiles drawn immediately
export const MULTI_TILE_LIMIT = 4;     // tiles placeable this turn
export const MAX_POWER_TRADES = 3;     // trades per turn
export const TRADE_GIVE = 2;           // shares given per trade
export const TRADE_RECEIVE = 1;        // shares received per trade

/**
 * The card in effect for the current turn. One nullable record rather than four
 * booleans because exactly one card can ever be active, and each carries
 * different bookkeeping.
 */
export interface ActivePowerCard {
  card: PowerCardId;
  /** stock_trade only: trades completed this turn, 0–MAX_POWER_TRADES. */
  tradesUsed: number;
}

// Eligible chain sets for Chain Founding Rules (Story 8)
export const ELIGIBLE_CHAINS_5: ChainName[] = ['sackson', 'tower', 'worldwide', 'american', 'continental'];
export const ELIGIBLE_CHAINS_6: ChainName[] = ['sackson', 'tower', 'worldwide', 'american', 'continental', 'imperial'];
export const ELIGIBLE_CHAINS_7: ChainName[] = ['sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial'];

// -----------------------------------------------------------------------------
// Custom rules (v2) — the single source of truth for both engines
// -----------------------------------------------------------------------------
// v1 modelled every rule as a `*Enabled` boolean plus a value, which meant
// "disabled" had a different meaning per rule (and, for chain safety, the
// opposite of what the lobby printed). v2 deletes the boolean layer: a rule is
// a value, and "off"/"standard" is one of its values.
//
// server/lib/rules.ts imports these rather than re-declaring them; legacy v1
// blobs are translated on read by normalizeRules() in ./rules-normalize.
export interface CustomRules {
  // ---- Basic ----
  /** 'large' = 9x12, 'small' = 6x10. */
  boardSize: 'large' | 'small';
  /** Percent of market price the bank pays back; 'off' disables selling. */
  stockSelling: 'off' | '100' | '90' | '75' | '50';
  /** Chain size at which a chain becomes safe; 'none' = Aggressive. */
  chainSafety: 'none' | '9' | '11' | '13' | '15';
  /** Optional one-shot power cards, one identical set of 5 per player. */
  powerCards: 'off' | 'on';

  // ---- Advanced ----
  /** Seconds per turn; 'off' disables the timer. */
  turnTimer: 'off' | '30' | '60' | '90';
  disableTimerFirstRounds: boolean;
  cashVisibility: 'visible' | 'hidden' | 'aggregate';
  bonusTier: 'standard' | 'flat' | 'aggressive';
  maxChains: '5' | '6' | '7';
  startingCash: '4000' | '6000' | '8000';
  startingTiles: '5' | '6' | '7';
  startWithTileOnBoard: boolean;
}

// Chain safety defaults to 'none' because that is what every room has actually
// played since launch — v1's `chainSafetyEnabled: false` made getSafeChainSize
// return null. v2 adopts the behaviour and labels it honestly.
export const DEFAULT_RULES: CustomRules = {
  boardSize: 'large',
  stockSelling: 'off',
  chainSafety: 'none',
  // Off by default, deliberately: every room created before Epic 17 and every
  // in-flight game normalises to 'off' and plays exactly as it does today.
  powerCards: 'off',
  turnTimer: 'off',
  disableTimerFirstRounds: true,
  cashVisibility: 'visible',
  bonusTier: 'standard',
  maxChains: '7',
  startingCash: '6000',
  startingTiles: '6',
  startWithTileOnBoard: true,
};
