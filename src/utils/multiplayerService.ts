import { supabase } from '@/integrations/supabase/client';
import { GameState, ChainName, TileId, TileState, PlayerState, ChainState } from '@/types/game';
import type { Json } from '@/integrations/supabase/types';

// Get or create an authenticated session (anonymous or existing user)
export const getOrCreateAuthSession = async (): Promise<string | null> => {
  console.log('[DEBUG AUTH] Checking for existing auth session...');
  const { data: { user }, error: getUserError } = await supabase.auth.getUser();

  if (getUserError) {
    console.warn('[DEBUG AUTH] getUser() error:', getUserError.message, getUserError);
  }

  if (user) {
    console.log(`[DEBUG AUTH] Existing session found — user_id=${user.id}, is_anonymous=${user.is_anonymous}, created_at=${user.created_at}`);
    return user.id;
  }

  console.log('[DEBUG AUTH] No existing session. Signing in anonymously...');
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error('[DEBUG AUTH] signInAnonymously() FAILED:', error.message, error);
    return null;
  }

  console.log(`[DEBUG AUTH] New anonymous user created — user_id=${data.user?.id}, created_at=${data.user?.created_at}`);
  return data.user?.id ?? null;
};

// Get current user ID (must be authenticated first)
export const getCurrentUserId = async (): Promise<string | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
};

// Legacy session ID for backward compatibility
export const getSessionId = (): string => {
  let sessionId = sessionStorage.getItem('acquire_session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('acquire_session_id', sessionId);
    console.log(`[DEBUG SESSION] New legacy session_id created: ${sessionId}`);
  } else {
    console.log(`[DEBUG SESSION] Existing legacy session_id found: ${sessionId}`);
  }
  return sessionId;
};

// Create a new game room
export const createRoom = async (maxPlayers: number = 4): Promise<{ roomCode: string; roomId: string; maxPlayers: number } | null> => {
  console.log(`[DEBUG CREATE_ROOM] Starting room creation with maxPlayers=${maxPlayers}`);

  // Ensure we're authenticated
  const userId = await getOrCreateAuthSession();
  if (!userId) {
    console.error('[DEBUG CREATE_ROOM] FAILED — user not authenticated');
    return null;
  }
  console.log(`[DEBUG CREATE_ROOM] Authenticated as user_id=${userId}`);

  const roomCode = generateRoomCode();
  console.log(`[DEBUG CREATE_ROOM] Generated room code: ${roomCode}`);

  const { data, error } = await supabase
    .from('game_rooms')
    .insert({ room_code: roomCode, max_players: maxPlayers })
    .select()
    .single();

  if (error) {
    console.error('[DEBUG CREATE_ROOM] INSERT into game_rooms FAILED:', error.message, error.code, error.details, error);
    return null;
  }

  console.log(`[DEBUG CREATE_ROOM] SUCCESS — room_id=${data.id}, room_code=${data.room_code}, max_players=${data.max_players}`);
  return { roomCode: data.room_code, roomId: data.id, maxPlayers: data.max_players };
};

