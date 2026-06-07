import { io, type Socket } from 'socket.io-client';
import {
  apiFetch,
  getUserIdFromToken,
  signInAnonymous,
} from '@/integrations/api/client';
import { GameState, ChainName, TileId, TileState, PlayerState, ChainState, CustomRules, DEFAULT_RULES } from '@/types/game';

// Get or create an authenticated session (anonymous or existing user)
export const getOrCreateAuthSession = async (): Promise<string | null> => {
  const existing = getUserIdFromToken();
  if (existing) return existing;
  return await signInAnonymous();
};

// Get current user ID from the stored token (must be authenticated first)
export const getCurrentUserId = async (): Promise<string | null> => {
  return getUserIdFromToken();
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

  const { ok, data, error } = await apiFetch<{ roomCode: string; roomId: string; maxPlayers: number }>(
    '/rooms', { op: 'create', maxPlayers, customRules },
  );

  if (!ok || !data) {
    console.error('Error creating room:', error);
    return null;
  }

  return { roomCode: data.roomCode, roomId: data.roomId, maxPlayers: data.maxPlayers };
};

// Fetch the custom rules for a room (returns DEFAULT_RULES if none are set)
export const fetchRoomRules = async (roomId: string): Promise<CustomRules> => {
  const { ok, data } = await apiFetch<{ customRules: CustomRules | null }>(
    '/rooms', { op: 'get_rules', roomId },
  );
  if (!ok || !data?.customRules) return DEFAULT_RULES;
  return data.customRules;
};

// Fetch room metadata (status, max_players, ...)
export const getRoomStatus = async (
  roomId: string,
): Promise<{ status: 'waiting' | 'playing' | 'finished'; max_players: number } | null> => {
  const { ok, data } = await apiFetch<{ room: any }>('/rooms', { op: 'get_room', roomId });
  if (!ok || !data?.room) return null;
  return { status: data.room.status, max_players: data.room.max_players ?? 4 };
};

