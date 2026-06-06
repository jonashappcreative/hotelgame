import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TileId } from '@/types/game';
import { DEFAULT_RULES } from '@/types/game';
import type { CustomRules } from '@/types/game';

// ---------------------------------------------------------------------------
// Hoisted mocks (must be created before any module imports)
// ---------------------------------------------------------------------------
const { mockApiFetch, mockGetUserIdFromToken, mockSignInAnonymous } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockGetUserIdFromToken: vi.fn(),
  mockSignInAnonymous: vi.fn(),
}));

const socketListeners: Record<string, Function> = {};
const { mockSocketEmit, mockSocketDisconnect, mockIo } = vi.hoisted(() => {
  const mockSocketEmit = vi.fn();
  const mockSocketDisconnect = vi.fn();
  const mockIo = vi.fn(() => ({
    on: vi.fn().mockImplementation((event: string, handler: Function) => {
      socketListeners[event] = handler;
    }),
    emit: mockSocketEmit,
    disconnect: mockSocketDisconnect,
  }));
  return { mockSocketEmit, mockSocketDisconnect, mockIo };
});

vi.mock('@/integrations/api/client', () => ({
  apiFetch: mockApiFetch,
  getUserIdFromToken: mockGetUserIdFromToken,
  signInAnonymous: mockSignInAnonymous,
  getToken: vi.fn(() => null),
  setToken: vi.fn(),
  clearToken: vi.fn(),
  decodeToken: vi.fn(),
  isAnonymousToken: vi.fn(),
}));

vi.mock('socket.io-client', () => ({
  io: mockIo,
}));

// Import after mocking
import {
  getOrCreateAuthSession,
  getCurrentUserId,
  getSessionId,
  createRoom,
  fetchRoomRules,
  joinRoom,
  leaveRoom,
  getRoomPlayers,
  toggleReady,
  getSecurePlayerData,
  executeGameAction,
  startGame,
  updateGameState,
  dbToGameState,
  subscribeToRoom,
} from './multiplayerService';

// ---------------------------------------------------------------------------
// Mock sessionStorage
// ---------------------------------------------------------------------------
const mockSessionStorage: Record<string, string> = {};
const sessionStorageMock = {
  getItem: vi.fn((key: string) => mockSessionStorage[key] || null),
  setItem: vi.fn((key: string, value: string) => { mockSessionStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockSessionStorage[key]; }),
  clear: vi.fn(() => { Object.keys(mockSessionStorage).forEach(k => delete mockSessionStorage[k]); }),
};
Object.defineProperty(global, 'sessionStorage', { value: sessionStorageMock });

vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'test-uuid-1234') });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('multiplayerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorageMock.clear();
    Object.keys(socketListeners).forEach(k => delete socketListeners[k]);
  });

  // ---- session helpers ------------------------------------------------------

  describe('getSessionId', () => {
    it('returns existing session ID from sessionStorage', () => {
      mockSessionStorage['acquire_session_id'] = 'existing-id';
      expect(getSessionId()).toBe('existing-id');
    });

    it('creates and stores new session ID if none exists', () => {
      const id = getSessionId();
      expect(id).toBe('test-uuid-1234');
      expect(sessionStorageMock.setItem).toHaveBeenCalledWith('acquire_session_id', 'test-uuid-1234');
    });
  });

  describe('getOrCreateAuthSession', () => {
    it('returns existing user ID when token is already valid', async () => {
      mockGetUserIdFromToken.mockReturnValue('existing-user-id');
      const userId = await getOrCreateAuthSession();
      expect(userId).toBe('existing-user-id');
      expect(mockSignInAnonymous).not.toHaveBeenCalled();
    });

    it('calls signInAnonymous when no token exists', async () => {
      mockGetUserIdFromToken.mockReturnValue(null);
      mockSignInAnonymous.mockResolvedValue('new-anon-id');
      const userId = await getOrCreateAuthSession();
      expect(userId).toBe('new-anon-id');
      expect(mockSignInAnonymous).toHaveBeenCalled();
    });

    it('returns null when anonymous sign-in fails', async () => {
      mockGetUserIdFromToken.mockReturnValue(null);
      mockSignInAnonymous.mockResolvedValue(null);
      const userId = await getOrCreateAuthSession();
      expect(userId).toBeNull();
    });
  });

  describe('getCurrentUserId', () => {
    it('returns user ID from token', async () => {
      mockGetUserIdFromToken.mockReturnValue('user-123');
      expect(await getCurrentUserId()).toBe('user-123');
    });

    it('returns null when no valid token', async () => {
      mockGetUserIdFromToken.mockReturnValue(null);
      expect(await getCurrentUserId()).toBeNull();
    });
  });

  // ---- room operations ------------------------------------------------------

  describe('createRoom', () => {
    beforeEach(() => {
      mockGetUserIdFromToken.mockReturnValue('user-id');
    });

    it('returns room details on success', async () => {
      mockApiFetch.mockResolvedValue({
        ok: true,
        data: { roomCode: 'ABC123', roomId: 'room-id', maxPlayers: 4 },
        error: null,
      });

      const result = await createRoom(4);
      expect(result).toEqual({ roomCode: 'ABC123', roomId: 'room-id', maxPlayers: 4 });
      expect(mockApiFetch).toHaveBeenCalledWith('/rooms', expect.objectContaining({ op: 'create', maxPlayers: 4 }));
    });

    it('returns null when authentication fails', async () => {
      mockGetUserIdFromToken.mockReturnValue(null);
      mockSignInAnonymous.mockResolvedValue(null);
      expect(await createRoom()).toBeNull();
      expect(mockApiFetch).not.toHaveBeenCalled();
    });

    it('returns null when API fails', async () => {
      mockApiFetch.mockResolvedValue({ ok: false, data: null, error: 'Server error' });
      expect(await createRoom()).toBeNull();
    });

    it('passes customRules to the API', async () => {
      const rules: CustomRules = { ...DEFAULT_RULES, turnTimerEnabled: true, turnTimer: '30' };
      mockApiFetch.mockResolvedValue({
        ok: true, data: { roomCode: 'XYZ', roomId: 'r1', maxPlayers: 4 }, error: null,
      });
      await createRoom(4, rules);
      expect(mockApiFetch).toHaveBeenCalledWith('/rooms', expect.objectContaining({ customRules: rules }));
    });
  });

  describe('fetchRoomRules', () => {
    it('returns stored rules when they exist', async () => {
      const stored: CustomRules = { ...DEFAULT_RULES, turnTimerEnabled: true };
      mockApiFetch.mockResolvedValue({ ok: true, data: { customRules: stored }, error: null });
      expect(await fetchRoomRules('room-id')).toEqual(stored);
    });

    it('returns DEFAULT_RULES when customRules is null', async () => {
      mockApiFetch.mockResolvedValue({ ok: true, data: { customRules: null }, error: null });
      expect(await fetchRoomRules('room-id')).toEqual(DEFAULT_RULES);
    });

    it('returns DEFAULT_RULES when API fails', async () => {
      mockApiFetch.mockResolvedValue({ ok: false, data: null, error: 'Not found' });
      expect(await fetchRoomRules('nonexistent')).toEqual(DEFAULT_RULES);
    });
  });

  describe('joinRoom', () => {
    beforeEach(() => {
      mockGetUserIdFromToken.mockReturnValue('user-id');
    });

    it('returns success with room details on join', async () => {
      mockApiFetch.mockResolvedValue({
        ok: true,
        data: { success: true, roomId: 'room-id', playerIndex: 1, maxPlayers: 4, isRejoin: false },
        error: null,
      });

      const result = await joinRoom('ABC123', 'Player 1');
      expect(result.success).toBe(true);
      expect(result.roomId).toBe('room-id');
      expect(result.playerIndex).toBe(1);
      expect(mockApiFetch).toHaveBeenCalledWith('/rooms', expect.objectContaining({
        op: 'join', roomCode: 'ABC123', playerName: 'Player 1',
      }));
    });

    it('returns error when authentication fails', async () => {
      mockGetUserIdFromToken.mockReturnValue(null);
      mockSignInAnonymous.mockResolvedValue(null);
      const result = await joinRoom('ABC123', 'Player 1');
      expect(result).toEqual({ success: false, error: 'Failed to authenticate' });
    });

    it('returns error when API returns failure', async () => {
      mockApiFetch.mockResolvedValue({ ok: false, data: null, error: 'Room not found' });
      const result = await joinRoom('INVALID', 'Player 1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Room not found');
    });

    it('upcases the room code before sending', async () => {
      mockApiFetch.mockResolvedValue({
        ok: true,
        data: { success: true, roomId: 'r', playerIndex: 0, maxPlayers: 4 },
        error: null,
      });
      await joinRoom('abc123', 'Player');
      expect(mockApiFetch).toHaveBeenCalledWith('/rooms', expect.objectContaining({ roomCode: 'ABC123' }));
    });
  });

  describe('leaveRoom', () => {
    it('calls API with leave op', async () => {
      mockApiFetch.mockResolvedValue({ ok: true, data: { success: true }, error: null });
      await leaveRoom('room-id');
      expect(mockApiFetch).toHaveBeenCalledWith('/rooms', expect.objectContaining({ op: 'leave', roomId: 'room-id' }));
    });
  });

  describe('getRoomPlayers', () => {
    it('returns formatted player list on success', async () => {
      mockApiFetch.mockResolvedValue({
        ok: true,
        data: {
          players: [
            { id: 'p1', player_name: 'Alice', player_index: 0, is_ready: true },
            { id: 'p2', player_name: 'Bob',   player_index: 1, is_ready: false },
          ],
        },
        error: null,
      });

      const players = await getRoomPlayers('room-id');
      expect(players).toEqual([
        { id: 'p1', player_name: 'Alice', player_index: 0, is_ready: true },
        { id: 'p2', player_name: 'Bob',   player_index: 1, is_ready: false },
      ]);
    });

    it('returns empty array on API error', async () => {
      mockApiFetch.mockResolvedValue({ ok: false, data: null, error: 'error' });
      expect(await getRoomPlayers('room-id')).toEqual([]);
    });

    it('fills in defaults for missing fields', async () => {
      mockApiFetch.mockResolvedValue({
        ok: true,
        data: { players: [{ id: null, player_name: null, player_index: null, is_ready: null }] },
        error: null,
      });
      const players = await getRoomPlayers('room-id');
      expect(players).toEqual([{ id: '', player_name: '', player_index: 0, is_ready: false }]);
    });
  });

  // ---- game actions ---------------------------------------------------------

  describe('executeGameAction', () => {
    it('sends action to /game-action and returns data', async () => {
      mockApiFetch.mockResolvedValue({ ok: true, data: { success: true, extra: 'val' }, error: null });
      const result = await executeGameAction('place_tile', 'room-id', { tileId: '5F' });
      expect(mockApiFetch).toHaveBeenCalledWith('/game-action', {
        action: 'place_tile', roomId: 'room-id', payload: { tileId: '5F' },
      });
      expect(result).toEqual({ success: true, extra: 'val' });
    });

    it('returns error on HTTP failure', async () => {
      mockApiFetch.mockResolvedValue({ ok: false, data: null, error: 'Network error' });
      const result = await executeGameAction('place_tile', 'room-id');
      expect(result).toEqual({ success: false, error: 'Network error' });
    });

    it('returns error from data.error field', async () => {
      mockApiFetch.mockResolvedValue({ ok: true, data: { error: 'Not your turn' }, error: null });
      const result = await executeGameAction('place_tile', 'room-id');
      expect(result).toEqual({ success: false, error: 'Not your turn' });
    });

    it('returns { success: true } when data is null but ok', async () => {
      mockApiFetch.mockResolvedValue({ ok: true, data: null, error: null });
      const result = await executeGameAction('skip_buy', 'room-id');
      expect(result).toEqual({ success: true });
    });
  });

  describe('toggleReady', () => {
    it('delegates to executeGameAction and surfaces gameStarted', async () => {
      mockApiFetch.mockResolvedValue({
        ok: true, data: { success: true, data: { gameStarted: true } }, error: null,
      });
      const result = await toggleReady('room-id');
      expect(mockApiFetch).toHaveBeenCalledWith('/game-action', expect.objectContaining({ action: 'toggle_ready' }));
      expect(result.success).toBe(true);
    });
  });

  describe('startGame', () => {
    it('calls start_game action and returns true on success', async () => {
      mockApiFetch.mockResolvedValue({ ok: true, data: { success: true }, error: null });
      expect(await startGame('room-id', {} as any)).toBe(true);
    });

    it('returns false on failure', async () => {
      mockApiFetch.mockResolvedValue({ ok: false, data: null, error: 'err' });
      expect(await startGame('room-id', {} as any)).toBe(false);
    });
  });

  describe('updateGameState', () => {
    it('returns true (backward-compat stub)', async () => {
      expect(await updateGameState('room-id', {} as any)).toBe(true);
    });
  });

  describe('getSecurePlayerData', () => {
    it('returns player list from API', async () => {
      const players = [
        { id: 'p1', player_name: 'Alice', player_index: 0, tiles: ['1A', '2B'], cash: 6000, stocks: {} },
        { id: 'p2', player_name: 'Bob',   player_index: 1, tiles: [], cash: 5500, stocks: {} },
      ];
      mockApiFetch.mockResolvedValue({ ok: true, data: { players }, error: null });
      const result = await getSecurePlayerData('room-id');
      expect(result).toEqual(players);
      expect(mockApiFetch).toHaveBeenCalledWith('/rooms', expect.objectContaining({ op: 'get_players', roomId: 'room-id' }));
    });

    it('returns empty array on error', async () => {
      mockApiFetch.mockResolvedValue({ ok: false, data: null, error: 'err' });
      expect(await getSecurePlayerData('room-id')).toEqual([]);
    });
  });

  // ---- subscribeToRoom ------------------------------------------------------

  describe('subscribeToRoom', () => {
    it('returns a no-op cleanup when VITE_WS_URL is not set', () => {
      vi.stubEnv('VITE_WS_URL', '');
      const cleanup = subscribeToRoom('room-id', vi.fn(), vi.fn(), vi.fn());
      expect(mockIo).not.toHaveBeenCalled();
      cleanup(); // should not throw
      vi.unstubAllEnvs();
    });

    it('connects to VITE_WS_URL and joins room on connect', () => {
      vi.stubEnv('VITE_WS_URL', 'wss://test.example.com');
      subscribeToRoom('room-id', vi.fn(), vi.fn(), vi.fn());

      expect(mockIo).toHaveBeenCalledWith('wss://test.example.com', expect.objectContaining({ transports: ['websocket'] }));

      // Simulate connect event
      socketListeners['connect']?.();
      expect(mockSocketEmit).toHaveBeenCalledWith('join_room', 'room-id');
      vi.unstubAllEnvs();
    });

    it('registers listeners for game:players_changed, game:state_updated, room:status_changed', () => {
      vi.stubEnv('VITE_WS_URL', 'wss://test.example.com');
      subscribeToRoom('room-id', vi.fn(), vi.fn(), vi.fn());

      expect(socketListeners).toHaveProperty('game:players_changed');
      expect(socketListeners).toHaveProperty('game:state_updated');
      expect(socketListeners).toHaveProperty('room:status_changed');
      vi.unstubAllEnvs();
    });

    it('cleanup emits leave_room and disconnects', () => {
      vi.stubEnv('VITE_WS_URL', 'wss://test.example.com');
      const cleanup = subscribeToRoom('room-id', vi.fn(), vi.fn(), vi.fn());
      cleanup();
      expect(mockSocketEmit).toHaveBeenCalledWith('leave_room', 'room-id');
      expect(mockSocketDisconnect).toHaveBeenCalled();
      vi.unstubAllEnvs();
    });

    it('fetches players from API when game:players_changed fires', async () => {
      vi.stubEnv('VITE_WS_URL', 'wss://test.example.com');
      const onPlayers = vi.fn();
      mockApiFetch.mockResolvedValue({
        ok: true,
        data: { players: [{ id: 'p1', player_name: 'Alice', player_index: 0, is_ready: true }] },
        error: null,
      });
      subscribeToRoom('room-id', onPlayers, vi.fn(), vi.fn());
      await socketListeners['game:players_changed']?.();
      expect(onPlayers).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'p1' })]));
      vi.unstubAllEnvs();
    });

    it('fetches room status from API when room:status_changed fires', async () => {
      vi.stubEnv('VITE_WS_URL', 'wss://test.example.com');
      const onStatus = vi.fn();
      mockApiFetch.mockResolvedValue({
        ok: true,
        data: { room: { status: 'playing', max_players: 4 } },
        error: null,
      });
      subscribeToRoom('room-id', vi.fn(), vi.fn(), onStatus);
      await socketListeners['room:status_changed']?.();
      expect(onStatus).toHaveBeenCalledWith('playing');
      vi.unstubAllEnvs();
    });
  });

  // ---- dbToGameState (pure function) ----------------------------------------

  describe('dbToGameState', () => {
    it('converts database state to GameState', () => {
      const dbState = {
        board: {
          '1A': { id: '1A', placed: true, chain: null },
          '5F': { id: '5F', placed: true, chain: 'sackson' },
        },
        current_player_index: 2,
        phase: 'buy_stock',
        chains: {
          sackson:    { name: 'sackson',    tiles: ['5F'], isActive: true,  isSafe: false },
          tower:      { name: 'tower',      tiles: [],     isActive: false, isSafe: false },
          worldwide:  { name: 'worldwide',  tiles: [],     isActive: false, isSafe: false },
          american:   { name: 'american',   tiles: [],     isActive: false, isSafe: false },
          festival:   { name: 'festival',   tiles: [],     isActive: false, isSafe: false },
          continental:{ name: 'continental',tiles: [],     isActive: false, isSafe: false },
          imperial:   { name: 'imperial',   tiles: [],     isActive: false, isSafe: false },
        },
        stock_bank: { sackson: 24, tower: 25, worldwide: 25, american: 25, festival: 25, continental: 25, imperial: 25 },
        tile_bag: ['2A', '3B'],
        last_placed_tile: '5F',
        pending_chain_foundation: null,
        merger: null,
        stocks_purchased_this_turn: 1,
        game_log: [{ timestamp: 12345, playerId: 'p1', playerName: 'Alice', action: 'Started' }],
        winner: null,
        end_game_votes: [],
      };

      const players = [
        { player_index: 0, player_name: 'Alice', cash: 6000, tiles: ['1B', '2C'], stocks: { sackson: 1 }, is_connected: true },
        { player_index: 1, player_name: 'Bob',   cash: 5800, tiles: ['3D'],       stocks: { tower: 2 },   is_connected: true },
      ];

      const result = dbToGameState(dbState, players, 'XYZ123');

      expect(result.roomCode).toBe('XYZ123');
      expect(result.currentPlayerIndex).toBe(2);
      expect(result.phase).toBe('buy_stock');
      expect(result.board.size).toBe(2);
      expect(result.board.get('1A' as TileId)).toEqual({ id: '1A', placed: true, chain: null });
      expect(result.board.get('5F' as TileId)).toEqual({ id: '5F', placed: true, chain: 'sackson' });
      expect(result.players).toHaveLength(2);
      expect(result.players[0].name).toBe('Alice');
      expect(result.players[0].id).toBe('player-0');
      expect(result.players[0].cash).toBe(6000);
      expect(result.players[0].tiles).toEqual(['1B', '2C']);
      expect(result.players[1].name).toBe('Bob');
      expect(result.chains.sackson.isActive).toBe(true);
      expect(result.stockBank.sackson).toBe(24);
      expect(result.tileBag).toEqual(['2A', '3B']);
      expect(result.lastPlacedTile).toBe('5F');
      expect(result.stocksPurchasedThisTurn).toBe(1);
      expect(result.gameLog).toHaveLength(1);
    });

    it('handles missing board data gracefully', () => {
      const dbState = {
        board: null,
        current_player_index: 0,
        phase: 'place_tile',
        chains: {},
        stock_bank: {},
        tile_bag: null,
        last_placed_tile: null,
        pending_chain_foundation: null,
        merger: null,
        stocks_purchased_this_turn: 0,
        game_log: null,
        winner: null,
        end_game_votes: null,
      };

      const result = dbToGameState(dbState, [], 'ABC123');
      expect(result.board.size).toBe(0);
      expect(result.tileBag).toEqual([]);
      expect(result.gameLog).toEqual([]);
      expect(result.endGameVotes).toEqual([]);
    });

    it('fills in default stocks when player stocks are null', () => {
      const dbState = {
        board: {}, current_player_index: 0, phase: 'place_tile',
        chains: {}, stock_bank: {}, tile_bag: [],
        stocks_purchased_this_turn: 0, game_log: [],
      };

      const players = [
        { player_index: 0, player_name: 'Alice', cash: 6000, tiles: null, stocks: null, is_connected: true },
      ];

      const result = dbToGameState(dbState, players, 'ABC123');
      expect(result.players[0].tiles).toEqual([]);
      expect(result.players[0].stocks).toEqual({
        sackson: 0, tower: 0, worldwide: 0, american: 0,
        festival: 0, continental: 0, imperial: 0,
      });
    });
  });
});