// Join an existing room
export const joinRoom = async (
  roomCode: string,
  playerName: string
): Promise<{ success: boolean; roomId?: string; playerIndex?: number; maxPlayers?: number; error?: string }> => {
  console.log(`[DEBUG JOIN] ========== JOIN ROOM START ==========`);
  console.log(`[DEBUG JOIN] roomCode="${roomCode}", playerName="${playerName}"`);

  // Ensure we're authenticated
  const userId = await getOrCreateAuthSession();
  if (!userId) {
    console.error('[DEBUG JOIN] ABORT — authentication failed, no user_id');
    return { success: false, error: 'Failed to authenticate' };
  }
  console.log(`[DEBUG JOIN] Authenticated — user_id=${userId}`);

  const sessionId = getSessionId(); // Keep for backward compatibility
  console.log(`[DEBUG JOIN] Legacy session_id=${sessionId}`);

  // Find the room
  console.log(`[DEBUG JOIN] Looking up room with code="${roomCode.toUpperCase()}"...`);
  const { data: room, error: roomError } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('room_code', roomCode.toUpperCase())
    .maybeSingle();

  if (roomError) {
    console.error('[DEBUG JOIN] Room lookup FAILED:', roomError.message, roomError.code, roomError);
    return { success: false, error: 'Room not found' };
  }
  if (!room) {
    console.error(`[DEBUG JOIN] No room found with code="${roomCode.toUpperCase()}"`);
    return { success: false, error: 'Room not found' };
  }

  console.log(`[DEBUG JOIN] Room found — room_id=${room.id}, status="${room.status}", max_players=${room.max_players}`);

  if (room.status !== 'waiting') {
    console.warn(`[DEBUG JOIN] ABORT — room status is "${room.status}", not "waiting"`);
    return { success: false, error: 'Game already started' };
  }

  const maxPlayers = room.max_players || 4;

  // Check if this user already joined (check our own record first)
  console.log(`[DEBUG JOIN] Checking if user_id=${userId} already exists in room_id=${room.id}...`);
  const { data: myPlayer, error: myPlayerError } = await supabase
    .from('game_players')
    .select('*')
    .eq('room_id', room.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (myPlayerError) {
    console.warn('[DEBUG JOIN] Duplicate check query error:', myPlayerError.message, myPlayerError.code, myPlayerError);
  }

  if (myPlayer) {
    console.log(`[DEBUG JOIN] User already in room! Returning existing record — player_index=${myPlayer.player_index}, player_name="${myPlayer.player_name}"`);
    return { success: true, roomId: room.id, playerIndex: myPlayer.player_index, maxPlayers };
  }
  console.log('[DEBUG JOIN] User NOT yet in room. Proceeding to join...');

  // Try to join with retry logic for race conditions
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    console.log(`[DEBUG JOIN] --- Attempt ${attempt + 1}/${maxRetries} ---`);

    // Get current player count using the public view
    const { data: players, error: playersError } = await supabase
      .from('game_players_public')
      .select('player_index')
      .eq('room_id', room.id)
      .order('player_index');

    if (playersError) {
      console.error('[DEBUG JOIN] Error fetching current players:', playersError.message, playersError.code, playersError);
      return { success: false, error: 'Error checking players' };
    }

    const currentIndices = players?.map(p => p.player_index) || [];
    console.log(`[DEBUG JOIN] Current players in room: ${players?.length || 0}/${maxPlayers}, indices=[${currentIndices.join(', ')}]`);

    if (players && players.length >= maxPlayers) {
      console.warn('[DEBUG JOIN] ABORT — room is full');
      return { success: false, error: 'Room is full' };
    }

    // Find the next available player_index (handle gaps from players leaving)
    const usedIndices = new Set(currentIndices);
    let playerIndex = 0;
    while (usedIndices.has(playerIndex) && playerIndex < maxPlayers) {
      playerIndex++;
    }

    if (playerIndex >= maxPlayers) {
      console.warn('[DEBUG JOIN] ABORT — no available index (room full)');
      return { success: false, error: 'Room is full' };
    }

    console.log(`[DEBUG JOIN] Attempting INSERT — room_id=${room.id}, player_name="${playerName}", player_index=${playerIndex}, user_id=${userId}, session_id=${sessionId}`);

    // Try to insert player
    const { data: insertedPlayer, error: insertError } = await supabase
      .from('game_players')
      .insert({
        room_id: room.id,
        player_name: playerName,
        player_index: playerIndex,
        user_id: userId,
        session_id: sessionId,
      })
      .select()
      .maybeSingle();

    if (!insertError && insertedPlayer) {
      console.log(`[DEBUG JOIN] SUCCESS — Player "${playerName}" joined room ${roomCode} at index ${insertedPlayer.player_index} (user_id=${userId})`);
      console.log(`[DEBUG JOIN] ========== JOIN ROOM END (SUCCESS) ==========`);
      return { success: true, roomId: room.id, playerIndex: insertedPlayer.player_index, maxPlayers };
    }

    // Log the full error
    console.error(`[DEBUG JOIN] INSERT FAILED — code=${insertError?.code}, message="${insertError?.message}", details="${insertError?.details}", hint="${insertError?.hint}"`);

    // If it's a unique constraint violation, check if we're already in the game
    if (insertError?.code === '23505') {
      console.warn(`[DEBUG JOIN] Unique constraint violation (23505) on attempt ${attempt + 1}. Constraint details: "${insertError.message}"`);

      // Re-check if this user already joined (might have succeeded in parallel request/tab)
      console.log(`[DEBUG JOIN] Re-checking if user_id=${userId} exists in room after 23505...`);
      const { data: existingPlayer } = await supabase
        .from('game_players')
        .select('*')
        .eq('room_id', room.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingPlayer) {
        console.log(`[DEBUG JOIN] Found existing record after 23505 — player_index=${existingPlayer.player_index}. Returning it.`);
        console.log(`[DEBUG JOIN] ========== JOIN ROOM END (EXISTING) ==========`);
        return { success: true, roomId: room.id, playerIndex: existingPlayer.player_index, maxPlayers };
      }

      // Not a duplicate user - must be a player_index race condition, retry
      const baseDelay = 150 * Math.pow(2, attempt);
      const jitter = Math.random() * 100;
      const totalDelay = Math.round(baseDelay + jitter);
      console.log(`[DEBUG JOIN] Not a duplicate user. Player_index race condition. Retrying in ${totalDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
      continue;
    }

    // Other error - fail immediately
    console.error(`[DEBUG JOIN] Non-retryable error. ABORTING.`);
    console.log(`[DEBUG JOIN] ========== JOIN ROOM END (FAILURE) ==========`);
    return { success: false, error: 'Failed to join room' };
  }

  console.error(`[DEBUG JOIN] Exhausted all ${maxRetries} retry attempts.`);
  console.log(`[DEBUG JOIN] ========== JOIN ROOM END (MAX RETRIES) ==========`);
  return { success: false, error: 'Failed to join room after multiple attempts' };
};

// Leave a room
export const leaveRoom = async (roomId: string): Promise<void> => {
  console.log(`[DEBUG LEAVE] Leaving room_id=${roomId}`);
  const userId = await getCurrentUserId();
  if (!userId) {
    console.warn('[DEBUG LEAVE] No user_id — cannot leave');
    return;
  }
  console.log(`[DEBUG LEAVE] Deleting player record for user_id=${userId} in room_id=${roomId}`);

  const { error } = await supabase
    .from('game_players')
    .delete()
    .eq('room_id', roomId)
    .eq('user_id', userId);

  if (error) {
    console.error('[DEBUG LEAVE] DELETE FAILED:', error.message, error.code, error);
  } else {
    console.log('[DEBUG LEAVE] Successfully left room');
  }
};

// Get room players (public info only - excludes tiles for security)
export const getRoomPlayers = async (roomId: string): Promise<{ id: string; player_name: string; player_index: number }[]> => {
  console.log(`[DEBUG GET_PLAYERS] Fetching players for room_id=${roomId}`);
  const { data, error } = await supabase
    .from('game_players_public')
    .select('id, player_name, player_index')
    .eq('room_id', roomId)
    .order('player_index');

  if (error) {
    console.error('[DEBUG GET_PLAYERS] FAILED:', error.message, error.code, error);
    return [];
  }

  const result = (data || []).map(p => ({
    id: p.id || '',
    player_name: p.player_name || '',
    player_index: p.player_index ?? 0
  }));
  console.log(`[DEBUG GET_PLAYERS] Found ${result.length} players:`, result.map(p => `"${p.player_name}" (index=${p.player_index})`).join(', '));
  return result;
};

// Get player data with secure tile handling
// Only returns tiles for the current session's player, others get empty arrays
export const getSecurePlayerData = async (roomId: string): Promise<any[]> => {
  const userId = await getCurrentUserId();
  
  // Fetch public player data (excludes tiles and session_id for security)
  const { data: publicData, error: publicError } = await supabase
    .from('game_players_public')
    .select('id, room_id, player_name, player_index, cash, stocks, is_connected, created_at')
    .eq('room_id', roomId)
    .order('player_index');

  if (publicError || !publicData) {
    console.error('Error fetching player data:', publicError);
    return [];
  }

  // Fetch own player data separately using user_id
  const { data: myPlayer } = await supabase
    .from('game_players')
    .select('player_index, tiles')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();

  const myPlayerIndex = myPlayer?.player_index ?? -1;
  const myTiles: string[] = myPlayer?.tiles || [];

  // Return players with tiles only for the authenticated user
  return publicData.map((p) => ({
    ...p,
    tiles: p.player_index === myPlayerIndex ? myTiles : []
  }));
};

// Execute a game action via the edge function
export const executeGameAction = async (
  action: string,
  roomId: string,
  payload?: any
): Promise<{ success: boolean; error?: string; data?: any }> => {
  const { data, error } = await supabase.functions.invoke('game-action', {
    body: { action, roomId, payload }
  });

  if (error) {
    console.error('Game action error:', error);
    return { success: false, error: error.message };
  }

  if (data?.error) {
    return { success: false, error: data.error };
  }

  return data || { success: true };
};

// Start the game via edge function
export const startGame = async (roomId: string, gameState: GameState): Promise<boolean> => {
  const result = await executeGameAction('start_game', roomId);
  return result.success;
};

// Update game state via edge function (for actions that need state update)
export const updateGameState = async (roomId: string, gameState: GameState): Promise<boolean> => {
  // This is now handled by the edge function for each specific action
  // Kept for compatibility but the edge function handles updates
  return true;
};

// Convert database state to GameState
export const dbToGameState = (
  dbState: any,
  players: any[],
  roomCode: string
): GameState => {
  // Debug logging
  console.log('[dbToGameState] Received dbState:', {
    hasBoardField: !!dbState.board,
    boardType: typeof dbState.board,
    boardKeys: dbState.board ? Object.keys(dbState.board).length : 0,
    phase: dbState.phase,
  });

  // Convert board object back to Map
  const board = new Map<TileId, TileState>();
  if (dbState.board) {
    Object.entries(dbState.board).forEach(([key, value]) => {
      board.set(key as TileId, value as TileState);
    });
    console.log(`[dbToGameState] Converted ${board.size} tiles to board Map`);
  } else {
    console.warn('[dbToGameState] No board data in dbState!');
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
  console.log(`[DEBUG SUBSCRIBE] Setting up realtime subscription for room_id=${roomId}`);
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
      async (payload) => {
        console.log(`[DEBUG SUBSCRIBE] game_players change detected — event=${payload.eventType}`, payload.new);
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
        // Filter out tile_bag from the payload for security
        const state = payload.new as any;
        if (state) {
          console.log('[subscribeToRoom] Received game_states update:', {
            hasBoard: !!state.board,
            boardType: typeof state.board,
            phase: state.phase,
          });
          const { tile_bag, ...publicState } = state;
          onGameStateChange(publicState);
        }
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