// Fetch the public game state (tile_bag excluded by the backend view)
export const getPublicGameState = async (roomId: string): Promise<any | null> => {
  const { ok, data } = await apiFetch<{ state: any }>('/rooms', { op: 'get_state', roomId });
  if (!ok) return null;
  return data?.state ?? null;
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
    const { ok, data } = await apiFetch<{ active: any }>('/rooms', { op: 'find_active' });
    if (ok && data?.active) {
      const a = data.active;
      return {
        hasActiveGame: true,
        roomCode: a.room_code,
        roomId: a.room_id,
        playerIndex: a.player_index,
        playerName: a.player_name,
        roomStatus: a.status,
        source: 'auth',
      };
    }
  }

  // Fallback: Check localStorage for stored game info
  const storedGame = getActiveGameFromStorage();
  if (storedGame) {
    // Verify the room still exists and is active
    const room = await getRoomStatus(storedGame.roomId);
    if (room && (room.status === 'waiting' || room.status === 'playing')) {
      // Verify the stored player still exists in the room (by name)
      const players = await getRoomPlayers(storedGame.roomId);
      const player = players.find((p) => p.player_name === storedGame.playerName);
      if (player) {
        return {
          hasActiveGame: true,
          roomCode: storedGame.roomCode,
          roomId: storedGame.roomId,
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

  const { ok, data, error } = await apiFetch<{
    success: boolean; roomId: string; playerIndex: number; maxPlayers: number; isRejoin?: boolean;
  }>('/rooms', { op: 'join', roomCode: roomCode.toUpperCase(), playerName, sessionId });

  if (!ok || !data?.success) {
    return { success: false, error: error || 'Failed to join room' };
  }

  // Save to localStorage for future recovery
  saveActiveGameToStorage({
    roomId: data.roomId,
    roomCode: roomCode.toUpperCase(),
    playerName,
    playerIndex: data.playerIndex,
  });

  return {
    success: true,
    roomId: data.roomId,
    playerIndex: data.playerIndex,
    maxPlayers: data.maxPlayers,
    isRejoin: data.isRejoin,
  };
};

// Leave a room
export const leaveRoom = async (roomId: string): Promise<void> => {
  await apiFetch('/rooms', { op: 'leave', roomId });
  // Clear localStorage
  clearActiveGameFromStorage();
};

export interface RoomPlayer {
  id: string;
  player_name: string;
  player_index: number;
  is_ready: boolean;
  is_bot: boolean;
  bot_difficulty: string | null;
}

// Get room players (public info only - excludes tiles for security)
export const getRoomPlayers = async (roomId: string): Promise<RoomPlayer[]> => {
  const { ok, data } = await apiFetch<{ players: any[] }>('/rooms', { op: 'list_players', roomId });
  if (!ok || !data?.players) {
    return [];
  }

  return data.players.map((p) => ({
    id: p.id || '',
    player_name: p.player_name || '',
    player_index: p.player_index ?? 0,
    is_ready: p.is_ready ?? false,
    is_bot: p.is_bot ?? false,
    bot_difficulty: p.bot_difficulty ?? null,
  }));
};

// Add an AI bot to the room (host only). difficulty: 'easy' | 'medium' | 'hard'.
export const addBot = async (
  roomId: string,
  difficulty: 'easy' | 'medium' | 'hard',
): Promise<{ success: boolean; error?: string }> => {
  const { ok, error } = await apiFetch('/rooms', { op: 'add_bot', roomId, difficulty });
  return ok ? { success: true } : { success: false, error: error || 'Failed to add bot' };
};

// Remove a bot from the room by seat (host only).
export const removeBot = async (
  roomId: string,
  playerIndex: number,
): Promise<{ success: boolean; error?: string }> => {
  const { ok, error } = await apiFetch('/rooms', { op: 'remove_bot', roomId, playerIndex });
  return ok ? { success: true } : { success: false, error: error || 'Failed to remove bot' };
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
  const { ok, data } = await apiFetch<{ players: any[] }>('/rooms', { op: 'get_players', roomId });
  if (!ok || !data?.players) {
    return [];
  }
  return data.players;
};

// Execute a game action via the serverless function
export const executeGameAction = async (
  action: string,
  roomId: string,
  payload?: any
): Promise<{ success: boolean; error?: string; data?: any }> => {
  const { ok, data, error } = await apiFetch('/game-action', { action, roomId, payload });

  if (!ok) {
    console.error('Game action error:', error);
    return { success: false, error: error || 'Game action failed' };
  }

  if (data?.error) {
    return { success: false, error: data.error };
  }

  return data || { success: true };
};

// Start the game via the serverless function
export const startGame = async (roomId: string, gameState: GameState): Promise<boolean> => {
  const result = await executeGameAction('start_game', roomId);
  return result.success;
};

// Update game state via serverless function (for actions that need state update)
export const updateGameState = async (roomId: string, gameState: GameState): Promise<boolean> => {
  // This is now handled by the serverless function for each specific action
  // Kept for compatibility but the function handles updates
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
      if (!rs || !rs.chainSafetyEnabled) return null;
      if (rs.chainSafetyThreshold === 'none') return null;
      return parseInt(rs.chainSafetyThreshold);
    })(),
    boardRows: (() => {
      const rs = dbState.rules_snapshot as import('@/types/game').CustomRules | null;
      return rs?.boardSizeEnabled && rs?.boardSize === '6x10' ? 6 : 9;
    })(),
    boardCols: (() => {
      const rs = dbState.rules_snapshot as import('@/types/game').CustomRules | null;
      const count = rs?.boardSizeEnabled && rs?.boardSize === '6x10' ? 10 : 12;
      return ['A','B','C','D','E','F','G','H','I','J','K','L'].slice(0, count);
    })(),
  };
};

// Subscribe to room changes via the Hetzner Socket.io relay.
// The relay only signals *that* something changed; we fetch the authoritative
// (public) data from the API in response — the same model as before.
export const subscribeToRoom = (
  roomId: string,
  onPlayersChange: (players: any[]) => void,
  onGameStateChange: (state: any) => void,
  onRoomStatusChange: (status: string) => void
) => {
  const wsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  if (!wsUrl) {
    console.error('[subscribeToRoom] VITE_WS_URL is not set; realtime disabled');
    return () => {};
  }

  const socket: Socket = io(wsUrl, { transports: ['websocket'] });

  const joinRoomChannel = () => socket.emit('join_room', roomId);
  socket.on('connect', joinRoomChannel);

  socket.on('game:players_changed', async () => {
    const players = await getRoomPlayers(roomId);
    onPlayersChange(players);
  });

  socket.on('game:state_updated', async () => {
    const state = await getPublicGameState(roomId);
    if (state) onGameStateChange(state);
  });

  socket.on('room:status_changed', async () => {
    const room = await getRoomStatus(roomId);
    if (room) onRoomStatusChange(room.status);
  });

  return () => {
    socket.emit('leave_room', roomId);
    socket.disconnect();
  };
};

// Send heartbeat to indicate player is still connected
export const sendHeartbeat = async (roomId: string): Promise<boolean> => {
  const { ok } = await apiFetch('/rooms', { op: 'heartbeat', roomId });
  return ok;
};

// Mark player as disconnected (keepalive so it survives page unload)
export const markDisconnected = async (roomId: string): Promise<void> => {
  await apiFetch('/rooms', { op: 'disconnect', roomId }, { keepalive: true });
};
