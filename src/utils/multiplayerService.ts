import { supabase } from '@/integrations/supabase/client';
import { GameState, ChainName, TileId, TileState, PlayerState, ChainState, CustomRules, DEFAULT_RULES } from '@/types/game';
import type { Json } from '@/integrations/supabase/types';

// Get or create an authenticated session (anonymous or existing user)
export const getOrCreateAuthSession = async (): Promise<string | null> => {
  // First check if we already have a session
  const { data: { user } } = await supabase.auth.getUser();
  
  if (user) {
    return user.id;
  }
  
  // Sign in anonymously if not authenticated
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error('Failed to create anonymous session:', error);
    return null;
  }
  
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
  }
  return sessionId;
};

// localStorage keys for game persistence
const ACTIVE_GAME_KEY = 'acquire_active_game';

interface StoredGameInfo {
  roomId: string;
  roomCode: string;
  playerName: string;
  playerIndex: number;
  timestamp: number;
}

// Save active game info to localStorage
export const saveActiveGameToStorage = (info: Omit<StoredGameInfo, 'timestamp'>): void => {
  const data: StoredGameInfo = {
    ...info,
    timestamp: Date.now(),
  };
  localStorage.setItem(ACTIVE_GAME_KEY, JSON.stringify(data));
};

// Get active game info from localStorage
export const getActiveGameFromStorage = (): StoredGameInfo | null => {
  const stored = localStorage.getItem(ACTIVE_GAME_KEY);
  if (!stored) return null;

  try {
    const data = JSON.parse(stored) as StoredGameInfo;
    // Expire after 48 hours (games older than that are likely finished)
    const maxAge = 48 * 60 * 60 * 1000;
    if (Date.now() - data.timestamp > maxAge) {
      localStorage.removeItem(ACTIVE_GAME_KEY);
      return null;
    }
    return data;
  } catch {
    localStorage.removeItem(ACTIVE_GAME_KEY);
    return null;
  }
};

// Clear active game from localStorage
export const clearActiveGameFromStorage = (): void => {
  localStorage.removeItem(ACTIVE_GAME_KEY);
};

// Create a new game room
export const createRoom = async (maxPlayers: number = 4, customRules: CustomRules = DEFAULT_RULES): Promise<{ roomCode: string; roomId: string; maxPlayers: number } | null> => {
  // Ensure we're authenticated
  const userId = await getOrCreateAuthSession();
  if (!userId) {
    console.error('Failed to authenticate');
    return null;
  }

  const roomCode = generateRoomCode();

  const { data, error } = await supabase
    .from('game_rooms')
    .insert({ room_code: roomCode, max_players: maxPlayers, custom_rules: customRules as unknown as Json })
    .select()
    .single();

  if (error) {
    console.error('Error creating room:', error);
    return null;
  }

  return { roomCode: data.room_code, roomId: data.id, maxPlayers: data.max_players };
};

// Fetch the custom rules for a room (returns DEFAULT_RULES if none are set)
export const fetchRoomRules = async (roomId: string): Promise<CustomRules> => {
  const { data, error } = await supabase
    .from('game_rooms')
    .select('custom_rules')
    .eq('id', roomId)
    .single();

  if (error || !data) {
    return DEFAULT_RULES;
  }

  return (data.custom_rules as unknown as CustomRules) ?? DEFAULT_RULES;
};

