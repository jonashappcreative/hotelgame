// =============================================================================
// rules — pure Hotel Game rule helpers shared by the game engine and the bot.
// =============================================================================
// Extracted verbatim from game-action.ts so the bot evaluates move legality
// and pricing with exactly the same logic the engine enforces. Nothing here
// touches the database or the network — keep it pure.
// =============================================================================

export type ChainName =
  | 'sackson' | 'tower' | 'worldwide' | 'american'
  | 'festival' | 'continental' | 'imperial';
export type TileId = string;

// Rules model, normalisation, validation and the derived getters all live in
// src/types/rules-normalize.ts so the browser engine and this one read the same
// definitions. They are re-exported here because every server module already
// imports its rule helpers from `../lib/rules`.
export type { CustomRules } from '../../src/types/game';
export { DEFAULT_RULES } from '../../src/types/game';
export {
  normalizeRules,
  validateRules,
  isLegacyRules,
  coerceBoardSizeCoupling,
  getSafeChainSize,
  getBoardDimensions,
  getEligibleChains,
  getMaxChains,
  getBonusTier,
  getSellPriceFactor,
  getTurnTimerSeconds,
  RULE_VALUES,
} from '../../src/types/rules-normalize';
export type { ValidationResult } from '../../src/types/rules-normalize';

export interface MergerStockDecision {
  sell: number;
  trade: number;
  keep: number;
}

// Chain info for game logic
export const CHAINS: Record<ChainName, { displayName: string; tier: 'budget' | 'midrange' | 'premium' }> = {
  sackson: { displayName: 'Sackson', tier: 'budget' },
  tower: { displayName: 'Tower', tier: 'budget' },
  worldwide: { displayName: 'Worldwide', tier: 'midrange' },
  american: { displayName: 'American', tier: 'midrange' },
  festival: { displayName: 'Festival', tier: 'midrange' },
  continental: { displayName: 'Continental', tier: 'premium' },
  imperial: { displayName: 'Imperial', tier: 'premium' },
};

export const END_GAME_CHAIN_SIZE = 41;
export const MAX_STOCKS_PER_TURN = 3;
export const CHAIN_SIZE_BRACKETS = [2, 3, 5, 10, 20, 30, 40, Infinity] as const;
export const BASE_PRICES: Record<'budget' | 'midrange' | 'premium', number[]> = {
  budget: [200, 300, 400, 500, 600, 700, 800, 900],
  midrange: [300, 400, 500, 600, 700, 800, 900, 1000],
  premium: [400, 500, 600, 700, 800, 900, 1000, 1100],
};
export const ALL_COLS_EF = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// Eligible chain sets for Chain Founding Rules
export const ELIGIBLE_CHAINS_5_EF: ChainName[] = ['sackson', 'tower', 'worldwide', 'american', 'continental'];
export const ELIGIBLE_CHAINS_6_EF: ChainName[] = ['sackson', 'tower', 'worldwide', 'american', 'continental', 'imperial'];
export const ELIGIBLE_CHAINS_7_EF: ChainName[] = ['sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial'];

// Helper functions
export function getStockPrice(chainName: ChainName, size: number): number {
  if (size === 0) return 0;
  const tier = CHAINS[chainName].tier;
  const prices = BASE_PRICES[tier];

  for (let i = 0; i < CHAIN_SIZE_BRACKETS.length; i++) {
    if (size <= CHAIN_SIZE_BRACKETS[i]) {
      return prices[i];
    }
  }
  return prices[prices.length - 1];
}

// What the bank pays for one share, rounded down to the nearest $10 so the
// figure always reads like a price on a chain card. `factor` comes from
// getSellPriceFactor; a factor of 1 is the identity of getStockPrice.
export function getSellPrice(chainName: ChainName, size: number, factor: number): number {
  return Math.floor((getStockPrice(chainName, size) * factor) / 10) * 10;
}

export interface SaleRequest {
  chain: ChainName;
  quantity: number;
}

export interface SaleOutcome {
  ok: boolean;
  /** Present when ok. */
  settlement?: SaleSettlement;
  /** Present when the sale was rejected. */
  error?: string;
}

