import {
  TileId,
  ChainName,
  GameState,
  MergerState,
  MergerStockDecision,
  CHAINS,
  SAFE_CHAIN_SIZE,
} from '@/types/game';
import {
  getStockPrice,
  getBonuses,
  getStockholderRankings,
  getAdjacentTiles,
} from './gameLogic';

// Determine merger details when a tile connects multiple chains
export const analyzeMerger = (
  state: GameState,
  tileId: TileId,
  adjacentChains: ChainName[]
): {
  canMerge: boolean;
  reason?: string;
  sortedChains: { chain: ChainName; size: number }[];
  largestSize: number;
  tieBreakerNeeded: boolean;
  potentialSurvivors: ChainName[];
} => {
  // Sort chains by size (largest first)
  const sortedChains = adjacentChains
    .map(chain => ({
      chain,
      size: state.chains[chain].tiles.length,
    }))
    .sort((a, b) => b.size - a.size);

  const largestSize = sortedChains[0].size;
  
  // Check if any safe chains would be acquired (invalid)
  const safeChains = sortedChains.filter(c => c.size >= SAFE_CHAIN_SIZE);
  if (safeChains.length >= 2) {
    return {
      canMerge: false,
      reason: 'Cannot merge two or more safe chains (11+ tiles)',
      sortedChains,
      largestSize,
      tieBreakerNeeded: false,
      potentialSurvivors: [],
    };
  }

  // Check if there's a tie for largest
  const tiedForLargest = sortedChains.filter(c => c.size === largestSize);
  const tieBreakerNeeded = tiedForLargest.length > 1;

  // If there's a safe chain, it must survive
  if (safeChains.length === 1) {
    return {
      canMerge: true,
      sortedChains,
      largestSize,
      tieBreakerNeeded: false,
      potentialSurvivors: [safeChains[0].chain],
    };
  }

  return {
    canMerge: true,
    sortedChains,
    largestSize,
    tieBreakerNeeded,
    potentialSurvivors: tiedForLargest.map(c => c.chain),
  };
};

// Initialize merger state after tile placement
export const initializeMerger = (
  state: GameState,
  adjacentChains: ChainName[],
  survivingChain?: ChainName
): MergerState => {
  const analysis = analyzeMerger(state, state.lastPlacedTile!, adjacentChains);
  
  // Determine surviving chain
  let survivor: ChainName;
  if (survivingChain) {
    survivor = survivingChain;
  } else if (analysis.potentialSurvivors.length === 1) {
    survivor = analysis.potentialSurvivors[0];
  } else {
    // This shouldn't happen - tiebreaker should have been handled
    survivor = analysis.sortedChains[0].chain;
  }

  // Get defunct chains in order (largest first, excluding survivor)
  const defunctChains = analysis.sortedChains
    .filter(c => c.chain !== survivor)
    .map(c => c.chain);

  return {
    survivingChain: survivor,
    defunctChains,
    currentDefunctChain: defunctChains[0] || null,
    currentPlayerIndex: state.currentPlayerIndex,
    bonusesPaid: false,
  };
};