// Check for active games the current user is participating in
export const checkActiveGame = async (): Promise<{
  hasActiveGame: boolean;
  roomCode?: string;
  roomId?: string;
  playerIndex?: number;
  playerName?: string;
  roomStatus?: string;
  source?: 'auth' | 'localStorage';
} | null> => {
  // First, try to find by authenticated user ID
  const userId = await getCurrentUserId();
  if (userId) {
    const { data: playerRecord, error } = await supabase
      .from('game_players')
      .select(`
        player_index,
        player_name,
        room_id,
        game_rooms!inner (
          id,
          room_code,
          status
        )
      `)
      .eq('user_id', userId)
      .in('game_rooms.status', ['waiting', 'playing'])
      .maybeSingle();

    if (!error && playerRecord) {
      const room = playerRecord.game_rooms as any;
      return {
        hasActiveGame: true,
        roomCode: room.room_code,
        roomId: room.id,
        playerIndex: playerRecord.player_index,
        playerName: playerRecord.player_name,
        roomStatus: room.status,
        source: 'auth',
      };
    }
  }

  // Fallback: Check localStorage for stored game info
  const storedGame = getActiveGameFromStorage();
  if (storedGame) {
    // Verify the room still exists and is active
    const { data: room, error: roomError } = await supabase
      .from('game_rooms')
      .select('id, room_code, status')
      .eq('id', storedGame.roomId)
      .in('status', ['waiting', 'playing'])
      .maybeSingle();

    if (!roomError && room) {
      // Verify player still exists in the room with matching name
      const { data: player } = await supabase
        .from('game_players_public')
        .select('player_index, player_name')
        .eq('room_id', room.id)
        .eq('player_name', storedGame.playerName)
        .maybeSingle();

      if (player) {
        return {
          hasActiveGame: true,
          roomCode: room.room_code,
          roomId: room.id,
          playerIndex: player.player_index,
          playerName: player.player_name,
          roomStatus: room.status,
          source: 'localStorage',
        };
      }
    }

    // Room no longer exists or player not found - clear stale data
    clearActiveGameFromStorage();
  }

  return null;
};

// Join an existing room (or rejoin if already a player)
export const joinRoom = async (
  roomCode: string,
  playerName: string
): Promise<{ success: boolean; roomId?: string; playerIndex?: number; maxPlayers?: number; error?: string; isRejoin?: boolean }> => {
  // Ensure we're authenticated
  const userId = await getOrCreateAuthSession();
  if (!userId) {
    return { success: false, error: 'Failed to authenticate' };
  }

  const sessionId = getSessionId(); // Keep for backward compatibility

  // Find the room
  const { data: room, error: roomError } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('room_code', roomCode.toUpperCase())
    .maybeSingle();

  if (roomError || !room) {
    return { success: false, error: 'Room not found' };
  }

  const maxPlayers = room.max_players || 4;

  // Check if this user already joined (check our own record first)
  const { data: myPlayer } = await supabase
    .from('game_players')
    .select('*')
    .eq('room_id', room.id)
    .eq('user_id', userId)
    .maybeSingle();

  // If user is already in the game, allow rejoin regardless of room status
  if (myPlayer) {
    // Mark as reconnected
    await supabase
      .from('game_players')
      .update({
        is_connected: true,
        last_seen_at: new Date().toISOString(),
        disconnected_at: null
      })
      .eq('id', myPlayer.id);

    // Save to localStorage for future recovery
    saveActiveGameToStorage({
      roomId: room.id,
      roomCode: room.room_code,
      playerName: myPlayer.player_name,
      playerIndex: myPlayer.player_index,
    });

    return {
      success: true,
      roomId: room.id,
      playerIndex: myPlayer.player_index,
      maxPlayers,
      isRejoin: room.status === 'playing'
    };
  }

  // If game has started, only allow rejoin by matching user_id (already handled above).
  // Name-based rejoin is removed for security — it allowed account takeover by guessing names.
  if (room.status !== 'waiting') {
    return { success: false, error: 'Game already in progress. You can only rejoin with the same account you used to join.' };
  }

  // Try to join with retry logic for race conditions
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Get current player count using the public view
    const { data: players, error: playersError } = await supabase
      .from('game_players_public')
      .select('player_index')
      .eq('room_id', room.id)
      .order('player_index');

    if (playersError) {
      return { success: false, error: 'Error checking players' };
    }

    if (players && players.length >= maxPlayers) {
      return { success: false, error: 'Room is full' };
    }

    // Find the next available player_index (handle gaps from players leaving)
    const usedIndices = new Set(players?.map(p => p.player_index) || []);
    let playerIndex = 0;
    while (usedIndices.has(playerIndex) && playerIndex < maxPlayers) {
      playerIndex++;
    }

    if (playerIndex >= maxPlayers) {
      return { success: false, error: 'Room is full' };
    }

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
      // Save to localStorage for future recovery
      saveActiveGameToStorage({
        roomId: room.id,
        roomCode: room.room_code,
        playerName: playerName,
        playerIndex: insertedPlayer.player_index,
      });

      return { success: true, roomId: room.id, playerIndex: insertedPlayer.player_index, maxPlayers };
    }

    // If it's a unique constraint violation, check if we're already in the game
    if (insertError?.code === '23505') {
      console.log(`Join attempt ${attempt + 1} failed due to unique constraint, checking if already joined...`);

      // Re-check if this user already joined (might have succeeded in parallel request/tab)
      const { data: existingPlayer } = await supabase
        .from('game_players')
        .select('*')
        .eq('room_id', room.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingPlayer) {
        console.log('User already in game, returning existing player');
        return { success: true, roomId: room.id, playerIndex: existingPlayer.player_index, maxPlayers };
      }

      // Not a duplicate user - must be a player_index race condition, retry
      console.log('Not a duplicate user, retrying with new player_index...');
      // Exponential backoff with random jitter to desynchronize concurrent requests
      const baseDelay = 150 * Math.pow(2, attempt);
      const jitter = Math.random() * 100;
      await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
      continue;
    }

    // Other error - fail immediately
    console.error('Error joining room:', insertError);
    return { success: false, error: 'Failed to join room' };
  }

  return { success: false, error: 'Failed to join room after multiple attempts' };
};

