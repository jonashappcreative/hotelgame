import {
  TileId,
  ChainName,
  GameState,
  ChainState,
  PlayerState,
  TileState,
  CHAINS,
  BASE_PRICES,
  CHAIN_SIZE_BRACKETS,
  INITIAL_CASH,
  INITIAL_TILES_PER_PLAYER,
  STOCKS_PER_CHAIN,
  SAFE_CHAIN_SIZE,
  END_GAME_CHAIN_SIZE,
  MAJORITY_BONUS_MULTIPLIER,
  MINORITY_BONUS_MULTIPLIER,
  ChainInfo,
} from '@/types/game';

// Generate all tile IDs
export const generateAllTiles = (): TileId[] => {
  const tiles: TileId[] = [];
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  for (let row = 1; row <= 9; row++) {
    for (const col of cols) {
      tiles.push(`${row}${col}` as TileId);
    }
  }
  return tiles;
};

// Shuffle array
export const shuffle = <T>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Parse tile ID to coordinates
export const parseTileId = (tileId: TileId): { row: number; col: string } => {
  const match = tileId.match(/^(\d)([A-L])$/);
  if (!match) throw new Error(`Invalid tile ID: ${tileId}`);
  return { row: parseInt(match[1]), col: match[2] };
};

// Get adjacent tiles
export const getAdjacentTiles = (tileId: TileId): TileId[] => {
  const { row, col } = parseTileId(tileId);
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const colIndex = cols.indexOf(col);
  const adjacent: TileId[] = [];

  if (row > 1) adjacent.push(`${row - 1}${col}` as TileId);
  if (row < 9) adjacent.push(`${row + 1}${col}` as TileId);
  if (colIndex > 0) adjacent.push(`${row}${cols[colIndex - 1]}` as TileId);
  if (colIndex < 11) adjacent.push(`${row}${cols[colIndex + 1]}` as TileId);

  return adjacent;
};

// Get stock price based on chain size and tier
export const getStockPrice = (chainName: ChainName, size: number): number => {
  if (size === 0) return 0;
  const tier = CHAINS[chainName].tier;
  const prices = BASE_PRICES[tier];
  
  for (let i = 0; i < CHAIN_SIZE_BRACKETS.length; i++) {
    if (size <= CHAIN_SIZE_BRACKETS[i]) {
      return prices[i];
    }
  }
  return prices[prices.length - 1];
};

// Get majority and minority bonuses
export const getBonuses = (chainName: ChainName, size: number): { majority: number; minority: number } => {
  const price = getStockPrice(chainName, size);
  return {
    majority: price * MAJORITY_BONUS_MULTIPLIER,
    minority: price * MINORITY_BONUS_MULTIPLIER,
  };
};

// Calculate stockholders rankings
export const getStockholderRankings = (
  players: PlayerState[],
  chainName: ChainName
): { majority: PlayerState[]; minority: PlayerState[] } => {
  const holders = players
    .filter(p => p.stocks[chainName] > 0)
    .sort((a, b) => b.stocks[chainName] - a.stocks[chainName]);

  if (holders.length === 0) {
    return { majority: [], minority: [] };
  }

  const maxShares = holders[0].stocks[chainName];
  const majority = holders.filter(p => p.stocks[chainName] === maxShares);

  if (majority.length === holders.length) {
    // All tied for majority - they split both bonuses
    return { majority, minority: [] };
  }

  const remainingHolders = holders.filter(p => p.stocks[chainName] < maxShares);
  if (remainingHolders.length === 0) {
    return { majority, minority: [] };
  }

  const secondMaxShares = remainingHolders[0].stocks[chainName];
  const minority = remainingHolders.filter(p => p.stocks[chainName] === secondMaxShares);

  return { majority, minority };
};

