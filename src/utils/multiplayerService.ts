import { supabase } from '@/integrations/supabase/client';
import { GameState, ChainName, TileId, TileState, PlayerState, ChainState } from '@/types/game';
import type { Json } from '@/integrations/supabase/types';

// Generate a unique session ID for this browser session
export const getSessionId = (): string => {
  let sessionId = sessionStorage.getItem('acquire_session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('acquire_session_id', sessionId);
  }
  return sessionId;
};

// Create a new game room
export const createRoom = async (): Promise<{ roomCode: string; roomId: string } | null> => {
  const roomCode = generateRoomCode();
  
  const { data, error } = await supabase
    .from('game_rooms')
    .insert({ room_code: roomCode })
    .select()
    .single();

  if (error) {
    console.error('Error creating room:', error);
    return null;
  }

  return { roomCode: data.room_code, roomId: data.id };
};

// Join an existing room
export const joinRoom = async (
  roomCode: string, 
  playerName: string
): Promise<{ success: boolean; roomId?: string; playerIndex?: number; error?: string }> => {
  const sessionId = getSessionId();
  
  // Find the room
  const { data: room, error: roomError } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('room_code', roomCode.toUpperCase())
    .single();

  if (roomError || !room) {
    return { success: false, error: 'Room not found' };
  }

  if (room.status !== 'waiting') {
    return { success: false, error: 'Game already started' };
  }

  // Check existing players
  const { data: players, error: playersError } = await supabase
    .from('game_players')
    .select('*')
    .eq('room_id', room.id)
    .order('player_index');

  if (playersError) {
    return { success: false, error: 'Error checking players' };
  }

  // Check if this session already joined
  const existingPlayer = players?.find(p => p.session_id === sessionId);
  if (existingPlayer) {
    return { success: true, roomId: room.id, playerIndex: existingPlayer.player_index };
  }

  if (players && players.length >= 4) {
    return { success: false, error: 'Room is full' };
  }

  // Add player
  const playerIndex = players?.length || 0;
  const { error: insertError } = await supabase
    .from('game_players')
    .insert({
      room_id: room.id,
      player_name: playerName,
      player_index: playerIndex,
      session_id: sessionId,
    });

  if (insertError) {
    console.error('Error joining room:', insertError);
    return { success: false, error: 'Failed to join room' };
  }

  return { success: true, roomId: room.id, playerIndex };
};

// Leave a room
export const leaveRoom = async (roomId: string): Promise<void> => {
  const sessionId = getSessionId();
  
  await supabase
    .from('game_players')
    .delete()
    .eq('room_id', roomId)
    .eq('session_id', sessionId);
};

// Get room players
export const getRoomPlayers = async (roomId: string): Promise<{ id: string; player_name: string; player_index: number }[]> => {
  const { data, error } = await supabase
    .from('game_players')
    .select('id, player_name, player_index')
    .eq('room_id', roomId)
    .order('player_index');

  if (error) {
    console.error('Error fetching players:', error);
    return [];
  }

  return data || [];
};

// Start the game
export const startGame = async (roomId: string, gameState: GameState): Promise<boolean> => {
  // Serialize board Map to object
  const boardObj: Record<string, TileState> = {};
  gameState.board.forEach((value, key) => {
    boardObj[key] = value;
  });

  // Update room status
  const { error: roomError } = await supabase
    .from('game_rooms')
    .update({ status: 'playing' })
    .eq('id', roomId);

  if (roomError) {
    console.error('Error updating room status:', roomError);
    return false;
  }

  // Create game state
  const { error: stateError } = await supabase
    .from('game_states')
    .insert({
      room_id: roomId,
      current_player_index: gameState.currentPlayerIndex,
      phase: gameState.phase,
      board: boardObj as unknown as Json,
      chains: gameState.chains as unknown as Json,
      stock_bank: gameState.stockBank as unknown as Json,
      tile_bag: gameState.tileBag,
      last_placed_tile: gameState.lastPlacedTile,
      pending_chain_foundation: gameState.pendingChainFoundation,
      merger: gameState.merger as unknown as Json,
      stocks_purchased_this_turn: gameState.stocksPurchasedThisTurn,
      game_log: gameState.gameLog as unknown as Json,
      winner: gameState.winner,
      end_game_votes: gameState.endGameVotes,
    });

  if (stateError) {
    console.error('Error creating game state:', stateError);
    return false;
  }

  // Update player data
  for (const player of gameState.players) {
    const playerIndex = parseInt(player.id.split('-')[1]);
    await supabase
      .from('game_players')
      .update({
        cash: player.cash,
        tiles: player.tiles,
        stocks: player.stocks,
      })
      .eq('room_id', roomId)
      .eq('player_index', playerIndex);
  }

  return true;
};