// Pay majority/minority bonuses for a defunct chain
export const payMergerBonuses = (
  state: GameState,
  defunctChain: ChainName
): GameState => {
  const newState = { ...state };
  const chainSize = state.chains[defunctChain].tiles.length;
  const bonuses = getBonuses(defunctChain, chainSize);
  const { majority, minority } = getStockholderRankings(state.players, defunctChain);

  const newPlayers = [...state.players];

  if (majority.length > 0) {
    if (minority.length === 0) {
      // Majority holders split both bonuses
      const totalBonus = bonuses.majority + bonuses.minority;
      const perPlayer = Math.floor(totalBonus / majority.length);
      for (const player of majority) {
        const idx = newPlayers.findIndex(p => p.id === player.id);
        newPlayers[idx] = {
          ...newPlayers[idx],
          cash: newPlayers[idx].cash + perPlayer,
        };
      }
      
      // Add to log
      newState.gameLog = [
        ...state.gameLog,
        {
          timestamp: Date.now(),
          playerId: 'system',
          playerName: 'System',
          action: `${CHAINS[defunctChain].displayName} bonuses paid`,
          details: majority.length > 1 
            ? `${majority.map(p => p.name).join(', ')} split $${totalBonus} (majority+minority)`
            : `${majority[0].name} receives $${totalBonus} (majority+minority)`,
        },
      ];
    } else {
      // Normal distribution
      const majorityBonus = Math.floor(bonuses.majority / majority.length);
      const minorityBonus = Math.floor(bonuses.minority / minority.length);

      for (const player of majority) {
        const idx = newPlayers.findIndex(p => p.id === player.id);
        newPlayers[idx] = {
          ...newPlayers[idx],
          cash: newPlayers[idx].cash + majorityBonus,
        };
      }
      for (const player of minority) {
        const idx = newPlayers.findIndex(p => p.id === player.id);
        newPlayers[idx] = {
          ...newPlayers[idx],
          cash: newPlayers[idx].cash + minorityBonus,
        };
      }

      // Add to log
      newState.gameLog = [
        ...state.gameLog,
        {
          timestamp: Date.now(),
          playerId: 'system',
          playerName: 'System',
          action: `${CHAINS[defunctChain].displayName} bonuses paid`,
          details: `Majority: ${majority.map(p => p.name).join(', ')} ($${majorityBonus} each), Minority: ${minority.map(p => p.name).join(', ')} ($${minorityBonus} each)`,
        },
      ];
    }
  }

  newState.players = newPlayers;
  return newState;
};

// Handle a player's stock decision during merger
export const handleMergerStockDecision = (
  state: GameState,
  playerIndex: number,
  decision: MergerStockDecision
): GameState => {
  if (!state.merger || !state.merger.currentDefunctChain || !state.merger.survivingChain) {
    return state;
  }

  const newState = { ...state };
  const defunctChain = state.merger.currentDefunctChain;
  const survivingChain = state.merger.survivingChain;
  const player = state.players[playerIndex];
  const currentShares = player.stocks[defunctChain];

  // Validate decision
  const totalAccountedFor = decision.sell + decision.trade + decision.keep;
  if (totalAccountedFor !== currentShares) {
    console.error('Invalid decision: shares don\'t add up');
    return state;
  }

  // Validate trade ratio
  if (decision.trade % 2 !== 0) {
    console.error('Trade must be an even number (2:1 ratio)');
    return state;
  }

  const newPlayers = [...state.players];
  const newPlayer = { ...player, stocks: { ...player.stocks } };
  const newStockBank = { ...state.stockBank };

  // Process SELL
  const salePrice = getStockPrice(defunctChain, state.chains[defunctChain].tiles.length);
  newPlayer.cash += decision.sell * salePrice;
  newPlayer.stocks[defunctChain] -= decision.sell;
  newStockBank[defunctChain] += decision.sell;

  // Process TRADE (2:1)
  const sharesToReceive = decision.trade / 2;
  const availableShares = Math.min(sharesToReceive, state.stockBank[survivingChain]);
  newPlayer.stocks[defunctChain] -= decision.trade;
  newPlayer.stocks[survivingChain] += availableShares;
  newStockBank[defunctChain] += decision.trade;
  newStockBank[survivingChain] -= availableShares;

  // KEEP - just leave them as is (already subtracted sell and trade amounts)
  
  newPlayers[playerIndex] = newPlayer;
  newState.players = newPlayers;
  newState.stockBank = newStockBank;

  // Add to log
  const actions = [];
  if (decision.sell > 0) actions.push(`sold ${decision.sell} for $${decision.sell * salePrice}`);
  if (decision.trade > 0) actions.push(`traded ${decision.trade} for ${availableShares} ${CHAINS[survivingChain].displayName}`);
  if (decision.keep > 0) actions.push(`kept ${decision.keep}`);

  newState.gameLog = [
    ...state.gameLog,
    {
      timestamp: Date.now(),
      playerId: player.id,
      playerName: player.name,
      action: `${CHAINS[defunctChain].displayName} stock decision`,
      details: actions.join(', '),
    },
  ];

  return newState;
};