export interface SaleSettlement {
  /** Cash the seller receives for the whole basket. */
  proceeds: number;
  /** Shares sold across all chains. */
  totalQuantity: number;
  /** Seller's holdings after the sale. */
  newStocks: Record<ChainName, number>;
  /** Bank holdings after the sale. */
  newStockBank: Record<ChainName, number>;
  /** Per-chain breakdown, for the game log. */
  lines: { chain: ChainName; quantity: number; amount: number }[];
}

// Pure validation + settlement for a sale basket. The engine case in
// server/api/game-action.ts does nothing but persist what this returns, which
// keeps every rejection rule testable without a database.
export function settleSale(opts: {
  sales: SaleRequest[];
  chains: Record<ChainName, { tiles: TileId[]; isActive: boolean }>;
  stocks: Record<ChainName, number>;
  stockBank: Record<ChainName, number>;
  soldThisTurn: number;
  chainsBoughtThisTurn: ChainName[];
  factor: number;
}): SaleOutcome {
  const { sales, chains, stocks, stockBank, soldThisTurn, chainsBoughtThisTurn, factor } = opts;

  if (factor <= 0) return { ok: false, error: 'Stock selling is not enabled in this room' };
  if (!Array.isArray(sales) || sales.length === 0) {
    return { ok: false, error: 'No shares selected to sell' };
  }

  // Collapse duplicate entries so a basket can't slip past the per-chain checks
  // by naming the same chain twice.
  const wanted = new Map<ChainName, number>();
  for (const sale of sales) {
    const qty = Number(sale?.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      return { ok: false, error: 'Sale quantity must be a positive whole number' };
    }
    if (!chains[sale.chain]) return { ok: false, error: `Unknown chain: ${sale.chain}` };
    wanted.set(sale.chain, (wanted.get(sale.chain) ?? 0) + qty);
  }

  const totalQuantity = [...wanted.values()].reduce((sum, q) => sum + q, 0);
  if (soldThisTurn + totalQuantity > MAX_STOCKS_PER_TURN) {
    return { ok: false, error: `Cannot sell more than ${MAX_STOCKS_PER_TURN} stocks per turn` };
  }

  const newStocks = { ...stocks };
  const newStockBank = { ...stockBank };
  const lines: { chain: ChainName; quantity: number; amount: number }[] = [];
  let proceeds = 0;

  for (const [chain, quantity] of wanted) {
    if (!chains[chain].isActive) {
      return { ok: false, error: `Cannot sell stock in inactive chain: ${chain}` };
    }
    if (chainsBoughtThisTurn.includes(chain)) {
      return { ok: false, error: `Cannot sell ${CHAINS[chain].displayName} — bought this turn` };
    }
    if ((stocks[chain] ?? 0) < quantity) {
      return {
        ok: false,
        error: `You only hold ${stocks[chain] ?? 0} ${CHAINS[chain].displayName} share(s)`,
      };
    }

    const amount = getSellPrice(chain, chains[chain].tiles.length, factor) * quantity;
    proceeds += amount;
    newStocks[chain] = (newStocks[chain] ?? 0) - quantity;
    newStockBank[chain] = (newStockBank[chain] ?? 0) + quantity;
    lines.push({ chain, quantity, amount });
  }

  return { ok: true, settlement: { proceeds, totalQuantity, newStocks, newStockBank, lines } };
}

export function getBonuses(chainName: ChainName, size: number, bonusTier: string = 'standard'): { majority: number; minority: number } {
  const price = getStockPrice(chainName, size);
  const majorityMult = bonusTier === 'aggressive' ? 15 : 10;
  return {
    majority: price * majorityMult,
    minority: price * 5,
  };
}

export function parseTileId(tileId: TileId): { row: number; col: string } {
  const match = tileId.match(/^(\d)([A-L])$/);
  if (!match) throw new Error(`Invalid tile ID: ${tileId}`);
  return { row: parseInt(match[1]), col: match[2] };
}

