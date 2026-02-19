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
  ChainInfo,
  CustomRules,
  DEFAULT_RULES,
  ELIGIBLE_CHAINS_5,
  ELIGIBLE_CHAINS_6,
  ELIGIBLE_CHAINS_7,
} from '@/types/game';

const ALL_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// Generate all tile IDs for a given board size (default 9x12)
export const generateAllTiles = (rows: number = 9, colsCount: number = 12): TileId[] => {
  const tiles: TileId[] = [];
  const cols = ALL_COLS.slice(0, colsCount);
  for (let row = 1; row <= rows; row++) {
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

// Get adjacent tiles, respecting board boundaries (default 9 rows, 12 cols)
export const getAdjacentTiles = (
  tileId: TileId,
  boardRows: number = 9,
  boardCols: string[] | number = 12
): TileId[] => {
  const { row, col } = parseTileId(tileId);
  const cols = typeof boardCols === 'number' ? ALL_COLS.slice(0, boardCols) : boardCols;
  const colIndex = cols.indexOf(col);
  const adjacent: TileId[] = [];

  if (row > 1) adjacent.push(`${row - 1}${col}` as TileId);
  if (row < boardRows) adjacent.push(`${row + 1}${col}` as TileId);
  if (colIndex > 0) adjacent.push(`${row}${cols[colIndex - 1]}` as TileId);
  if (colIndex < cols.length - 1) adjacent.push(`${row}${cols[colIndex + 1]}` as TileId);

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

// Get majority and minority bonuses based on tier
// standard: 10x majority / 5x minority
// aggressive: 15x majority / 5x minority
// flat: same pool as standard (10+5=15x), distributed equally by callers
export const getBonuses = (
  chainName: ChainName,
  size: number,
  bonusTier: 'standard' | 'flat' | 'aggressive' = 'standard'
): { majority: number; minority: number } => {
  const price = getStockPrice(chainName, size);
  const majorityMult = bonusTier === 'aggressive' ? 15 : 10;
  return {
    majority: price * majorityMult,
    minority: price * 5,
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
export const initializeGame = (playerNames: string[], rules: CustomRules = DEFAULT_RULES): GameState => {
  if (playerNames.length !== 4) {
    throw new Error('Game requires exactly 4 players');
  }

  // Derive board dimensions from rules (Story 7)
  const boardRows = rules.boardSizeEnabled && rules.boardSize === '6x10' ? 6 : 9;
  const colsCount = rules.boardSizeEnabled && rules.boardSize === '6x10' ? 10 : 12;
  const boardCols = ALL_COLS.slice(0, colsCount);

  // Derive eligible chains from rules (Story 8)
  const maxChainsNum = rules.chainFoundingEnabled ? parseInt(rules.maxChains) : 7;
  const eligibleChains: ChainName[] =
    maxChainsNum === 5 ? ELIGIBLE_CHAINS_5 :
    maxChainsNum === 6 ? ELIGIBLE_CHAINS_6 :
    ELIGIBLE_CHAINS_7;

  // Derive bonus tier from rules (Story 6)
  const bonusTier = (rules.bonusTierEnabled
    ? rules.bonusTier
    : 'standard') as 'standard' | 'flat' | 'aggressive';

  // Initialize tile bag
  let tileBag = shuffle(generateAllTiles(boardRows, colsCount));

  // Initialize board
  const board = new Map<TileId, TileState>();
  for (const tileId of generateAllTiles(boardRows, colsCount)) {
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
    roundNumber: 0,
    rulesSnapshot: null,
    turnDeadlineEpoch: null,
    safeChainSize: SAFE_CHAIN_SIZE,
    bonusTier,
    boardRows,
    boardCols,
    maxChains: maxChainsNum,
    eligibleChains,
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
  const boardRows = state.boardRows || 9;
  const boardCols: string[] | number = state.boardCols?.length ? state.boardCols : 12;
  const adjacent = getAdjacentTiles(tileId, boardRows, boardCols);
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

  // Check if this would found a chain when no eligible chains are available
  if (chainArray.length === 0 && adjacentUnincorporated.length > 0) {
    const availableChains = getAvailableChainsForFoundation(state);
    if (availableChains.length === 0) {
      return {
        valid: false,
        reason: 'Cannot create a new hotel chain — all eligible chains are already active',
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
  const safeSize = state.safeChainSize;
  newChains[chainName] = {
    ...newChains[chainName],
    tiles: tilesToAdd,
    isActive: true,
    isSafe: safeSize !== null && tilesToAdd.length >= safeSize,
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
  const growSafeSize = state.safeChainSize;
  newChains[chainName] = {
    ...newChains[chainName],
    tiles: allTiles,
    isSafe: growSafeSize !== null && allTiles.length >= growSafeSize,
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

// Discard a tile and draw a new one
export const discardTile = (state: GameState, tileId: TileId): GameState => {
  const playerIndex = state.currentPlayerIndex;
  const currentPlayer = state.players[playerIndex];

  // Validate tile is in player's hand
  if (!currentPlayer.tiles.includes(tileId)) {
    return state;
  }

  // Remove tile from player's hand
  const updatedTiles = currentPlayer.tiles.filter(t => t !== tileId);

  // Add tile back to tile bag (at a random position to shuffle)
  const newTileBag = [...state.tileBag];
  const randomIndex = Math.floor(Math.random() * (newTileBag.length + 1));
  newTileBag.splice(randomIndex, 0, tileId);

  // Draw new tile from bag
  if (newTileBag.length === 0) {
    // Edge case: bag is empty (shouldn't happen in normal game)
    return { ...state, players: [...state.players], tileBag: newTileBag };
  }

  const drawnTile = newTileBag.pop()!;
  const finalTiles = [...updatedTiles, drawnTile];

  // Update game state
  const newPlayers = [...state.players];
  newPlayers[playerIndex] = {
    ...currentPlayer,
    tiles: finalTiles,
  };

  return {
    ...state,
    players: newPlayers,
    tileBag: newTileBag,
  };
};

// End turn and advance to next player
export const endTurn = (state: GameState): GameState => {
  const newState = drawTile(state);
  const nextPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  newState.currentPlayerIndex = nextPlayerIndex;
  newState.roundNumber = nextPlayerIndex === 0 ? state.roundNumber + 1 : state.roundNumber;
  newState.phase = 'place_tile';
  newState.stocksPurchasedThisTurn = 0;
  newState.lastPlacedTile = null;

  return newState;
};

// Check if game should end
// Game ends ONLY when any chain reaches 41+ tiles
export const checkGameEnd = (state: GameState): boolean => {
  const activeChains = Object.values(state.chains).filter(c => c.isActive);
  
  // ONLY condition: Any chain has 41+ tiles
  if (activeChains.some(c => c.tiles.length >= END_GAME_CHAIN_SIZE)) {
    return true;
  }

  return false;
};

// Calculate final scores
export const calculateFinalScores = (state: GameState): PlayerState[] => {
  const players = state.players.map(p => ({ ...p }));
  const bonusTier = state.bonusTier ?? 'standard';

  // Pay out bonuses for each active chain
  for (const chain of Object.values(state.chains)) {
    if (!chain.isActive) continue;

    const bonuses = getBonuses(chain.name, chain.tiles.length, bonusTier);

    if (bonusTier === 'flat') {
      // Flat: split combined pool equally among all stockholders
      const allHolders = players.filter(p => p.stocks[chain.name] > 0);
      if (allHolders.length > 0) {
        const flatPool = bonuses.majority + bonuses.minority;
        const perPlayer = Math.floor(flatPool / allHolders.length);
        for (const holder of allHolders) {
          const p = players.find(pl => pl.id === holder.id)!;
          p.cash += perPlayer;
        }
      }
    } else {
      const { majority, minority } = getStockholderRankings(players, chain.name);

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

// Get available chains for founding (filtered by eligible chains if set)
export const getAvailableChainsForFoundation = (state: GameState): ChainName[] => {
  const eligible: ChainName[] = state.eligibleChains?.length
    ? state.eligibleChains
    : (Object.keys(state.chains) as ChainName[]);
  return eligible.filter(name => !state.chains[name].isActive);
};

// Check if player has any playable tiles
export const hasPlayableTiles = (state: GameState, playerIndex: number): boolean => {
  const player = state.players[playerIndex];
  return player.tiles.some(tileId => {
    const analysis = analyzeTilePlacement(state, tileId);
    return analysis.valid;
  });
};