// Initialize game state
export const initializeGame = (playerNames: string[]): GameState => {
  if (playerNames.length !== 4) {
    throw new Error('Game requires exactly 4 players');
  }

  // Initialize tile bag
  let tileBag = shuffle(generateAllTiles());

  // Initialize board
  const board = new Map<TileId, TileState>();
  for (const tileId of generateAllTiles()) {
    board.set(tileId, { id: tileId, placed: false, chain: null });
  }

  // Place one random starting tile
  const startingTile = tileBag.pop()!;
  board.set(startingTile, { id: startingTile, placed: true, chain: null });

  // Initialize players
  const players: PlayerState[] = playerNames.map((name, index) => {
    const tiles = tileBag.splice(0, INITIAL_TILES_PER_PLAYER);
    return {
      id: `player-${index}`,
      name,
      cash: INITIAL_CASH,
      tiles,
      stocks: {
        sackson: 0,
        tower: 0,
        worldwide: 0,
        american: 0,
        festival: 0,
        continental: 0,
        imperial: 0,
      },
      isConnected: true,
    };
  });

  // Initialize chains
  const chains: Record<ChainName, ChainState> = {
    sackson: { name: 'sackson', tiles: [], isActive: false, isSafe: false },
    tower: { name: 'tower', tiles: [], isActive: false, isSafe: false },
    worldwide: { name: 'worldwide', tiles: [], isActive: false, isSafe: false },
    american: { name: 'american', tiles: [], isActive: false, isSafe: false },
    festival: { name: 'festival', tiles: [], isActive: false, isSafe: false },
    continental: { name: 'continental', tiles: [], isActive: false, isSafe: false },
    imperial: { name: 'imperial', tiles: [], isActive: false, isSafe: false },
  };

  // Initialize stock bank
  const stockBank: Record<ChainName, number> = {
    sackson: STOCKS_PER_CHAIN,
    tower: STOCKS_PER_CHAIN,
    worldwide: STOCKS_PER_CHAIN,
    american: STOCKS_PER_CHAIN,
    festival: STOCKS_PER_CHAIN,
    continental: STOCKS_PER_CHAIN,
    imperial: STOCKS_PER_CHAIN,
  };

  return {
    roomCode: generateRoomCode(),
    players,
    currentPlayerIndex: 0,
    phase: 'place_tile',
    board,
    chains,
    stockBank,
    tileBag,
    lastPlacedTile: startingTile,
    pendingChainFoundation: null,
    merger: null,
    mergerAdjacentChains: null,
    stocksPurchasedThisTurn: 0,
    gameLog: [{
      timestamp: Date.now(),
      playerId: 'system',
      playerName: 'System',
      action: 'Game started',
      details: `Starting tile ${startingTile} placed on board`,
    }],
    winner: null,
    endGameVotes: [],
  };
};

const generateRoomCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
};

// Check what happens when a tile is placed
export const analyzeTilePlacement = (
  state: GameState,
  tileId: TileId
): {
  valid: boolean;
  reason?: string;
  action: 'place_only' | 'form_chain' | 'grow_chain' | 'merge_chains';
  adjacentChains: ChainName[];
  adjacentUnincorporated: TileId[];
} => {
  const adjacent = getAdjacentTiles(tileId);
  const adjacentChains = new Set<ChainName>();
  const adjacentUnincorporated: TileId[] = [];

  for (const adjTile of adjacent) {
    const tile = state.board.get(adjTile);
    if (tile?.placed) {
      if (tile.chain) {
        adjacentChains.add(tile.chain);
      } else {
        adjacentUnincorporated.push(adjTile);
      }
    }
  }

  const chainArray = Array.from(adjacentChains);

  // Check for safe chain merger (invalid)
  if (chainArray.length >= 2) {
    const safeChains = chainArray.filter(c => state.chains[c].isSafe);
    if (safeChains.length >= 2) {
      return {
        valid: false,
        reason: 'Cannot merge two or more safe chains (11+ tiles)',
        action: 'merge_chains',
        adjacentChains: chainArray,
        adjacentUnincorporated,
      };
    }
  }

  // Check if this would create an 8th chain
  if (chainArray.length === 0 && adjacentUnincorporated.length > 0) {
    const activeChains = Object.values(state.chains).filter(c => c.isActive).length;
    if (activeChains >= 7) {
      return {
        valid: false,
        reason: 'Cannot create an 8th hotel chain',
        action: 'form_chain',
        adjacentChains: chainArray,
        adjacentUnincorporated,
      };
    }
  }

  // Determine action
  let action: 'place_only' | 'form_chain' | 'grow_chain' | 'merge_chains';
  
  if (chainArray.length >= 2) {
    action = 'merge_chains';
  } else if (chainArray.length === 1) {
    action = 'grow_chain';
  } else if (adjacentUnincorporated.length > 0) {
    action = 'form_chain';
  } else {
    action = 'place_only';
  }

  return {
    valid: true,
    action,
    adjacentChains: chainArray,
    adjacentUnincorporated,
  };
};