// Leave a room
export const leaveRoom = async (roomId: string): Promise<void> => {
  const userId = await getCurrentUserId();
  if (!userId) return;

  await supabase
    .from('game_players')
    .delete()
    .eq('room_id', roomId)
    .eq('user_id', userId);

  // Clear localStorage
  clearActiveGameFromStorage();
};

// Get room players (public info only - excludes tiles for security)
export const getRoomPlayers = async (roomId: string): Promise<{ id: string; player_name: string; player_index: number; is_ready: boolean }[]> => {
  const { data, error } = await supabase
    .from('game_players_public')
    .select('id, player_name, player_index, is_ready')
    .eq('room_id', roomId)
    .order('player_index');

  if (error) {
    console.error('Error fetching players:', error);
    return [];
  }

  return (data || []).map(p => ({
    id: p.id || '',
    player_name: p.player_name || '',
    player_index: p.player_index ?? 0,
    is_ready: p.is_ready ?? false,
  }));
};

// Toggle ready state for the current player
export const toggleReady = async (roomId: string): Promise<{ success: boolean; gameStarted?: boolean; error?: string }> => {
  const result = await executeGameAction('toggle_ready', roomId);
  return {
    success: result.success,
    gameStarted: result.data?.gameStarted,
    error: result.error,
  };
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
    mergerAdjacentChains: dbState.merger_adjacent_chains || null,
    stocksPurchasedThisTurn: dbState.stocks_purchased_this_turn,
    gameLog: dbState.game_log || [],
    winner: dbState.winner || null,
    endGameVotes: dbState.end_game_votes || [],
    roundNumber: dbState.round_number ?? 0,
    rulesSnapshot: (dbState.rules_snapshot as import('@/types/game').CustomRules) ?? null,
    turnDeadlineEpoch: dbState.turn_deadline_epoch ?? null,
    safeChainSize: (() => {
      const rs = dbState.rules_snapshot as import('@/types/game').CustomRules | null;
      if (!rs || !rs.chainSafetyEnabled) return 11;
      if (rs.chainSafetyThreshold === 'none') return null;
      return parseInt(rs.chainSafetyThreshold);
    })(),
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

// Send heartbeat to indicate player is still connected
export const sendHeartbeat = async (roomId: string): Promise<boolean> => {
  const userId = await getCurrentUserId();
  if (!userId) return false;

  const { error } = await supabase
    .from('game_players')
    .update({
      is_connected: true,
      last_seen_at: new Date().toISOString(),
      disconnected_at: null
    })
    .eq('room_id', roomId)
    .eq('user_id', userId);

  return !error;
};

// Mark player as disconnected
export const markDisconnected = async (roomId: string): Promise<void> => {
  const userId = await getCurrentUserId();
  if (!userId) return;

  await supabase
    .from('game_players')
    .update({
      is_connected: false,
      disconnected_at: new Date().toISOString()
    })
    .eq('room_id', roomId)
    .eq('user_id', userId);
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