export function getAdjacentTiles(tileId: TileId, boardRows: number = 9, boardColsCount: number = 12): TileId[] {
  const { row, col } = parseTileId(tileId);
  const cols = ALL_COLS_EF.slice(0, boardColsCount);
  const colIndex = cols.indexOf(col);
  const adjacent: TileId[] = [];

  if (row > 1) adjacent.push(`${row - 1}${col}`);
  if (row < boardRows) adjacent.push(`${row + 1}${col}`);
  if (colIndex > 0) adjacent.push(`${row}${cols[colIndex - 1]}`);
  if (colIndex < cols.length - 1) adjacent.push(`${row}${cols[colIndex + 1]}`);

  return adjacent;
}

export function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function generateAllTiles(boardRows: number = 9, boardColsCount: number = 12): TileId[] {
  const tiles: TileId[] = [];
  const cols = ALL_COLS_EF.slice(0, boardColsCount);
  for (let row = 1; row <= boardRows; row++) {
    for (const col of cols) {
      tiles.push(`${row}${col}`);
    }
  }
  return tiles;
}

export const SMALL_BOARD_END_GAME_SIZE = 30;

export function checkGameEnd(chains: Record<ChainName, any>, boardRows: number = 9): boolean {
  const endSize = boardRows === 6 ? SMALL_BOARD_END_GAME_SIZE : END_GAME_CHAIN_SIZE;
  const activeChains = Object.values(chains).filter((c: any) => c.isActive);
  return activeChains.some((c: any) => c.tiles.length >= endSize);
}

export function getStockholderRankings(players: any[], chainName: ChainName): { majority: any[]; minority: any[] } {
  const holders = players
    .filter(p => p.stocks[chainName] > 0)
    .sort((a, b) => b.stocks[chainName] - a.stocks[chainName]);

  if (holders.length === 0) {
    return { majority: [], minority: [] };
  }

  const maxShares = holders[0].stocks[chainName];
  const majority = holders.filter(p => p.stocks[chainName] === maxShares);

  if (majority.length === holders.length) {
    return { majority, minority: [] };
  }

  const remainingHolders = holders.filter(p => p.stocks[chainName] < maxShares);
  if (remainingHolders.length === 0) {
    return { majority, minority: [] };
  }

  const secondMaxShares = remainingHolders[0].stocks[chainName];
  const minority = remainingHolders.filter(p => p.stocks[chainName] === secondMaxShares);

  return { majority, minority };
}

export function calculateFinalScores(players: any[], chains: Record<ChainName, any>, bonusTier: string = 'standard'): any[] {
  const scoredPlayers = players.map(p => ({ ...p }));

  for (const chain of Object.values(chains)) {
    if (!(chain as any).isActive) continue;
    const c = chain as any;

    const bonuses = getBonuses(c.name, c.tiles.length, bonusTier);

    if (bonusTier === 'flat') {
      // Flat: split combined pool equally among all stockholders
      const allHolders = scoredPlayers.filter(p => p.stocks[c.name] > 0);
      if (allHolders.length > 0) {
        const flatPool = bonuses.majority + bonuses.minority;
        const perPlayer = Math.floor(flatPool / allHolders.length);
        for (const holder of allHolders) {
          const p = scoredPlayers.find(pl => pl.id === holder.id)!;
          p.cash += perPlayer;
        }
      }
    } else {
      const { majority, minority } = getStockholderRankings(scoredPlayers, c.name);

      if (majority.length > 0) {
        if (minority.length === 0) {
          const totalBonus = bonuses.majority + bonuses.minority;
          const perPlayer = Math.floor(totalBonus / majority.length);
          for (const player of majority) {
            const p = scoredPlayers.find(pl => pl.id === player.id)!;
            p.cash += perPlayer;
          }
        } else {
          const majorityBonus = Math.floor(bonuses.majority / majority.length);
          const minorityBonus = Math.floor(bonuses.minority / minority.length);

          for (const player of majority) {
            const p = scoredPlayers.find(pl => pl.id === player.id)!;
            p.cash += majorityBonus;
          }
          for (const player of minority) {
            const p = scoredPlayers.find(pl => pl.id === player.id)!;
            p.cash += minorityBonus;
          }
        }
      }
    }

    const price = getStockPrice(c.name, c.tiles.length);
    for (const player of scoredPlayers) {
      player.cash += player.stocks[c.name] * price;
      player.stocks[c.name] = 0;
    }
  }

  return scoredPlayers.sort((a, b) => b.cash - a.cash);
}