// Place a tile on the board
export const placeTile = (state: GameState, tileId: TileId): GameState => {
  const newState = { ...state };
  const newBoard = new Map(state.board);
  
  newBoard.set(tileId, { id: tileId, placed: true, chain: null });
  newState.board = newBoard;
  newState.lastPlacedTile = tileId;

  // Remove tile from player's hand
  const currentPlayer = { ...newState.players[newState.currentPlayerIndex] };
  currentPlayer.tiles = currentPlayer.tiles.filter(t => t !== tileId);
  newState.players = [...newState.players];
  newState.players[newState.currentPlayerIndex] = currentPlayer;

  // Add to game log
  newState.gameLog = [
    ...state.gameLog,
    {
      timestamp: Date.now(),
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      action: 'Placed tile',
      details: tileId,
    },
  ];

  return newState;
};

// Found a new chain
export const foundChain = (state: GameState, chainName: ChainName): GameState => {
  const newState = { ...state };
  const lastTile = state.lastPlacedTile!;
  const analysis = analyzeTilePlacement(state, lastTile);
  
  // Get all tiles to add to the chain
  const tilesToAdd = [lastTile, ...analysis.adjacentUnincorporated];
  
  // Update board
  const newBoard = new Map(state.board);
  for (const tileId of tilesToAdd) {
    const tile = newBoard.get(tileId)!;
    newBoard.set(tileId, { ...tile, chain: chainName });
  }
  newState.board = newBoard;

  // Update chain
  const newChains = { ...state.chains };
  newChains[chainName] = {
    ...newChains[chainName],
    tiles: tilesToAdd,
    isActive: true,
    isSafe: tilesToAdd.length >= SAFE_CHAIN_SIZE,
  };
  newState.chains = newChains;

  // Give founding bonus (1 free share)
  const currentPlayer = { ...newState.players[newState.currentPlayerIndex] };
  if (state.stockBank[chainName] > 0) {
    currentPlayer.stocks = { ...currentPlayer.stocks };
    currentPlayer.stocks[chainName] += 1;
    newState.stockBank = { ...state.stockBank };
    newState.stockBank[chainName] -= 1;
  }
  newState.players = [...newState.players];
  newState.players[newState.currentPlayerIndex] = currentPlayer;

  // Update phase
  newState.phase = 'buy_stock';
  newState.pendingChainFoundation = null;

  // Add to game log
  newState.gameLog = [
    ...state.gameLog,
    {
      timestamp: Date.now(),
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      action: `Founded ${CHAINS[chainName].displayName}`,
      details: `Received 1 bonus share`,
    },
  ];

  return newState;
};

// Grow an existing chain
export const growChain = (state: GameState, chainName: ChainName): GameState => {
  const newState = { ...state };
  const lastTile = state.lastPlacedTile!;
  const analysis = analyzeTilePlacement(state, lastTile);
  
  // Get all tiles to add (including any unincorporated adjacent tiles)
  const tilesToAdd = [lastTile, ...analysis.adjacentUnincorporated];
  
  // Update board
  const newBoard = new Map(state.board);
  for (const tileId of tilesToAdd) {
    const tile = newBoard.get(tileId)!;
    newBoard.set(tileId, { ...tile, chain: chainName });
  }
  newState.board = newBoard;

  // Update chain
  const newChains = { ...state.chains };
  const existingTiles = newChains[chainName].tiles;
  const allTiles = [...existingTiles, ...tilesToAdd];
  newChains[chainName] = {
    ...newChains[chainName],
    tiles: allTiles,
    isSafe: allTiles.length >= SAFE_CHAIN_SIZE,
  };
  newState.chains = newChains;

  // Move to buy stock phase
  newState.phase = 'buy_stock';

  return newState;
};

// Buy stocks
export const buyStocks = (
  state: GameState,
  purchases: { chain: ChainName; quantity: number }[]
): GameState => {
  const newState = { ...state };
  const currentPlayer = { ...newState.players[newState.currentPlayerIndex] };
  
  let totalCost = 0;
  const newStocks = { ...currentPlayer.stocks };
  const newStockBank = { ...state.stockBank };

  for (const purchase of purchases) {
    const price = getStockPrice(purchase.chain, state.chains[purchase.chain].tiles.length);
    totalCost += price * purchase.quantity;
    newStocks[purchase.chain] += purchase.quantity;
    newStockBank[purchase.chain] -= purchase.quantity;
  }

  currentPlayer.cash -= totalCost;
  currentPlayer.stocks = newStocks;
  newState.stockBank = newStockBank;

  newState.players = [...newState.players];
  newState.players[newState.currentPlayerIndex] = currentPlayer;

  // Add to game log
  if (purchases.length > 0) {
    const purchaseDetails = purchases
      .map(p => `${p.quantity} ${CHAINS[p.chain].displayName}`)
      .join(', ');
    newState.gameLog = [
      ...state.gameLog,
      {
        timestamp: Date.now(),
        playerId: currentPlayer.id,
        playerName: currentPlayer.name,
        action: 'Bought stocks',
        details: purchaseDetails,
      },
    ];
  }

  return newState;
};

