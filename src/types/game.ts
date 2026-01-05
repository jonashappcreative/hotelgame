// Core game types for Acquire

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
  gameLog: GameLogEntry[];
  winner: string | null;
  endGameVotes: string[];
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