// Update game state in database
export const updateGameState = async (roomId: string, gameState: GameState): Promise<boolean> => {
  // Serialize board Map to object
  const boardObj: Record<string, TileState> = {};
  gameState.board.forEach((value, key) => {
    boardObj[key] = value;
  });

  const { error: stateError } = await supabase
    .from('game_states')
    .update({
      current_player_index: gameState.currentPlayerIndex,
      phase: gameState.phase,
      board: boardObj as unknown as Json,
      chains: gameState.chains as unknown as Json,
      stock_bank: gameState.stockBank as unknown as Json,
      tile_bag: gameState.tileBag,
      last_placed_tile: gameState.lastPlacedTile,
      pending_chain_foundation: gameState.pendingChainFoundation,
      merger: gameState.merger as unknown as Json,
      stocks_purchased_this_turn: gameState.stocksPurchasedThisTurn,
      game_log: gameState.gameLog as unknown as Json,
      winner: gameState.winner,
      end_game_votes: gameState.endGameVotes,
    })
    .eq('room_id', roomId);

  if (stateError) {
    console.error('Error updating game state:', stateError);
    return false;
  }

  // Update player data
  for (const player of gameState.players) {
    const playerIndex = parseInt(player.id.split('-')[1]);
    await supabase
      .from('game_players')
      .update({
        cash: player.cash,
        tiles: player.tiles,
        stocks: player.stocks,
      })
      .eq('room_id', roomId)
      .eq('player_index', playerIndex);
  }

  return true;
};

// Convert database state to GameState
export const dbToGameState = (
  dbState: any, 
  players: any[], 
  roomCode: string
): GameState => {
  // Convert board object back to Map
  const board = new Map<TileId, TileState>();
  if (dbState.board) {
    Object.entries(dbState.board).forEach(([key, value]) => {
      board.set(key as TileId, value as TileState);
    });
  }

  // Convert players
  const playerStates: PlayerState[] = players.map(p => ({
    id: `player-${p.player_index}`,
    name: p.player_name,
    cash: p.cash,
    tiles: p.tiles || [],
    stocks: p.stocks || {
      sackson: 0, tower: 0, worldwide: 0, american: 0,
      festival: 0, continental: 0, imperial: 0
    },
    isConnected: p.is_connected,
  }));

  return {
    roomCode,
    players: playerStates,
    currentPlayerIndex: dbState.current_player_index,
    phase: dbState.phase,
    board,
    chains: dbState.chains as Record<ChainName, ChainState>,
    stockBank: dbState.stock_bank as Record<ChainName, number>,
    tileBag: dbState.tile_bag || [],
    lastPlacedTile: dbState.last_placed_tile || null,
    pendingChainFoundation: dbState.pending_chain_foundation || null,
    merger: dbState.merger || null,
    mergerAdjacentChains: null,
    stocksPurchasedThisTurn: dbState.stocks_purchased_this_turn,
    gameLog: dbState.game_log || [],
    winner: dbState.winner || null,
    endGameVotes: dbState.end_game_votes || [],
  };
};

// Subscribe to room changes
export const subscribeToRoom = (
  roomId: string,
  onPlayersChange: (players: any[]) => void,
  onGameStateChange: (state: any) => void,
  onRoomStatusChange: (status: string) => void
) => {
  const channel = supabase
    .channel(`room-${roomId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'game_players',
        filter: `room_id=eq.${roomId}`,
      },
      async () => {
        const players = await getRoomPlayers(roomId);
        onPlayersChange(players);
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'game_states',
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        onGameStateChange(payload.new);
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'game_rooms',
        filter: `id=eq.${roomId}`,
      },
      (payload: any) => {
        onRoomStatusChange(payload.new.status);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
};

// Helper function
const generateRoomCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
};
