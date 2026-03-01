import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

// Allowed CORS origins — restrict to known deployment domains
const ALLOWED_ORIGINS = [
  'https://acquire-game.netlify.app',  // production
  'http://localhost:5173',             // local dev
  'http://localhost:4173',             // local preview
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

// Types (duplicated from frontend since we can't import from src)
type ChainName = 'sackson' | 'tower' | 'worldwide' | 'american' | 'festival' | 'continental' | 'imperial';
type TileId = string;

// Mirror of src/types/game.ts CustomRules — keep in sync (founderFreeStock intentionally excluded)
interface CustomRules {
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

const DEFAULT_RULES: CustomRules = {
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

interface MergerStockDecision {
  sell: number;
  trade: number;
  keep: number;
}

interface GameActionRequest {
  action: 'start_game' | 'toggle_ready' | 'place_tile' | 'found_chain' | 'choose_merger_survivor' |
          'pay_merger_bonuses' | 'merger_stock_choice' | 'buy_stocks' | 'skip_buy' |
          'discard_tile' | 'end_game_vote' | 'new_game' | 'update_room_status' | 'auto_end_turn';
  roomId: string;
  payload?: any;
}

// Chain info for game logic
const CHAINS: Record<ChainName, { displayName: string; tier: 'budget' | 'midrange' | 'premium' }> = {
  sackson: { displayName: 'Sackson', tier: 'budget' },
  tower: { displayName: 'Tower', tier: 'budget' },
  worldwide: { displayName: 'Worldwide', tier: 'midrange' },
  american: { displayName: 'American', tier: 'midrange' },
  festival: { displayName: 'Festival', tier: 'midrange' },
  continental: { displayName: 'Continental', tier: 'premium' },
  imperial: { displayName: 'Imperial', tier: 'premium' },
};

const END_GAME_CHAIN_SIZE = 41;
const CHAIN_SIZE_BRACKETS = [2, 3, 5, 10, 20, 30, 40, Infinity] as const;
const BASE_PRICES: Record<'budget' | 'midrange' | 'premium', number[]> = {
  budget: [200, 300, 400, 500, 600, 700, 800, 900],
  midrange: [300, 400, 500, 600, 700, 800, 900, 1000],
  premium: [400, 500, 600, 700, 800, 900, 1000, 1100],
};
const ALL_COLS_EF = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// Eligible chain sets for Chain Founding Rules
const ELIGIBLE_CHAINS_5_EF: ChainName[] = ['sackson', 'tower', 'worldwide', 'american', 'continental'];
const ELIGIBLE_CHAINS_6_EF: ChainName[] = ['sackson', 'tower', 'worldwide', 'american', 'continental', 'imperial'];
const ELIGIBLE_CHAINS_7_EF: ChainName[] = ['sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial'];

function getSafeChainSize(rules: CustomRules): number | null {
  if (!rules.chainSafetyEnabled) return 11;
  if (rules.chainSafetyThreshold === 'none') return null;
  return parseInt(rules.chainSafetyThreshold);
}

function getBoardDimensions(rules: CustomRules): { boardRows: number; boardColsCount: number } {
  const boardRows = rules.boardSizeEnabled && rules.boardSize === '6x10' ? 6 : 9;
  const boardColsCount = rules.boardSizeEnabled && rules.boardSize === '6x10' ? 10 : 12;
  return { boardRows, boardColsCount };
}

function getEligibleChains(rules: CustomRules): ChainName[] {
  if (!rules.chainFoundingEnabled) return ELIGIBLE_CHAINS_7_EF;
  const max = parseInt(rules.maxChains);
  return max === 5 ? ELIGIBLE_CHAINS_5_EF : max === 6 ? ELIGIBLE_CHAINS_6_EF : ELIGIBLE_CHAINS_7_EF;
}

function getBonusTier(rules: CustomRules): string {
  return rules.bonusTierEnabled ? rules.bonusTier : 'standard';
}

// Helper functions
function getStockPrice(chainName: ChainName, size: number): number {
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

function getBonuses(chainName: ChainName, size: number, bonusTier: string = 'standard'): { majority: number; minority: number } {
  const price = getStockPrice(chainName, size);
  const majorityMult = bonusTier === 'aggressive' ? 15 : 10;
  return {
    majority: price * majorityMult,
    minority: price * 5,
  };
}

function parseTileId(tileId: TileId): { row: number; col: string } {
  const match = tileId.match(/^(\d)([A-L])$/);
  if (!match) throw new Error(`Invalid tile ID: ${tileId}`);
  return { row: parseInt(match[1]), col: match[2] };
}

function getAdjacentTiles(tileId: TileId, boardRows: number = 9, boardColsCount: number = 12): TileId[] {
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

function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function generateAllTiles(boardRows: number = 9, boardColsCount: number = 12): TileId[] {
  const tiles: TileId[] = [];
  const cols = ALL_COLS_EF.slice(0, boardColsCount);
  for (let row = 1; row <= boardRows; row++) {
    for (const col of cols) {
      tiles.push(`${row}${col}`);
    }
  }
  return tiles;
}

function checkGameEnd(chains: Record<ChainName, any>): boolean {
  const activeChains = Object.values(chains).filter((c: any) => c.isActive);
  return activeChains.some((c: any) => c.tiles.length >= END_GAME_CHAIN_SIZE);
}

function getStockholderRankings(players: any[], chainName: ChainName): { majority: any[]; minority: any[] } {
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

function calculateFinalScores(players: any[], chains: Record<ChainName, any>, bonusTier: string = 'standard'): any[] {
  const scoredPlayers = players.map(p => ({ ...p }));

  for (const chain of Object.values(chains)) {
    if (!chain.isActive) continue;

    const bonuses = getBonuses(chain.name, chain.tiles.length, bonusTier);

    if (bonusTier === 'flat') {
      // Flat: split combined pool equally among all stockholders
      const allHolders = scoredPlayers.filter(p => p.stocks[chain.name] > 0);
      if (allHolders.length > 0) {
        const flatPool = bonuses.majority + bonuses.minority;
        const perPlayer = Math.floor(flatPool / allHolders.length);
        for (const holder of allHolders) {
          const p = scoredPlayers.find(pl => pl.id === holder.id)!;
          p.cash += perPlayer;
        }
      }
    } else {
      const { majority, minority } = getStockholderRankings(scoredPlayers, chain.name);

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

    const price = getStockPrice(chain.name, chain.tiles.length);
    for (const player of scoredPlayers) {
      player.cash += player.stocks[chain.name] * price;
      player.stocks[chain.name] = 0;
    }
  }

  return scoredPlayers.sort((a, b) => b.cash - a.cash);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Validate authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Create client with user's auth to validate token
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    
    if (userError || !userData?.user) {
      console.error('Auth error:', userError);
      return new Response(JSON.stringify({ error: 'Invalid token' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const userId = userData.user.id;
    console.log('Authenticated user:', userId);

    // Create service role client for database operations
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body: GameActionRequest = await req.json();
    const { action, roomId, payload } = body;

    console.log('Processing action:', action, 'for room:', roomId);

    // Verify player is in the room
    const { data: playerData, error: playerError } = await adminClient
      .from('game_players')
      .select('*')
      .eq('room_id', roomId)
      .eq('user_id', userId)
      .single();

    if (playerError || !playerData) {
      console.error('Player not found:', playerError);
      return new Response(JSON.stringify({ error: 'Player not in room' }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const myPlayerIndex = playerData.player_index;

    // Fetch current game state
    const { data: gameState, error: stateError } = await adminClient
      .from('game_states')
      .select('*')
      .eq('room_id', roomId)
      .single();

    // Fetch all players
    const { data: allPlayers, error: playersError } = await adminClient
      .from('game_players')
      .select('*')
      .eq('room_id', roomId)
      .order('player_index');

    if (playersError) {
      console.error('Players fetch error:', playersError);
      return new Response(JSON.stringify({ error: 'Failed to fetch players' }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Derive rule-based values from rules snapshot
    const globalRulesSnap: CustomRules = { ...DEFAULT_RULES, ...(gameState?.rules_snapshot as Partial<CustomRules> ?? {}) };
    const safeChainSize: number | null = getSafeChainSize(globalRulesSnap);
    const { boardRows: globalBoardRows, boardColsCount: globalBoardColsCount } = getBoardDimensions(globalRulesSnap);
    const globalEligibleChains: ChainName[] = getEligibleChains(globalRulesSnap);
    const globalBonusTier: string = getBonusTier(globalRulesSnap);

    // Handle different actions
    let result: { success: boolean; error?: string; data?: any } = { success: false };

    switch (action) {
      case 'toggle_ready': {
        // Toggle this player's ready state
        const newReadyState = !playerData.is_ready;

        await adminClient
          .from('game_players')
          .update({ is_ready: newReadyState })
          .eq('id', playerData.id);

        // If toggling to not-ready, just return
        if (!newReadyState) {
          result = { success: true, data: { gameStarted: false, isReady: false } };
          break;
        }

        // Check if all players are ready and room is full
        const { data: room } = await adminClient
          .from('game_rooms')
          .select('max_players, custom_rules')
          .eq('id', roomId)
          .single();

        // Re-fetch all players to get fresh ready states
        const { data: freshPlayers } = await adminClient
          .from('game_players')
          .select('*')
          .eq('room_id', roomId)
          .order('player_index');

        if (!room || !freshPlayers) {
          result = { success: true, data: { gameStarted: false, isReady: true } };
          break;
        }

        const allReady = freshPlayers.length === room.max_players &&
          freshPlayers.every(p => p.is_ready);

        if (!allReady) {
          result = { success: true, data: { gameStarted: false, isReady: true } };
          break;
        }

        // All players ready — start the game!
        console.log('All players ready, starting game for room:', roomId);

        // Resolve custom rules: merge room's custom_rules over DEFAULT_RULES
        const rules: CustomRules = { ...DEFAULT_RULES, ...(room.custom_rules as Partial<CustomRules> ?? {}) };

        // Board-size coupling: small board forces maxChains to 5 when chain founding is enabled
        if (rules.boardSize === '6x10' && rules.chainFoundingEnabled && rules.maxChains === '7') {
          rules.maxChains = '5';
        }

        // Derive starting parameters from rules
        const startingCash = parseInt(rules.startingCash);
        const startingTiles = parseInt(rules.startingTiles);
        const { boardRows: initBoardRows, boardColsCount: initBoardColsCount } = getBoardDimensions(rules);
        const initEligibleChains = getEligibleChains(rules);

        // Initialize tile bag
        let tileBag = shuffle(generateAllTiles(initBoardRows, initBoardColsCount));

        // Initialize board
        const board: Record<string, any> = {};
        for (const tileId of generateAllTiles(initBoardRows, initBoardColsCount)) {
          board[tileId] = { id: tileId, placed: false, chain: null };
        }

        // Conditionally place starting tile
        let startingTile: string | null = null;
        if (rules.startWithTileOnBoard) {
          startingTile = tileBag.pop()!;
          board[startingTile] = { id: startingTile, placed: true, chain: null };
        }

        // Initialize chains
        const chains: Record<ChainName, any> = {
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
          sackson: 25, tower: 25, worldwide: 25, american: 25,
          festival: 25, continental: 25, imperial: 25,
        };

        // Deal tiles to players and reset ready state
        for (const player of freshPlayers) {
          const playerTiles = tileBag.splice(0, startingTiles);
          await adminClient
            .from('game_players')
            .update({
              tiles: playerTiles,
              cash: startingCash,
              stocks: { sackson: 0, tower: 0, worldwide: 0, american: 0, festival: 0, continental: 0, imperial: 0 },
              is_ready: false,
            })
            .eq('id', player.id);
        }

        // Build game log entry
        const gameLogEntry = {
          timestamp: Date.now(),
          playerId: 'system',
          playerName: 'System',
          action: 'Game started',
          details: startingTile ? `Starting tile ${startingTile} placed on board` : 'Board starts empty',
        };

        // Compute turn deadline for the first turn
        const firstTurnDeadline: number | null =
          rules.turnTimerEnabled && !rules.disableTimerFirstRounds
            ? Math.floor(Date.now() / 1000) + parseInt(rules.turnTimer)
            : null;

        // Create game state with rules_snapshot
        const { error: insertError } = await adminClient
          .from('game_states')
          .insert({
            room_id: roomId,
            current_player_index: 0,
            phase: 'place_tile',
            board,
            chains,
            stock_bank: stockBank,
            tile_bag: tileBag,
            last_placed_tile: startingTile,
            rules_snapshot: rules as unknown as any,
            game_log: [gameLogEntry],
            round_number: 0,
            turn_deadline_epoch: firstTurnDeadline,
          });

        if (insertError) {
          console.error('Insert error:', insertError);
          return new Response(JSON.stringify({ error: 'Failed to create game state' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Update room status
        await adminClient
          .from('game_rooms')
          .update({ status: 'playing' })
          .eq('id', roomId);

        result = { success: true, data: { gameStarted: true, isReady: true } };
        break;
      }

      case 'start_game': {
        // Kept for backward compatibility but toggle_ready is the preferred way
        if (myPlayerIndex !== 0) {
          return new Response(JSON.stringify({ error: 'Only host can start game' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const playerNames = allPlayers.map(p => p.player_name);

        // Initialize tile bag
        let tileBag = shuffle(generateAllTiles());

        // Initialize board
        const board: Record<string, any> = {};
        for (const tileId of generateAllTiles()) {
          board[tileId] = { id: tileId, placed: false, chain: null };
        }

        // Place starting tile
        const startingTile = tileBag.pop()!;
        board[startingTile] = { id: startingTile, placed: true, chain: null };

        // Initialize chains
        const chains: Record<ChainName, any> = {
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
          sackson: 25, tower: 25, worldwide: 25, american: 25,
          festival: 25, continental: 25, imperial: 25,
        };

        // Deal tiles to players and update their records
        for (const player of allPlayers) {
          const playerTiles = tileBag.splice(0, 6);
          await adminClient
            .from('game_players')
            .update({
              tiles: playerTiles,
              cash: 6000,
              stocks: { sackson: 0, tower: 0, worldwide: 0, american: 0, festival: 0, continental: 0, imperial: 0 }
            })
            .eq('id', player.id);
        }

        // Create game state
        const { error: insertError } = await adminClient
          .from('game_states')
          .insert({
            room_id: roomId,
            current_player_index: 0,
            phase: 'place_tile',
            board,
            chains,
            stock_bank: stockBank,
            tile_bag: tileBag,
            last_placed_tile: startingTile,
            game_log: [{
              timestamp: Date.now(),
              playerId: 'system',
              playerName: 'System',
              action: 'Game started',
              details: `Starting tile ${startingTile} placed on board`,
            }],
          });

        if (insertError) {
          console.error('Insert error:', insertError);
          return new Response(JSON.stringify({ error: 'Failed to create game state' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Update room status
        await adminClient
          .from('game_rooms')
          .update({ status: 'playing' })
          .eq('id', roomId);

        result = { success: true };
        break;
      }

      case 'place_tile': {
        if (!gameState) {
          return new Response(JSON.stringify({ error: 'Game not started' }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // Validate game phase
        if (gameState.phase !== 'place_tile') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Check if it's this player's turn
        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const tileId = payload?.tileId;
        if (!tileId) {
          return new Response(JSON.stringify({ error: 'Tile ID required' }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // Verify player has this tile
        if (!playerData.tiles?.includes(tileId)) {
          return new Response(JSON.stringify({ error: 'You do not have this tile' }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // Analyze placement
        const board = gameState.board;
        const chains = gameState.chains;
        const adjacent = getAdjacentTiles(tileId, globalBoardRows, globalBoardColsCount);
        const adjacentChains = new Set<ChainName>();
        const adjacentUnincorporated: TileId[] = [];

        for (const adjTile of adjacent) {
          const tile = board[adjTile];
          if (tile?.placed) {
            if (tile.chain) {
              adjacentChains.add(tile.chain as ChainName);
            } else {
              adjacentUnincorporated.push(adjTile);
            }
          }
        }

        const chainArray = Array.from(adjacentChains);

        // Check for invalid placement (safe chain merger)
        if (chainArray.length >= 2) {
          const safeChains = chainArray.filter(c => chains[c].isSafe);
          if (safeChains.length >= 2) {
            return new Response(JSON.stringify({ error: 'Cannot merge two or more safe chains' }), { 
              status: 400, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            });
          }
        }

        // Check if tile would found a chain when no eligible chains are available
        if (chainArray.length === 0 && adjacentUnincorporated.length > 0) {
          const availableEligible = globalEligibleChains.filter(c => !chains[c].isActive);
          if (availableEligible.length === 0) {
            return new Response(JSON.stringify({ error: 'Cannot create a new hotel chain — all eligible chains are already active' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }
        }

        // Update board
        const newBoard = { ...board };
        newBoard[tileId] = { id: tileId, placed: true, chain: null };

        // Remove tile from player's hand
        const newPlayerTiles = playerData.tiles.filter((t: string) => t !== tileId);

        // Determine action and new phase
        let newPhase = gameState.phase;
        let newChains = { ...chains };
        let pendingChainFoundation = null;
        let mergerAdjacentChains = null;
        let merger = null;

        const gameLog = [...gameState.game_log, {
          timestamp: Date.now(),
          playerId: `player-${myPlayerIndex}`,
          playerName: playerData.player_name,
          action: 'Placed tile',
          details: tileId,
        }];

        if (chainArray.length >= 2) {
          // Merger
          mergerAdjacentChains = chainArray;
          
          // Sort chains by size
          const sortedChains = chainArray
            .map(chain => ({ chain, size: chains[chain].tiles.length }))
            .sort((a, b) => b.size - a.size);
          
          const largestSize = sortedChains[0].size;
          const tiedForLargest = sortedChains.filter(c => c.size === largestSize);
          
          if (tiedForLargest.length > 1) {
            newPhase = 'merger_choose_survivor';
          } else {
            const survivingChain = sortedChains[0].chain;
            const defunctChains = sortedChains.slice(1).map(c => c.chain);
            merger = {
              survivingChain,
              defunctChains,
              currentDefunctChain: defunctChains[0],
              currentPlayerIndex: myPlayerIndex,
              bonusesPaid: false,
            };
            newPhase = 'merger_pay_bonuses';
          }
        } else if (chainArray.length === 1) {
          // Grow chain
          const chainToGrow = chainArray[0];
          const tilesToAdd = [tileId, ...adjacentUnincorporated];
          
          for (const tid of tilesToAdd) {
            newBoard[tid] = { ...newBoard[tid], chain: chainToGrow };
          }
          
          const existingTiles = chains[chainToGrow].tiles;
          const allTiles = [...existingTiles, ...tilesToAdd];
          newChains[chainToGrow] = {
            ...newChains[chainToGrow],
            tiles: allTiles,
            isSafe: safeChainSize !== null && allTiles.length >= safeChainSize,
          };
          
          gameLog.push({
            timestamp: Date.now(),
            playerId: `player-${myPlayerIndex}`,
            playerName: playerData.player_name,
            action: `Extended ${chainToGrow}`,
            details: `Chain now has ${allTiles.length} tiles`,
          });
          
          newPhase = 'buy_stock';
        } else if (adjacentUnincorporated.length > 0) {
          // Form new chain
          newPhase = 'found_chain';
          pendingChainFoundation = [tileId, ...adjacentUnincorporated];
        } else {
          // Place only
          newPhase = 'buy_stock';
        }

        // Check for game end
        if (checkGameEnd(newChains) && newPhase === 'buy_stock') {
          newPhase = 'game_over';
          const scoredPlayers = allPlayers.map(p => ({
            id: `player-${p.player_index}`,
            name: p.player_name,
            cash: p.cash,
            stocks: p.stocks,
          }));
          const winner = calculateFinalScores(scoredPlayers, newChains, globalBonusTier)[0].name;
          
          await adminClient
            .from('game_states')
            .update({
              board: newBoard,
              chains: newChains,
              phase: newPhase,
              last_placed_tile: tileId,
              pending_chain_foundation: pendingChainFoundation,
              merger,
              game_log: gameLog,
              winner,
            })
            .eq('room_id', roomId);
        } else {
          await adminClient
            .from('game_states')
            .update({
              board: newBoard,
              chains: newChains,
              phase: newPhase,
              last_placed_tile: tileId,
              pending_chain_foundation: pendingChainFoundation,
              merger,
              game_log: gameLog,
            })
            .eq('room_id', roomId);
        }

        // Update player tiles
        await adminClient
          .from('game_players')
          .update({ tiles: newPlayerTiles })
          .eq('id', playerData.id);

        result = { success: true, data: { phase: newPhase, mergerAdjacentChains } };
        break;
      }

      case 'found_chain': {
        if (!gameState) {
          return new Response(JSON.stringify({ error: 'Game not started' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'found_chain') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const chainName = payload?.chainName as ChainName;
        if (!chainName || !CHAINS[chainName]) {
          return new Response(JSON.stringify({ error: 'Invalid chain name' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const chains = gameState.chains;
        if (chains[chainName].isActive) {
          return new Response(JSON.stringify({ error: 'Chain already active' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (!globalEligibleChains.includes(chainName)) {
          return new Response(JSON.stringify({ error: 'Chain is not eligible for this game' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const tilesToAdd = gameState.pending_chain_foundation || [];
        
        // Update board
        const newBoard = { ...gameState.board };
        for (const tid of tilesToAdd) {
          newBoard[tid] = { ...newBoard[tid], chain: chainName };
        }

        // Update chain
        const newChains = { ...chains };
        newChains[chainName] = {
          ...newChains[chainName],
          tiles: tilesToAdd,
          isActive: true,
          isSafe: safeChainSize !== null && tilesToAdd.length >= safeChainSize,
        };

        // Give founding bonus
        const newStockBank = { ...gameState.stock_bank };
        let playerStocks = { ...playerData.stocks };
        
        if (newStockBank[chainName] > 0) {
          playerStocks[chainName] = (playerStocks[chainName] || 0) + 1;
          newStockBank[chainName]--;
        }

        const gameLog = [...gameState.game_log, {
          timestamp: Date.now(),
          playerId: `player-${myPlayerIndex}`,
          playerName: playerData.player_name,
          action: `Founded ${CHAINS[chainName].displayName}`,
          details: 'Received 1 bonus share',
        }];

        let newPhase = 'buy_stock';
        let winner = null;

        if (checkGameEnd(newChains)) {
          newPhase = 'game_over';
          const scoredPlayers = allPlayers.map(p => ({
            id: `player-${p.player_index}`,
            name: p.player_name,
            cash: p.player_index === myPlayerIndex ? playerData.cash : p.cash,
            stocks: p.player_index === myPlayerIndex ? playerStocks : p.stocks,
          }));
          winner = calculateFinalScores(scoredPlayers, newChains, globalBonusTier)[0].name;
        }

        await adminClient
          .from('game_states')
          .update({
            board: newBoard,
            chains: newChains,
            stock_bank: newStockBank,
            phase: newPhase,
            pending_chain_foundation: null,
            game_log: gameLog,
            winner,
          })
          .eq('room_id', roomId);

        await adminClient
          .from('game_players')
          .update({ stocks: playerStocks })
          .eq('id', playerData.id);

        result = { success: true };
        break;
      }

      case 'choose_merger_survivor': {
        if (!gameState) {
          return new Response(JSON.stringify({ error: 'Game not started' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'merger_choose_survivor') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const survivingChain = payload?.survivingChain as ChainName;
        if (!survivingChain || !CHAINS[survivingChain]) {
          return new Response(JSON.stringify({ error: 'Surviving chain required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Recompute adjacent chains server-side from the last placed tile (do not trust client payload)
        const lastTileForMerger = gameState.last_placed_tile;
        if (!lastTileForMerger) {
          return new Response(JSON.stringify({ error: 'No last placed tile found' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        const adjTilesForMerger = getAdjacentTiles(lastTileForMerger, globalBoardRows, globalBoardColsCount);
        const serverAdjacentChains = [...new Set(
          adjTilesForMerger
            .filter(tid => gameState.board[tid]?.placed && gameState.board[tid]?.chain)
            .map(tid => gameState.board[tid].chain as ChainName)
        )];

        if (!serverAdjacentChains.includes(survivingChain)) {
          return new Response(JSON.stringify({ error: 'Invalid surviving chain selection' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const defunctChains = serverAdjacentChains.filter(c => c !== survivingChain)
          .sort((a, b) => gameState.chains[b].tiles.length - gameState.chains[a].tiles.length);

        const merger = {
          survivingChain,
          defunctChains,
          currentDefunctChain: defunctChains[0],
          currentPlayerIndex: myPlayerIndex,
          bonusesPaid: false,
        };

        await adminClient
          .from('game_states')
          .update({
            merger,
            phase: 'merger_pay_bonuses',
          })
          .eq('room_id', roomId);

        result = { success: true };
        break;
      }

      case 'pay_merger_bonuses': {
        if (!gameState || !gameState.merger) {
          return new Response(JSON.stringify({ error: 'No merger in progress' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'merger_pay_bonuses') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Only current player can trigger bonus payment
        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), { 
            status: 403, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        const merger = gameState.merger;
        const defunctChain = merger.currentDefunctChain as ChainName;
        const chains = gameState.chains;
        const chainSize = chains[defunctChain].tiles.length;
        const bonuses = getBonuses(defunctChain, chainSize, globalBonusTier);

        // Get stockholder rankings
        const playerStates = allPlayers.map(p => ({
          id: `player-${p.player_index}`,
          name: p.player_name,
          cash: p.cash,
          stocks: p.stocks,
        }));

        const gameLog = [...gameState.game_log];

        // Pay bonuses (flat tier splits pool equally among all stockholders)
        if (globalBonusTier === 'flat') {
          const allHolders = playerStates.filter(p => p.stocks[defunctChain] > 0);
          if (allHolders.length > 0) {
            const flatPool = bonuses.majority + bonuses.minority;
            const perPlayer = Math.floor(flatPool / allHolders.length);
            for (const holder of allHolders) {
              const playerIndex = parseInt(holder.id.split('-')[1]);
              const dbPlayer = allPlayers.find(p => p.player_index === playerIndex);
              if (dbPlayer) {
                await adminClient
                  .from('game_players')
                  .update({ cash: dbPlayer.cash + perPlayer })
                  .eq('id', dbPlayer.id);
              }
            }
            gameLog.push({
              timestamp: Date.now(),
              playerId: 'system',
              playerName: 'System',
              action: `${CHAINS[defunctChain].displayName} bonuses paid (flat)`,
              details: `${allHolders.map(p => p.name).join(', ')} each receive $${perPlayer}`,
            });
          }
        } else {
          const { majority, minority } = getStockholderRankings(playerStates, defunctChain);

          if (majority.length > 0) {
            if (minority.length === 0) {
              const totalBonus = bonuses.majority + bonuses.minority;
              const perPlayer = Math.floor(totalBonus / majority.length);

              for (const player of majority) {
                const playerIndex = parseInt(player.id.split('-')[1]);
                const dbPlayer = allPlayers.find(p => p.player_index === playerIndex);
                if (dbPlayer) {
                  await adminClient
                    .from('game_players')
                    .update({ cash: dbPlayer.cash + perPlayer })
                    .eq('id', dbPlayer.id);
                }
              }

              gameLog.push({
                timestamp: Date.now(),
                playerId: 'system',
                playerName: 'System',
                action: `${CHAINS[defunctChain].displayName} bonuses paid`,
                details: majority.length > 1
                  ? `${majority.map(p => p.name).join(', ')} split $${totalBonus}`
                  : `${majority[0].name} receives $${totalBonus}`,
              });
            } else {
              const majorityBonus = Math.floor(bonuses.majority / majority.length);
              const minorityBonus = Math.floor(bonuses.minority / minority.length);

              for (const player of majority) {
                const playerIndex = parseInt(player.id.split('-')[1]);
                const dbPlayer = allPlayers.find(p => p.player_index === playerIndex);
                if (dbPlayer) {
                  await adminClient
                    .from('game_players')
                    .update({ cash: dbPlayer.cash + majorityBonus })
                    .eq('id', dbPlayer.id);
                }
              }

              for (const player of minority) {
                const playerIndex = parseInt(player.id.split('-')[1]);
                const dbPlayer = allPlayers.find(p => p.player_index === playerIndex);
                if (dbPlayer) {
                  await adminClient
                    .from('game_players')
                    .update({ cash: dbPlayer.cash + minorityBonus })
                    .eq('id', dbPlayer.id);
                }
              }

              gameLog.push({
                timestamp: Date.now(),
                playerId: 'system',
                playerName: 'System',
                action: `${CHAINS[defunctChain].displayName} bonuses paid`,
                details: `Majority: ${majority.map(p => p.name).join(', ')} ($${majorityBonus} each), Minority: ${minority.map(p => p.name).join(', ')} ($${minorityBonus} each)`,
              });
            }
          }
        }

        // Check if any players have stock in defunct chain
        const playersWithShares = allPlayers.filter(p => p.stocks[defunctChain] > 0);
        
        let newPhase = 'merger_handle_stock';
        const newMerger = { ...merger, bonusesPaid: true };

        if (playersWithShares.length === 0) {
          // No one has shares, move to next defunct chain or complete
          const currentDefunctIndex = merger.defunctChains.indexOf(defunctChain);
          if (currentDefunctIndex < merger.defunctChains.length - 1) {
            newMerger.currentDefunctChain = merger.defunctChains[currentDefunctIndex + 1];
            newMerger.bonusesPaid = false;
            newPhase = 'merger_pay_bonuses';
          } else {
            // Complete merger
            newPhase = await completeMergerInDb(adminClient, roomId, gameState, allPlayers, gameLog);
            await adminClient
              .from('game_states')
              .update({ phase: newPhase, merger: null, game_log: gameLog })
              .eq('room_id', roomId);
            result = { success: true };
            break;
          }
        } else {
          // Find first player with shares starting from current player
          let startIdx = myPlayerIndex;
          for (let i = 0; i < allPlayers.length; i++) {
            const idx = (startIdx + i) % allPlayers.length;
            if (allPlayers[idx].stocks[defunctChain] > 0) {
              newMerger.currentPlayerIndex = idx;
              break;
            }
          }
        }

        await adminClient
          .from('game_states')
          .update({
            merger: newMerger,
            phase: newPhase,
            game_log: gameLog,
          })
          .eq('room_id', roomId);

        result = { success: true };
        break;
      }

      case 'merger_stock_choice': {
        if (!gameState || !gameState.merger) {
          return new Response(JSON.stringify({ error: 'No merger in progress' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'merger_handle_stock') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const merger = gameState.merger;
        if (merger.currentPlayerIndex !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn in merger' }), { 
            status: 403, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        const decision = payload?.decision as MergerStockDecision;
        if (!decision) {
          return new Response(JSON.stringify({ error: 'Decision required' }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        const defunctChain = merger.currentDefunctChain as ChainName;
        const survivingChain = merger.survivingChain as ChainName;
        const currentShares = playerData.stocks[defunctChain];

        // Validate decision
        if (decision.sell + decision.trade + decision.keep !== currentShares) {
          return new Response(JSON.stringify({ error: 'Shares do not add up' }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        if (decision.trade % 2 !== 0) {
          return new Response(JSON.stringify({ error: 'Trade must be even (2:1 ratio)' }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        // Process decision
        const salePrice = getStockPrice(defunctChain, gameState.chains[defunctChain].tiles.length);
        let newCash = playerData.cash + (decision.sell * salePrice);
        
        const sharesToReceive = decision.trade / 2;
        const availableShares = Math.min(sharesToReceive, gameState.stock_bank[survivingChain]);
        
        const newPlayerStocks = { ...playerData.stocks };
        newPlayerStocks[defunctChain] -= (decision.sell + decision.trade);
        newPlayerStocks[survivingChain] = (newPlayerStocks[survivingChain] || 0) + availableShares;

        const newStockBank = { ...gameState.stock_bank };
        newStockBank[defunctChain] += decision.sell + decision.trade;
        newStockBank[survivingChain] -= availableShares;

        await adminClient
          .from('game_players')
          .update({ cash: newCash, stocks: newPlayerStocks })
          .eq('id', playerData.id);

        const gameLog = [...gameState.game_log];
        const actions = [];
        if (decision.sell > 0) actions.push(`sold ${decision.sell} for $${decision.sell * salePrice}`);
        if (decision.trade > 0) actions.push(`traded ${decision.trade} for ${availableShares} ${CHAINS[survivingChain].displayName}`);
        if (decision.keep > 0) actions.push(`kept ${decision.keep}`);

        gameLog.push({
          timestamp: Date.now(),
          playerId: `player-${myPlayerIndex}`,
          playerName: playerData.player_name,
          action: `${CHAINS[defunctChain].displayName} stock decision`,
          details: actions.join(', '),
        });

        // Refetch players to get updated stock counts
        const { data: updatedPlayers } = await adminClient
          .from('game_players')
          .select('*')
          .eq('room_id', roomId)
          .order('player_index');

        // Find next player with shares
        const startPlayerIndex = gameState.current_player_index;
        let nextIndex = (myPlayerIndex + 1) % allPlayers.length;
        let foundNext = false;

        while (nextIndex !== startPlayerIndex) {
          const player = updatedPlayers?.find(p => p.player_index === nextIndex);
          if (player && player.stocks[defunctChain] > 0) {
            foundNext = true;
            break;
          }
          nextIndex = (nextIndex + 1) % allPlayers.length;
        }

        // Check if start player still has shares
        if (!foundNext) {
          const startPlayer = updatedPlayers?.find(p => p.player_index === startPlayerIndex);
          if (startPlayer && startPlayer.stocks[defunctChain] > 0 && startPlayerIndex !== myPlayerIndex) {
            foundNext = true;
            nextIndex = startPlayerIndex;
          }
        }

        let newPhase = 'merger_handle_stock';
        const newMerger = { ...merger };

        if (!foundNext) {
          // Move to next defunct chain or complete merger
          const currentDefunctIndex = merger.defunctChains.indexOf(defunctChain);
          if (currentDefunctIndex < merger.defunctChains.length - 1) {
            newMerger.currentDefunctChain = merger.defunctChains[currentDefunctIndex + 1];
            newMerger.currentPlayerIndex = startPlayerIndex;
            newMerger.bonusesPaid = false;
            newPhase = 'merger_pay_bonuses';
          } else {
            // Complete merger
            newPhase = await completeMergerInDb(adminClient, roomId, gameState, allPlayers, gameLog);
            await adminClient
              .from('game_states')
              .update({ 
                phase: newPhase, 
                merger: null, 
                stock_bank: newStockBank,
                game_log: gameLog 
              })
              .eq('room_id', roomId);
            result = { success: true };
            break;
          }
        } else {
          newMerger.currentPlayerIndex = nextIndex;
        }

        await adminClient
          .from('game_states')
          .update({
            merger: newMerger,
            phase: newPhase,
            stock_bank: newStockBank,
            game_log: gameLog,
          })
          .eq('room_id', roomId);

        result = { success: true };
        break;
      }

      case 'buy_stocks': {
        if (!gameState || gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'buy_stock') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const purchases = payload?.purchases as { chain: ChainName; quantity: number }[];

        // Validate total quantity does not exceed 3 per turn
        const totalQuantity = (purchases || []).reduce((sum, p) => sum + p.quantity, 0);
        if (totalQuantity > 3) {
          return new Response(JSON.stringify({ error: 'Cannot buy more than 3 stocks per turn' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        let totalCost = 0;
        const newPlayerStocks = { ...playerData.stocks };
        const newStockBank = { ...gameState.stock_bank };

        for (const purchase of (purchases || [])) {
          // Validate chain is active
          if (!gameState.chains[purchase.chain]?.isActive) {
            return new Response(JSON.stringify({ error: `Cannot buy stock in inactive chain: ${purchase.chain}` }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          // Validate stock bank has sufficient shares
          if (gameState.stock_bank[purchase.chain] < purchase.quantity) {
            return new Response(JSON.stringify({ error: `Insufficient ${purchase.chain} shares in bank (available: ${gameState.stock_bank[purchase.chain]})` }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
          }

          const price = getStockPrice(purchase.chain, gameState.chains[purchase.chain].tiles.length);
          totalCost += price * purchase.quantity;
          newPlayerStocks[purchase.chain] = (newPlayerStocks[purchase.chain] || 0) + purchase.quantity;
          newStockBank[purchase.chain] -= purchase.quantity;
        }

        if (totalCost > playerData.cash) {
          return new Response(JSON.stringify({ error: 'Insufficient funds' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const newCash = playerData.cash - totalCost;

        await adminClient
          .from('game_players')
          .update({ cash: newCash, stocks: newPlayerStocks })
          .eq('id', playerData.id);

        const gameLog = [...gameState.game_log];
        if (purchases && purchases.length > 0) {
          gameLog.push({
            timestamp: Date.now(),
            playerId: `player-${myPlayerIndex}`,
            playerName: playerData.player_name,
            action: 'Bought stocks',
            details: purchases.map(p => `${p.quantity} ${CHAINS[p.chain].displayName}`).join(', '),
          });
        }

        // End turn: draw tile, advance player
        const tileBag = [...gameState.tile_bag];
        const drawnTile = tileBag.pop();
        
        if (drawnTile) {
          const newPlayerTiles = [...playerData.tiles, drawnTile];
          await adminClient
            .from('game_players')
            .update({ tiles: newPlayerTiles })
            .eq('id', playerData.id);
        }

        const nextPlayerIndex = (myPlayerIndex + 1) % allPlayers.length;
        const currentRoundNumber = gameState.round_number ?? 0;
        const newRoundNumber = currentRoundNumber + (nextPlayerIndex === 0 ? 1 : 0);
        const rulesSnap: CustomRules = { ...DEFAULT_RULES, ...(gameState.rules_snapshot as Partial<CustomRules> ?? {}) };
        const newDeadline: number | null =
          rulesSnap.turnTimerEnabled && !(rulesSnap.disableTimerFirstRounds && newRoundNumber < 2)
            ? Math.floor(Date.now() / 1000) + parseInt(rulesSnap.turnTimer)
            : null;

        let newPhase = 'place_tile';
        let winner = null;

        if (checkGameEnd(gameState.chains)) {
          newPhase = 'game_over';
          const scoredPlayers = allPlayers.map(p => ({
            id: `player-${p.player_index}`,
            name: p.player_name,
            cash: p.player_index === myPlayerIndex ? newCash : p.cash,
            stocks: p.player_index === myPlayerIndex ? newPlayerStocks : p.stocks,
          }));
          winner = calculateFinalScores(scoredPlayers, gameState.chains, globalBonusTier)[0].name;
        }

        await adminClient
          .from('game_states')
          .update({
            current_player_index: nextPlayerIndex,
            phase: newPhase,
            stock_bank: newStockBank,
            tile_bag: tileBag,
            stocks_purchased_this_turn: 0,
            last_placed_tile: null,
            game_log: gameLog,
            winner,
            round_number: newRoundNumber,
            turn_deadline_epoch: newPhase === 'game_over' ? null : newDeadline,
          })
          .eq('room_id', roomId);

        result = { success: true };
        break;
      }

      case 'skip_buy': {
        if (!gameState || gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'buy_stock') {
          return new Response(JSON.stringify({ error: 'Action not valid in current phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        // Draw tile
        const tileBag = [...gameState.tile_bag];
        const drawnTile = tileBag.pop();
        
        if (drawnTile) {
          const newPlayerTiles = [...playerData.tiles, drawnTile];
          await adminClient
            .from('game_players')
            .update({ tiles: newPlayerTiles })
            .eq('id', playerData.id);
        }

        const nextPlayerIndex = (myPlayerIndex + 1) % allPlayers.length;
        const skipCurrentRound = gameState.round_number ?? 0;
        const skipNewRound = skipCurrentRound + (nextPlayerIndex === 0 ? 1 : 0);
        const skipRulesSnap: CustomRules = { ...DEFAULT_RULES, ...(gameState.rules_snapshot as Partial<CustomRules> ?? {}) };
        const skipNewDeadline: number | null =
          skipRulesSnap.turnTimerEnabled && !(skipRulesSnap.disableTimerFirstRounds && skipNewRound < 2)
            ? Math.floor(Date.now() / 1000) + parseInt(skipRulesSnap.turnTimer)
            : null;

        let newPhase = 'place_tile';
        let winner = null;

        if (checkGameEnd(gameState.chains)) {
          newPhase = 'game_over';
          const scoredPlayers = allPlayers.map(p => ({
            id: `player-${p.player_index}`,
            name: p.player_name,
            cash: p.cash,
            stocks: p.stocks,
          }));
          winner = calculateFinalScores(scoredPlayers, gameState.chains, globalBonusTier)[0].name;
        }

        await adminClient
          .from('game_states')
          .update({
            current_player_index: nextPlayerIndex,
            phase: newPhase,
            tile_bag: tileBag,
            stocks_purchased_this_turn: 0,
            last_placed_tile: null,
            winner,
            round_number: skipNewRound,
            turn_deadline_epoch: newPhase === 'game_over' ? null : skipNewDeadline,
          })
          .eq('room_id', roomId);

        result = { success: true };
        break;
      }

      case 'discard_tile': {
        const { tileId } = payload as { tileId: string };

        if (!tileId) {
          return new Response(
            JSON.stringify({ success: false, error: 'Missing tileId' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!gameState) {
          return new Response(
            JSON.stringify({ success: false, error: 'Game not started' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Security: Verify the requesting user is the current player
        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(
            JSON.stringify({ success: false, error: 'Not your turn' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get current player
        const currentPlayer = allPlayers.find((p: any) => p.player_index === gameState.current_player_index);
        if (!currentPlayer) {
          return new Response(
            JSON.stringify({ success: false, error: 'Player not found' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Validate tile is in player's hand
        if (!currentPlayer.tiles.includes(tileId)) {
          return new Response(
            JSON.stringify({ success: false, error: 'Tile not in hand' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Remove tile from player's hand
        const updatedTiles = currentPlayer.tiles.filter((t: string) => t !== tileId);

        // Add tile back to bag at random position
        const tileBag = [...gameState.tile_bag];
        const randomIndex = Math.floor(Math.random() * (tileBag.length + 1));
        tileBag.splice(randomIndex, 0, tileId);

        // Draw new tile
        if (tileBag.length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'Tile bag is empty' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const drawnTile = tileBag.pop()!;
        const finalTiles = [...updatedTiles, drawnTile];

        // Update player tiles in database
        const { error: updatePlayerError } = await adminClient
          .from('game_players')
          .update({ tiles: finalTiles })
          .eq('room_id', roomId)
          .eq('player_index', gameState.current_player_index);

        if (updatePlayerError) throw updatePlayerError;

        // Update tile bag in game state
        const { error: updateStateError } = await adminClient
          .from('game_states')
          .update({ tile_bag: tileBag })
          .eq('room_id', roomId);

        if (updateStateError) throw updateStateError;

        result = { success: true };
        break;
      }

      case 'end_game_vote': {
        if (!gameState) {
          return new Response(JSON.stringify({ error: 'Game not started' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (!['place_tile', 'buy_stock'].includes(gameState.phase)) {
          return new Response(JSON.stringify({ error: 'Cannot vote to end game during an active action phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const vote = payload?.vote as boolean;
        const playerId = `player-${myPlayerIndex}`;
        const endGameVotes = gameState.end_game_votes || [];

        if (vote && !endGameVotes.includes(playerId)) {
          const newVotes = [...endGameVotes, playerId];
          const votesNeeded = Math.ceil(allPlayers.length / 2);

          let newPhase = gameState.phase;
          let winner = null;

          if (newVotes.length >= votesNeeded) {
            newPhase = 'game_over';
            const scoredPlayers = allPlayers.map(p => ({
              id: `player-${p.player_index}`,
              name: p.player_name,
              cash: p.cash,
              stocks: p.stocks,
            }));
            winner = calculateFinalScores(scoredPlayers, gameState.chains, globalBonusTier)[0].name;
          }

          await adminClient
            .from('game_states')
            .update({
              end_game_votes: newVotes,
              phase: newPhase,
              winner,
            })
            .eq('room_id', roomId);
        }

        result = { success: true };
        break;
      }

      case 'new_game': {
        // Only host can start new game
        if (myPlayerIndex !== 0) {
          return new Response(JSON.stringify({ error: 'Only host can start new game' }), { 
            status: 403, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        await adminClient
          .from('game_states')
          .delete()
          .eq('room_id', roomId);

        await adminClient
          .from('game_rooms')
          .update({ status: 'waiting' })
          .eq('id', roomId);

        result = { success: true };
        break;
      }

      case 'update_room_status': {
        // Security: Only host (player_index 0) can update room status
        if (myPlayerIndex !== 0) {
          return new Response(JSON.stringify({ error: 'Only host can update room status' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const VALID_ROOM_STATUSES = ['waiting', 'playing', 'finished'] as const;
        const newStatus = payload?.status;
        if (!newStatus || !(VALID_ROOM_STATUSES as readonly string[]).includes(newStatus)) {
          return new Response(JSON.stringify({ error: 'Invalid or missing status value' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        await adminClient
          .from('game_rooms')
          .update({ status: newStatus })
          .eq('id', roomId);
        result = { success: true };
        break;
      }

      case 'auto_end_turn': {
        if (!gameState) {
          return new Response(JSON.stringify({ error: 'Game not started' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        if (gameState.phase !== 'place_tile') {
          return new Response(JSON.stringify({ error: 'Not in place_tile phase' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const autoDeadline = gameState.turn_deadline_epoch;
        if (!autoDeadline || Math.floor(Date.now() / 1000) < autoDeadline) {
          return new Response(JSON.stringify({ error: 'Timer has not expired' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const autoRules: CustomRules = { ...DEFAULT_RULES, ...(gameState.rules_snapshot as Partial<CustomRules> ?? {}) };
        const autoSafeChainSize: number | null = getSafeChainSize(autoRules);
        const { boardRows: autoBoardRows, boardColsCount: autoBoardColsCount } = getBoardDimensions(autoRules);
        const autoEligibleChains: ChainName[] = getEligibleChains(autoRules);
        const autoBonusTier: string = getBonusTier(autoRules);
        const autoBoard = { ...gameState.board };
        const autoChains = { ...gameState.chains };
        let autoStockBank = { ...gameState.stock_bank };
        let autoTileBag = [...gameState.tile_bag];
        const autoPlayerTiles: string[] = playerData.tiles || [];

        const autoGameLog = [...gameState.game_log, {
          timestamp: Date.now(),
          playerId: `player-${myPlayerIndex}`,
          playerName: playerData.player_name,
          action: 'Turn auto-ended (timer expired)',
        }];

        // Find playable tiles (same validity checks as place_tile handler)
        const autoPlayableTiles = autoPlayerTiles.filter(tileId => {
          const adjTiles = getAdjacentTiles(tileId, autoBoardRows, autoBoardColsCount);
          const adjChainsSet = new Set<ChainName>();
          const adjUnincorpTiles: string[] = [];
          for (const a of adjTiles) {
            const t = autoBoard[a];
            if (t?.placed) {
              if (t.chain) adjChainsSet.add(t.chain as ChainName);
              else adjUnincorpTiles.push(a);
            }
          }
          const ca = Array.from(adjChainsSet);
          if (ca.length >= 2 && ca.filter(c => autoChains[c].isSafe).length >= 2) return false;
          if (ca.length === 0 && adjUnincorpTiles.length > 0 &&
              autoEligibleChains.filter(c => !autoChains[c].isActive).length === 0) return false;
          return true;
        });

        // Helper: compute next turn index, round number, and timer deadline
        const computeAutoNextTurn = (chains: Record<ChainName, any>) => {
          const npi = (myPlayerIndex + 1) % allPlayers.length;
          const curRound = gameState.round_number ?? 0;
          const nrn = curRound + (npi === 0 ? 1 : 0);
          const nd: number | null =
            autoRules.turnTimerEnabled && !(autoRules.disableTimerFirstRounds && nrn < 2)
              ? Math.floor(Date.now() / 1000) + parseInt(autoRules.turnTimer)
              : null;
          let phase = 'place_tile';
          let autoWinner: string | null = null;
          if (checkGameEnd(chains)) {
            phase = 'game_over';
            const scored = allPlayers.map(p => ({
              id: `player-${p.player_index}`,
              name: p.player_name,
              cash: p.cash,
              stocks: p.stocks,
            }));
            autoWinner = calculateFinalScores(scored, chains, autoBonusTier)[0].name;
          }
          return { nextPlayerIndex: npi, newRoundNumber: nrn, newDeadline: phase === 'game_over' ? null : nd, newPhase: phase, winner: autoWinner };
        };

        let autoNewPlayerTiles = [...autoPlayerTiles];

        if (autoPlayableTiles.length === 0) {
          // No playable tile: discard a random tile, draw a replacement, end turn
          const discardIdx = Math.floor(Math.random() * autoPlayerTiles.length);
          const tileToDiscard = autoPlayerTiles[discardIdx];
          const bagInsertPos = Math.floor(Math.random() * (autoTileBag.length + 1));
          autoTileBag.splice(bagInsertPos, 0, tileToDiscard);
          const replaceTile = autoTileBag.pop();
          autoNewPlayerTiles = autoPlayerTiles.filter(t => t !== tileToDiscard);
          if (replaceTile) autoNewPlayerTiles.push(replaceTile);

          await adminClient.from('game_players').update({ tiles: autoNewPlayerTiles }).eq('id', playerData.id);

          const { nextPlayerIndex, newRoundNumber, newDeadline, newPhase, winner } = computeAutoNextTurn(autoChains);
          await adminClient.from('game_states').update({
            current_player_index: nextPlayerIndex,
            phase: newPhase,
            tile_bag: autoTileBag,
            stocks_purchased_this_turn: 0,
            last_placed_tile: null,
            round_number: newRoundNumber,
            turn_deadline_epoch: newDeadline,
            game_log: autoGameLog,
            winner,
          }).eq('room_id', roomId);

          result = { success: true };
          break;
        }

        // Pick a random playable tile
        const tileToPlay = autoPlayableTiles[Math.floor(Math.random() * autoPlayableTiles.length)];
        autoNewPlayerTiles = autoPlayerTiles.filter(t => t !== tileToPlay);

        // Analyze placement
        const autoAdjTiles = getAdjacentTiles(tileToPlay, autoBoardRows, autoBoardColsCount);
        const autoChainsSet = new Set<ChainName>();
        const autoUnincorp: string[] = [];
        for (const a of autoAdjTiles) {
          const t = autoBoard[a];
          if (t?.placed) {
            if (t.chain) autoChainsSet.add(t.chain as ChainName);
            else autoUnincorp.push(a);
          }
        }
        const autoChainArray = Array.from(autoChainsSet);

        // Place tile on board
        autoBoard[tileToPlay] = { id: tileToPlay, placed: true, chain: null };
        const autoNewChains = { ...autoChains };

        // Helper: draw tile and advance turn
        const advanceTurn = async (chains: Record<ChainName, any>) => {
          const drawn = autoTileBag.pop();
          if (drawn) autoNewPlayerTiles.push(drawn);
          await adminClient.from('game_players').update({ tiles: autoNewPlayerTiles }).eq('id', playerData.id);
          const { nextPlayerIndex, newRoundNumber, newDeadline, newPhase, winner } = computeAutoNextTurn(chains);
          await adminClient.from('game_states').update({
            board: autoBoard,
            chains,
            stock_bank: autoStockBank,
            current_player_index: nextPlayerIndex,
            phase: newPhase,
            tile_bag: autoTileBag,
            stocks_purchased_this_turn: 0,
            last_placed_tile: null,
            merger: null,
            pending_chain_foundation: null,
            round_number: newRoundNumber,
            turn_deadline_epoch: newDeadline,
            game_log: autoGameLog,
            winner,
          }).eq('room_id', roomId);
        };

        if (autoChainArray.length >= 2) {
          // Merger: auto-resolve — all players keep their stock
          const sortedBySize = autoChainArray
            .map(c => ({ chain: c, size: autoChains[c].tiles.length }))
            .sort((a, b) => b.size - a.size);
          const biggestSize = sortedBySize[0].size;
          const tiedChains = sortedBySize.filter(c => c.size === biggestSize);
          const survivingChain = tiedChains[Math.floor(Math.random() * tiedChains.length)].chain;
          const defunctList = autoChainArray.filter(c => c !== survivingChain);

          // Fetch fresh player data for accurate cash
          const { data: freshAutoPlayers } = await adminClient
            .from('game_players').select('*').eq('room_id', roomId).order('player_index');
          const freshAutoStates = (freshAutoPlayers || []).map((p: any) => ({
            id: `player-${p.player_index}`,
            name: p.player_name,
            cash: p.cash,
            stocks: p.stocks,
          }));

          // Pay bonuses for each defunct chain
          for (const defunctC of defunctList) {
            const dSize = autoChains[defunctC].tiles.length;
            const dBonuses = getBonuses(defunctC, dSize, autoBonusTier);
            const payments: { pi: number; amount: number }[] = [];

            if (autoBonusTier === 'flat') {
              const allHolders = freshAutoStates.filter((p: any) => (p.stocks[defunctC] ?? 0) > 0);
              if (allHolders.length > 0) {
                const flatPool = dBonuses.majority + dBonuses.minority;
                const perPlayer = Math.floor(flatPool / allHolders.length);
                allHolders.forEach((p: any) => payments.push({ pi: parseInt(p.id.split('-')[1]), amount: perPlayer }));
              }
            } else {
              const { majority: dMaj, minority: dMin } = getStockholderRankings(freshAutoStates, defunctC);
              if (dMaj.length > 0) {
                if (dMin.length === 0) {
                  const each = Math.floor((dBonuses.majority + dBonuses.minority) / dMaj.length);
                  dMaj.forEach((p: any) => payments.push({ pi: parseInt(p.id.split('-')[1]), amount: each }));
                } else {
                  const majEach = Math.floor(dBonuses.majority / dMaj.length);
                  const minEach = Math.floor(dBonuses.minority / dMin.length);
                  dMaj.forEach((p: any) => payments.push({ pi: parseInt(p.id.split('-')[1]), amount: majEach }));
                  dMin.forEach((p: any) => payments.push({ pi: parseInt(p.id.split('-')[1]), amount: minEach }));
                }
              }
            }

            if (payments.length > 0) {
              for (const { pi, amount } of payments) {
                const dbP = (freshAutoPlayers || []).find((p: any) => p.player_index === pi);
                if (dbP) await adminClient.from('game_players').update({ cash: dbP.cash + amount }).eq('id', dbP.id);
              }
              autoGameLog.push({
                timestamp: Date.now(),
                playerId: 'system',
                playerName: 'System',
                action: `${CHAINS[defunctC].displayName} bonuses paid (auto)`,
              });
            }
          }

          // Transfer all defunct tiles to surviving chain
          const mergerTilesToAdd = [tileToPlay, ...autoUnincorp];
          for (const dc of defunctList) mergerTilesToAdd.push(...autoChains[dc].tiles);
          for (const tid of mergerTilesToAdd) autoBoard[tid] = { ...autoBoard[tid], chain: survivingChain };
          const survivorExisting = autoChains[survivingChain].tiles;
          const survivorAll = [...new Set([...survivorExisting, ...mergerTilesToAdd])];
          autoNewChains[survivingChain] = { ...autoNewChains[survivingChain], tiles: survivorAll, isSafe: autoSafeChainSize !== null && survivorAll.length >= autoSafeChainSize };
          for (const dc of defunctList) {
            autoNewChains[dc] = { ...autoNewChains[dc], tiles: [], isActive: false, isSafe: false };
          }

          autoGameLog.push({
            timestamp: Date.now(),
            playerId: 'system',
            playerName: 'System',
            action: 'Merger auto-resolved',
            details: `${CHAINS[survivingChain].displayName} absorbed ${defunctList.map(c => CHAINS[c].displayName).join(', ')}`,
          });

          await advanceTurn(autoNewChains);

        } else if (autoChainArray.length === 1) {
          // Grow existing chain
          const growTarget = autoChainArray[0];
          const growTiles = [tileToPlay, ...autoUnincorp];
          for (const tid of growTiles) autoBoard[tid] = { ...autoBoard[tid], chain: growTarget };
          const growExisting = autoChains[growTarget].tiles;
          const growAll = [...growExisting, ...growTiles];
          autoNewChains[growTarget] = { ...autoNewChains[growTarget], tiles: growAll, isSafe: autoSafeChainSize !== null && growAll.length >= autoSafeChainSize };

          await advanceTurn(autoNewChains);

        } else if (autoUnincorp.length > 0) {
          // Found a new chain: pick random from eligible available chains
          const availableForAuto = autoEligibleChains.filter(c => !autoChains[c].isActive);
          const newAutoChain = availableForAuto[Math.floor(Math.random() * availableForAuto.length)];
          const foundTiles = [tileToPlay, ...autoUnincorp];
          for (const tid of foundTiles) autoBoard[tid] = { ...autoBoard[tid], chain: newAutoChain };
          autoNewChains[newAutoChain] = { ...autoNewChains[newAutoChain], tiles: foundTiles, isActive: true, isSafe: autoSafeChainSize !== null && foundTiles.length >= autoSafeChainSize };

          // Founding bonus
          if (autoStockBank[newAutoChain] > 0) {
            const founderStocks = { ...playerData.stocks };
            founderStocks[newAutoChain] = (founderStocks[newAutoChain] || 0) + 1;
            autoStockBank[newAutoChain]--;
            await adminClient.from('game_players').update({ stocks: founderStocks }).eq('id', playerData.id);
          }

          autoGameLog.push({
            timestamp: Date.now(),
            playerId: `player-${myPlayerIndex}`,
            playerName: playerData.player_name,
            action: `Auto-founded ${CHAINS[newAutoChain].displayName}`,
          });

          await advanceTurn(autoNewChains);

        } else {
          // Place only — skip buy, advance turn
          await advanceTurn(autoNewChains);
        }

        result = { success: true };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
    }

    return new Response(JSON.stringify(result), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error: unknown) {
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({ error: 'An internal error occurred' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Helper function to complete merger
async function completeMergerInDb(
  adminClient: any, 
  roomId: string, 
  gameState: any, 
  allPlayers: any[],
  gameLog: any[]
): Promise<string> {
  const merger = gameState.merger;
  const survivingChain = merger.survivingChain as ChainName;
  const lastTile = gameState.last_placed_tile;

  // Derive board dimensions for adjacency calculation
  const completeMergerRulesForBoard: CustomRules = { ...DEFAULT_RULES, ...(gameState.rules_snapshot as Partial<CustomRules> ?? {}) };
  const { boardRows: cmBoardRows, boardColsCount: cmBoardColsCount } = getBoardDimensions(completeMergerRulesForBoard);

  // Collect all tiles to add
  const tilesToAdd: TileId[] = [lastTile];

  const adjacent = getAdjacentTiles(lastTile, cmBoardRows, cmBoardColsCount);
  for (const adjTile of adjacent) {
    const tile = gameState.board[adjTile];
    if (tile?.placed && !tile.chain) {
      tilesToAdd.push(adjTile);
    }
  }

  for (const defunctChain of merger.defunctChains) {
    tilesToAdd.push(...gameState.chains[defunctChain].tiles);
  }

  // Update board
  const newBoard = { ...gameState.board };
  for (const tid of tilesToAdd) {
    newBoard[tid] = { ...newBoard[tid], chain: survivingChain };
  }

  // Update chains
  const completeMergerRules: CustomRules = { ...DEFAULT_RULES, ...(gameState.rules_snapshot as Partial<CustomRules> ?? {}) };
  const completeMergerSafeSize: number | null = getSafeChainSize(completeMergerRules);
  const completeMergerBonusTier: string = getBonusTier(completeMergerRules);
  const newChains = { ...gameState.chains };
  const existingTiles = newChains[survivingChain].tiles;
  const allTiles = [...new Set([...existingTiles, ...tilesToAdd])];

  newChains[survivingChain] = {
    ...newChains[survivingChain],
    tiles: allTiles,
    isSafe: completeMergerSafeSize !== null && allTiles.length >= completeMergerSafeSize,
  };

  for (const defunctChain of merger.defunctChains) {
    newChains[defunctChain] = {
      ...newChains[defunctChain],
      tiles: [],
      isActive: false,
      isSafe: false,
    };
  }

  gameLog.push({
    timestamp: Date.now(),
    playerId: 'system',
    playerName: 'System',
    action: 'Merger complete',
    details: `${CHAINS[survivingChain].displayName} absorbed ${merger.defunctChains.map((c: ChainName) => CHAINS[c].displayName).join(', ')}. Now has ${allTiles.length} tiles.`,
  });

  let newPhase = 'buy_stock';
  let winner = null;

  if (checkGameEnd(newChains)) {
    newPhase = 'game_over';
    const scoredPlayers = allPlayers.map(p => ({
      id: `player-${p.player_index}`,
      name: p.player_name,
      cash: p.cash,
      stocks: p.stocks,
    }));
    winner = calculateFinalScores(scoredPlayers, newChains, completeMergerBonusTier)[0].name;
  }

  await adminClient
    .from('game_states')
    .update({
      board: newBoard,
      chains: newChains,
      phase: newPhase,
      merger: null,
      game_log: gameLog,
      winner,
    })
    .eq('room_id', roomId);

  return newPhase;
}