// Move to next player in merger stock decision phase
export const advanceMergerPlayer = (state: GameState): GameState => {
  if (!state.merger) return state;

  const newState = { ...state };
  const merger = { ...state.merger };
  const defunctChain = merger.currentDefunctChain!;

  // Find next player with shares in the defunct chain
  let nextIndex = (merger.currentPlayerIndex + 1) % state.players.length;
  const startIndex = state.currentPlayerIndex; // Active player who caused merger
  
  // Check if we've gone full circle
  let checkedAll = false;
  while (!checkedAll) {
    // If we're back to where we started, this defunct chain is done
    if (nextIndex === startIndex && merger.currentPlayerIndex !== startIndex) {
      // Move to next defunct chain or end merger
      const currentDefunctIndex = merger.defunctChains.indexOf(defunctChain);
      if (currentDefunctIndex < merger.defunctChains.length - 1) {
        // More defunct chains to process
        merger.currentDefunctChain = merger.defunctChains[currentDefunctIndex + 1];
        merger.currentPlayerIndex = startIndex;
        merger.bonusesPaid = false;
        newState.phase = 'merger_pay_bonuses';
      } else {
        // All defunct chains processed - complete the merger
        return completeMerger(newState);
      }
      break;
    }

    // Check if this player has shares
    if (state.players[nextIndex].stocks[defunctChain] > 0) {
      merger.currentPlayerIndex = nextIndex;
      break;
    }

    nextIndex = (nextIndex + 1) % state.players.length;
    if (nextIndex === merger.currentPlayerIndex) {
      // No more players with shares
      const currentDefunctIndex = merger.defunctChains.indexOf(defunctChain);
      if (currentDefunctIndex < merger.defunctChains.length - 1) {
        merger.currentDefunctChain = merger.defunctChains[currentDefunctIndex + 1];
        merger.currentPlayerIndex = startIndex;
        merger.bonusesPaid = false;
        newState.phase = 'merger_pay_bonuses';
      } else {
        return completeMerger(newState);
      }
      checkedAll = true;
    }
  }

  newState.merger = merger;
  return newState;
};

// Complete the merger - transfer tiles to surviving chain
export const completeMerger = (state: GameState): GameState => {
  if (!state.merger || !state.merger.survivingChain) return state;

  const newState = { ...state };
  const survivingChain = state.merger.survivingChain;
  const lastTile = state.lastPlacedTile!;

  // Collect all tiles to add to surviving chain
  const tilesToAdd: TileId[] = [lastTile];
  
  // Add all unincorporated adjacent tiles
  const adjacent = getAdjacentTiles(lastTile);
  for (const adjTile of adjacent) {
    const tile = state.board.get(adjTile);
    if (tile?.placed && !tile.chain) {
      tilesToAdd.push(adjTile);
    }
  }

  // Add all defunct chain tiles
  for (const defunctChain of state.merger.defunctChains) {
    tilesToAdd.push(...state.chains[defunctChain].tiles);
  }

  // Update board
  const newBoard = new Map(state.board);
  for (const tileId of tilesToAdd) {
    const tile = newBoard.get(tileId)!;
    newBoard.set(tileId, { ...tile, chain: survivingChain });
  }
  newState.board = newBoard;

  // Update chains
  const newChains = { ...state.chains };
  
  // Update surviving chain
  const existingTiles = newChains[survivingChain].tiles;
  const allTiles = [...new Set([...existingTiles, ...tilesToAdd])];
  newChains[survivingChain] = {
    ...newChains[survivingChain],
    tiles: allTiles,
    isSafe: allTiles.length >= SAFE_CHAIN_SIZE,
  };

  // Deactivate defunct chains
  for (const defunctChain of state.merger.defunctChains) {
    newChains[defunctChain] = {
      ...newChains[defunctChain],
      tiles: [],
      isActive: false,
      isSafe: false,
    };
  }

  newState.chains = newChains;

  // Add to log
  newState.gameLog = [
    ...state.gameLog,
    {
      timestamp: Date.now(),
      playerId: 'system',
      playerName: 'System',
      action: 'Merger complete',
      details: `${CHAINS[survivingChain].displayName} absorbed ${state.merger.defunctChains.map(c => CHAINS[c].displayName).join(', ')}. Now has ${allTiles.length} tiles.`,
    },
  ];

  // Clear merger state and move to buy phase
  newState.merger = null;
  newState.phase = 'buy_stock';

  return newState;
};

// Get players who have stock in a chain
export const getPlayersWithStock = (state: GameState, chain: ChainName): number[] => {
  return state.players
    .map((p, idx) => ({ idx, shares: p.stocks[chain] }))
    .filter(p => p.shares > 0)
    .map(p => p.idx);
};