// Draw a tile
export const drawTile = (state: GameState): GameState => {
  if (state.tileBag.length === 0) return state;

  const newState = { ...state };
  const newTileBag = [...state.tileBag];
  const drawnTile = newTileBag.pop()!;

  const currentPlayer = { ...newState.players[newState.currentPlayerIndex] };
  currentPlayer.tiles = [...currentPlayer.tiles, drawnTile];

  newState.players = [...newState.players];
  newState.players[newState.currentPlayerIndex] = currentPlayer;
  newState.tileBag = newTileBag;

  return newState;
};

// End turn and advance to next player
export const endTurn = (state: GameState): GameState => {
  const newState = drawTile(state);
  newState.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  newState.phase = 'place_tile';
  newState.stocksPurchasedThisTurn = 0;
  newState.lastPlacedTile = null;
  
  return newState;
};

// Check if game should end
export const checkGameEnd = (state: GameState): boolean => {
  const activeChains = Object.values(state.chains).filter(c => c.isActive);
  
  // Condition 1: All active chains are safe
  if (activeChains.length > 0 && activeChains.every(c => c.isSafe)) {
    return true;
  }

  // Condition 2: Any chain has 41+ tiles
  if (activeChains.some(c => c.tiles.length >= END_GAME_CHAIN_SIZE)) {
    return true;
  }

  return false;
};

// Calculate final scores
export const calculateFinalScores = (state: GameState): PlayerState[] => {
  const players = state.players.map(p => ({ ...p }));

  // Pay out bonuses for each active chain
  for (const chain of Object.values(state.chains)) {
    if (!chain.isActive) continue;

    const { majority, minority } = getStockholderRankings(players, chain.name);
    const bonuses = getBonuses(chain.name, chain.tiles.length);

    if (majority.length > 0) {
      if (minority.length === 0) {
        // Majority holders split both bonuses
        const totalBonus = bonuses.majority + bonuses.minority;
        const perPlayer = Math.floor(totalBonus / majority.length);
        for (const player of majority) {
          const p = players.find(pl => pl.id === player.id)!;
          p.cash += perPlayer;
        }
      } else {
        // Normal distribution
        const majorityBonus = Math.floor(bonuses.majority / majority.length);
        const minorityBonus = Math.floor(bonuses.minority / minority.length);
        
        for (const player of majority) {
          const p = players.find(pl => pl.id === player.id)!;
          p.cash += majorityBonus;
        }
        for (const player of minority) {
          const p = players.find(pl => pl.id === player.id)!;
          p.cash += minorityBonus;
        }
      }
    }

    // Sell all remaining shares
    const price = getStockPrice(chain.name, chain.tiles.length);
    for (const player of players) {
      player.cash += player.stocks[chain.name] * price;
      player.stocks[chain.name] = 0;
    }
  }

  return players.sort((a, b) => b.cash - a.cash);
};

// Get player's net worth
export const getPlayerNetWorth = (player: PlayerState, chains: Record<ChainName, ChainState>): number => {
  let total = player.cash;
  for (const [chainName, quantity] of Object.entries(player.stocks)) {
    if (quantity > 0) {
      const chain = chains[chainName as ChainName];
      if (chain.isActive) {
        total += getStockPrice(chainName as ChainName, chain.tiles.length) * quantity;
      }
    }
  }
  return total;
};

// Get available chains for founding
export const getAvailableChainsForFoundation = (state: GameState): ChainName[] => {
  return (Object.keys(state.chains) as ChainName[]).filter(
    name => !state.chains[name].isActive
  );
};

// Check if player has any playable tiles
export const hasPlayableTiles = (state: GameState, playerIndex: number): boolean => {
  const player = state.players[playerIndex];
  return player.tiles.some(tileId => {
    const analysis = analyzeTilePlacement(state, tileId);
    return analysis.valid;
  });
};
