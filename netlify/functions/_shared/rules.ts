// =============================================================================
// rules — pure Acquire rule helpers shared by the game engine and the bot.
// =============================================================================
// Extracted verbatim from game-action.ts so the bot evaluates move legality
// and pricing with exactly the same logic the engine enforces. Nothing here
// touches the database or the network — keep it pure.
// =============================================================================

export type ChainName =
  | 'sackson' | 'tower' | 'worldwide' | 'american'
  | 'festival' | 'continental' | 'imperial';
export type TileId = string;

// Mirror of src/types/game.ts CustomRules — keep in sync (founderFreeStock intentionally excluded)
export interface CustomRules {
  startWithTileOnBoard: boolean;
  turnTimerEnabled: boolean;
  turnTimer: string;
  disableTimerFirstRounds: boolean;
  chainSafetyEnabled: boolean;
  chainSafetyThreshold: string;
  cashVisibilityEnabled: boolean;
  cashVisibility: string;
  bonusTierEnabled: boolean;
  bonusTier: string;
  boardSizeEnabled: boolean;
  boardSize: string;
  chainFoundingEnabled: boolean;
  maxChains: string;
  startingConditionsEnabled: boolean;
  startingCash: string;
  startingTiles: string;
}

export const DEFAULT_RULES: CustomRules = {
  startWithTileOnBoard: true,
  turnTimerEnabled: false,
  turnTimer: '60',
  disableTimerFirstRounds: true,
  chainSafetyEnabled: false,
  chainSafetyThreshold: 'none',
  cashVisibilityEnabled: false,
  cashVisibility: 'hidden',
  bonusTierEnabled: false,
  bonusTier: 'standard',
  boardSizeEnabled: false,
  boardSize: '9x12',
  chainFoundingEnabled: false,
  maxChains: '7',
  startingConditionsEnabled: false,
  startingCash: '6000',
  startingTiles: '6',
};

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

export function getSafeChainSize(rules: CustomRules): number | null {
  if (!rules.chainSafetyEnabled) return null;
  if (rules.chainSafetyThreshold === 'none') return null;
  return parseInt(rules.chainSafetyThreshold);
}

export function getBoardDimensions(rules: CustomRules): { boardRows: number; boardColsCount: number } {
  const boardRows = rules.boardSizeEnabled && rules.boardSize === '6x10' ? 6 : 9;
  const boardColsCount = rules.boardSizeEnabled && rules.boardSize === '6x10' ? 10 : 12;
  return { boardRows, boardColsCount };
}

export function getEligibleChains(rules: CustomRules): ChainName[] {
  if (!rules.chainFoundingEnabled) return ELIGIBLE_CHAINS_7_EF;
  const max = parseInt(rules.maxChains);
  return max === 5 ? ELIGIBLE_CHAINS_5_EF : max === 6 ? ELIGIBLE_CHAINS_6_EF : ELIGIBLE_CHAINS_7_EF;
}

export function getBonusTier(rules: CustomRules): string {
  return rules.bonusTierEnabled ? rules.bonusTier : 'standard';
}

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

export function checkGameEnd(chains: Record<ChainName, any>): boolean {
  const activeChains = Object.values(chains).filter((c: any) => c.isActive);
  return activeChains.some((c: any) => c.tiles.length >= END_GAME_CHAIN_SIZE);
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
