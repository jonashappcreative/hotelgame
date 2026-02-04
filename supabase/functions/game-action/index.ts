import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Types (duplicated from frontend since we can't import from src)
type ChainName = 'sackson' | 'tower' | 'worldwide' | 'american' | 'festival' | 'continental' | 'imperial';
type TileId = string;

interface MergerStockDecision {
  sell: number;
  trade: number;
  keep: number;
}

interface GameActionRequest {
  action: 'start_game' | 'toggle_ready' | 'place_tile' | 'found_chain' | 'choose_merger_survivor' |
          'pay_merger_bonuses' | 'merger_stock_choice' | 'buy_stocks' | 'skip_buy' |
          'discard_tile' | 'end_game_vote' | 'new_game' | 'update_room_status';
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

const SAFE_CHAIN_SIZE = 11;
const END_GAME_CHAIN_SIZE = 41;
const CHAIN_SIZE_BRACKETS = [2, 3, 5, 10, 20, 30, 40, Infinity] as const;
const BASE_PRICES: Record<'budget' | 'midrange' | 'premium', number[]> = {
  budget: [200, 300, 400, 500, 600, 700, 800, 900],
  midrange: [300, 400, 500, 600, 700, 800, 900, 1000],
  premium: [400, 500, 600, 700, 800, 900, 1000, 1100],
};
const MAJORITY_BONUS_MULTIPLIER = 10;
const MINORITY_BONUS_MULTIPLIER = 5;

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

function getBonuses(chainName: ChainName, size: number): { majority: number; minority: number } {
  const price = getStockPrice(chainName, size);
  return {
    majority: price * MAJORITY_BONUS_MULTIPLIER,
    minority: price * MINORITY_BONUS_MULTIPLIER,
  };
}

function parseTileId(tileId: TileId): { row: number; col: string } {
  const match = tileId.match(/^(\d)([A-L])$/);
  if (!match) throw new Error(`Invalid tile ID: ${tileId}`);
  return { row: parseInt(match[1]), col: match[2] };
}

function getAdjacentTiles(tileId: TileId): TileId[] {
  const { row, col } = parseTileId(tileId);
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const colIndex = cols.indexOf(col);
  const adjacent: TileId[] = [];

  if (row > 1) adjacent.push(`${row - 1}${col}`);
  if (row < 9) adjacent.push(`${row + 1}${col}`);
  if (colIndex > 0) adjacent.push(`${row}${cols[colIndex - 1]}`);
  if (colIndex < 11) adjacent.push(`${row}${cols[colIndex + 1]}`);

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

function generateAllTiles(): TileId[] {
  const tiles: TileId[] = [];
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  for (let row = 1; row <= 9; row++) {
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

function calculateFinalScores(players: any[], chains: Record<ChainName, any>): any[] {
  const scoredPlayers = players.map(p => ({ ...p }));

  for (const chain of Object.values(chains)) {
    if (!chain.isActive) continue;

    const { majority, minority } = getStockholderRankings(scoredPlayers, chain.name);
    const bonuses = getBonuses(chain.name, chain.tiles.length);

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

    const price = getStockPrice(chain.name, chain.tiles.length);
    for (const player of scoredPlayers) {
      player.cash += player.stocks[chain.name] * price;
      player.stocks[chain.name] = 0;
    }
  }

  return scoredPlayers.sort((a, b) => b.cash - a.cash);
}

Deno.serve(async (req) => {
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
          .select('max_players')
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

        // Deal tiles to players and reset ready state
        for (const player of freshPlayers) {
          const playerTiles = tileBag.splice(0, 6);
          await adminClient
            .from('game_players')
            .update({
              tiles: playerTiles,
              cash: 6000,
              stocks: { sackson: 0, tower: 0, worldwide: 0, american: 0, festival: 0, continental: 0, imperial: 0 },
              is_ready: false,
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
        const adjacent = getAdjacentTiles(tileId);
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

        // Check for 8th chain
        if (chainArray.length === 0 && adjacentUnincorporated.length > 0) {
          const activeChains = Object.values(chains).filter((c: any) => c.isActive).length;
          if (activeChains >= 7) {
            return new Response(JSON.stringify({ error: 'Cannot create an 8th hotel chain' }), { 
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
            isSafe: allTiles.length >= SAFE_CHAIN_SIZE,
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
          const winner = calculateFinalScores(scoredPlayers, newChains)[0].name;
          
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
          isSafe: tilesToAdd.length >= SAFE_CHAIN_SIZE,
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
          winner = calculateFinalScores(scoredPlayers, newChains)[0].name;
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
        if (!gameState || gameState.current_player_index !== myPlayerIndex) {
          return new Response(JSON.stringify({ error: 'Not your turn' }), { 
            status: 403, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        const survivingChain = payload?.survivingChain as ChainName;
        if (!survivingChain) {
          return new Response(JSON.stringify({ error: 'Surviving chain required' }), { 
            status: 400, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }

        const adjacentChains = payload?.adjacentChains as ChainName[];
        const defunctChains = adjacentChains.filter(c => c !== survivingChain)
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
        const bonuses = getBonuses(defunctChain, chainSize);

        // Get stockholder rankings
        const playerStates = allPlayers.map(p => ({
          id: `player-${p.player_index}`,
          name: p.player_name,
          cash: p.cash,
          stocks: p.stocks,
        }));
        
        const { majority, minority } = getStockholderRankings(playerStates, defunctChain);
        const gameLog = [...gameState.game_log];

        // Pay bonuses
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

        const purchases = payload?.purchases as { chain: ChainName; quantity: number }[];
        
        let totalCost = 0;
        const newPlayerStocks = { ...playerData.stocks };
        const newStockBank = { ...gameState.stock_bank };

        for (const purchase of (purchases || [])) {
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
          winner = calculateFinalScores(scoredPlayers, gameState.chains)[0].name;
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
          winner = calculateFinalScores(scoredPlayers, gameState.chains)[0].name;
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
            winner = calculateFinalScores(scoredPlayers, gameState.chains)[0].name;
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
        // This is used to update room status (e.g., for cleanup)
        const newStatus = payload?.status;
        if (newStatus) {
          await adminClient
            .from('game_rooms')
            .update({ status: newStatus })
            .eq('id', roomId);
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), { 
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

  // Collect all tiles to add
  const tilesToAdd: TileId[] = [lastTile];
  
  const adjacent = getAdjacentTiles(lastTile);
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
  const newChains = { ...gameState.chains };
  const existingTiles = newChains[survivingChain].tiles;
  const allTiles = [...new Set([...existingTiles, ...tilesToAdd])];
  
  newChains[survivingChain] = {
    ...newChains[survivingChain],
    tiles: allTiles,
    isSafe: allTiles.length >= SAFE_CHAIN_SIZE,
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
    winner = calculateFinalScores(scoredPlayers, newChains)[0].name;
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
