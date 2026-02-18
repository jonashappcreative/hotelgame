import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TileId, TileState, ChainName, ChainState } from '@/types/game';
import { DEFAULT_RULES } from '@/types/game';
import type { CustomRules } from '@/types/game';

// Use vi.hoisted to create mock functions that are available during mock hoisting
const { mockGetUser, mockSignInAnonymously, mockFrom, mockFunctionsInvoke, mockChannel, mockRemoveChannel } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSignInAnonymously: vi.fn(),
  mockFrom: vi.fn(),
  mockFunctionsInvoke: vi.fn(),
  mockChannel: vi.fn(),
  mockRemoveChannel: vi.fn(),
}));

// Mock the Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: mockGetUser,
      signInAnonymously: mockSignInAnonymously,
    },
    from: mockFrom,
    functions: {
      invoke: mockFunctionsInvoke,
    },
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  },
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

// Mock sessionStorage
const mockSessionStorage: Record<string, string> = {};
const sessionStorageMock = {
  getItem: vi.fn((key: string) => mockSessionStorage[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    mockSessionStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockSessionStorage[key];
  }),
  clear: vi.fn(() => {
    Object.keys(mockSessionStorage).forEach(key => delete mockSessionStorage[key]);
  }),
};

// Mock crypto.randomUUID
const mockUUID = 'test-uuid-1234-5678-9012';
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => mockUUID),
});

Object.defineProperty(global, 'sessionStorage', {
  value: sessionStorageMock,
});

describe('multiplayerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorageMock.clear();
  });

  describe('getSessionId', () => {
    it('should return existing session ID from sessionStorage', () => {
      mockSessionStorage['acquire_session_id'] = 'existing-session-id';

      const sessionId = getSessionId();

      expect(sessionId).toBe('existing-session-id');
      expect(sessionStorageMock.getItem).toHaveBeenCalledWith('acquire_session_id');
    });

    it('should create and store new session ID if none exists', () => {
      const sessionId = getSessionId();

      expect(sessionId).toBe(mockUUID);
      expect(sessionStorageMock.setItem).toHaveBeenCalledWith('acquire_session_id', mockUUID);
    });
  });

  describe('getOrCreateAuthSession', () => {
    it('should return existing user ID if already authenticated', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'existing-user-id' } },
      });

      const userId = await getOrCreateAuthSession();

      expect(userId).toBe('existing-user-id');
      expect(mockSignInAnonymously).not.toHaveBeenCalled();
    });

    it('should sign in anonymously if no existing session', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
      });
      mockSignInAnonymously.mockResolvedValue({
        data: { user: { id: 'new-anonymous-user-id' } },
        error: null,
      });

      const userId = await getOrCreateAuthSession();

      expect(userId).toBe('new-anonymous-user-id');
      expect(mockSignInAnonymously).toHaveBeenCalled();
    });

    it('should return null if anonymous sign-in fails', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
      });
      mockSignInAnonymously.mockResolvedValue({
        data: { user: null },
        error: { message: 'Auth failed' },
      });

      const userId = await getOrCreateAuthSession();

      expect(userId).toBeNull();
    });
  });

  describe('getCurrentUserId', () => {
    it('should return user ID if authenticated', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'current-user-id' } },
      });

      const userId = await getCurrentUserId();

      expect(userId).toBe('current-user-id');
    });

    it('should return null if not authenticated', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
      });

      const userId = await getCurrentUserId();

      expect(userId).toBeNull();
    });
  });

  describe('createRoom', () => {
    it('should create a room and return room details', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
      });

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'room-id', room_code: 'ABC123', max_players: 4 },
            error: null,
          }),
        }),
      });
      mockFrom.mockReturnValue({ insert: mockInsert });

      const result = await createRoom(4);

      expect(result).toEqual({
        roomCode: 'ABC123',
        roomId: 'room-id',
        maxPlayers: 4,
      });
      expect(mockFrom).toHaveBeenCalledWith('game_rooms');
    });

    it('should return null if authentication fails', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
      });
      mockSignInAnonymously.mockResolvedValue({
        data: { user: null },
        error: { message: 'Auth failed' },
      });

      const result = await createRoom();

      expect(result).toBeNull();
    });

    it('should return null if database insert fails', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
      });

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Insert failed' },
          }),
        }),
      });
      mockFrom.mockReturnValue({ insert: mockInsert });

      const result = await createRoom();

      expect(result).toBeNull();
    });

    it('should insert custom_rules when explicit CustomRules provided', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-id' } } });

      const customRules: CustomRules = {
        ...DEFAULT_RULES,
        turnTimerEnabled: true,
        turnTimer: '30',
      };

      let capturedPayload: any;
      const mockInsert = vi.fn().mockImplementation((payload: any) => {
        capturedPayload = payload;
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'room-id', room_code: 'XYZ789', max_players: 4 },
              error: null,
            }),
          }),
        };
      });
      mockFrom.mockReturnValue({ insert: mockInsert });

      await createRoom(4, customRules);

      expect(capturedPayload.custom_rules).toEqual(customRules);
    });

    it('should insert DEFAULT_RULES as custom_rules when called with DEFAULT_RULES', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-id' } } });

      let capturedPayload: any;
      const mockInsert = vi.fn().mockImplementation((payload: any) => {
        capturedPayload = payload;
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'room-id', room_code: 'DEF456', max_players: 2 },
              error: null,
            }),
          }),
        };
      });
      mockFrom.mockReturnValue({ insert: mockInsert });

      await createRoom(2, DEFAULT_RULES);

      expect(capturedPayload.custom_rules).toEqual(DEFAULT_RULES);
    });
  });

  describe('fetchRoomRules', () => {
    it('should return stored rules when custom_rules exists', async () => {
      const storedRules: CustomRules = { ...DEFAULT_RULES, turnTimerEnabled: true };

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { custom_rules: storedRules },
              error: null,
            }),
          }),
        }),
      });

      const result = await fetchRoomRules('room-id-123');

      expect(result).toEqual(storedRules);
    });

    it('should return DEFAULT_RULES when custom_rules is NULL', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { custom_rules: null },
              error: null,
            }),
          }),
        }),
      });

      const result = await fetchRoomRules('room-id-456');

      expect(result).toEqual(DEFAULT_RULES);
    });

    it('should return DEFAULT_RULES when the database query fails', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Not found' },
            }),
          }),
        }),
      });

      const result = await fetchRoomRules('nonexistent-room');

      expect(result).toEqual(DEFAULT_RULES);
    });
  });

  describe('joinRoom', () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
      });
    });

    it('should return error if room not found', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'game_rooms') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await joinRoom('INVALID', 'Player 1');

      expect(result).toEqual({ success: false, error: 'Room not found' });
    });

    it('should return error if game already started', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'game_rooms') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'room-id', status: 'playing', max_players: 4 },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await joinRoom('ABC123', 'Player 1');

      expect(result).toEqual({ success: false, error: 'Game already started' });
    });

    it('should return existing player data if already joined', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'game_rooms') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'room-id', status: 'waiting', max_players: 4 },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'game_players') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { player_index: 1 },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await joinRoom('ABC123', 'Player 1');

      expect(result).toEqual({
        success: true,
        roomId: 'room-id',
        playerIndex: 1,
        maxPlayers: 4,
      });
    });

    it('should return error when room is full', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'game_rooms') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'room-id', status: 'waiting', max_players: 4 },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'game_players') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null, // User not already in game
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'game_players_public') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [
                    { player_index: 0 },
                    { player_index: 1 },
                    { player_index: 2 },
                    { player_index: 3 },
                  ], // Room has 4 players already
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await joinRoom('ABC123', 'Player 5');

      expect(result).toEqual({ success: false, error: 'Room is full' });
    });

    it('should handle unique constraint violation (23505) when user already joined from another tab', async () => {
      let insertCallCount = 0;
      let checkExistingCallCount = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'game_rooms') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'room-id', status: 'waiting', max_players: 4 },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'game_players') {
          // Track calls to distinguish between initial check and post-error check
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockImplementation(async () => {
                    checkExistingCallCount++;
                    if (checkExistingCallCount === 1) {
                      // First check: user not in game yet
                      return { data: null, error: null };
                    }
                    // After unique constraint error: user was added by another tab
                    return { data: { player_index: 0, user_id: 'user-id' }, error: null };
                  }),
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockImplementation(async () => {
                  insertCallCount++;
                  // Simulate unique constraint violation (user_id already exists)
                  return {
                    data: null,
                    error: { code: '23505', message: 'Unique constraint violation' },
                  };
                }),
              }),
            }),
          };
        }
        if (table === 'game_players_public') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [{ player_index: 0 }], // One player already in room
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await joinRoom('ABC123', 'Player 1');

      // Should succeed because after the constraint error, re-check found the user
      expect(result.success).toBe(true);
      expect(result.playerIndex).toBe(0);
    });

    it('should retry with new player_index on constraint violation from index race condition', async () => {
      let insertCallCount = 0;

      mockFrom.mockImplementation((table: string) => {
        if (table === 'game_rooms') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'room-id', status: 'waiting', max_players: 4 },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'game_players') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null, // User never found (different user caused constraint)
                    error: null,
                  }),
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockImplementation(async () => {
                  insertCallCount++;
                  if (insertCallCount < 3) {
                    // First 2 attempts: player_index race condition
                    return {
                      data: null,
                      error: { code: '23505', message: 'Unique constraint on player_index' },
                    };
                  }
                  // Third attempt succeeds
                  return {
                    data: { player_index: 2, user_id: 'user-id' },
                    error: null,
                  };
                }),
              }),
            }),
          };
        }
        if (table === 'game_players_public') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockImplementation(async () => {
                  // Simulate changing player list (race condition)
                  return {
                    data: [{ player_index: 0 }, { player_index: 1 }],
                    error: null,
                  };
                }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await joinRoom('ABC123', 'Player 3');

      expect(result.success).toBe(true);
      expect(insertCallCount).toBeGreaterThan(1); // Should have retried
    }, 10000); // Longer timeout due to exponential backoff

    it('should fail after max retries exhausted', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'game_rooms') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'room-id', status: 'waiting', max_players: 4 },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'game_players') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null, // User never found
                    error: null,
                  }),
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: '23505', message: 'Unique constraint' },
                }),
              }),
            }),
          };
        }
        if (table === 'game_players_public') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [{ player_index: 0 }],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await joinRoom('ABC123', 'Player 2');

      expect(result).toEqual({
        success: false,
        error: 'Failed to join room after multiple attempts',
      });
    }, 30000); // Long timeout for 5 retries with exponential backoff

    it('should return error when checking players fails', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'game_rooms') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'room-id', status: 'waiting', max_players: 4 },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'game_players') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'game_players_public') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Database error' },
                }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await joinRoom('ABC123', 'Player 1');

      expect(result).toEqual({ success: false, error: 'Error checking players' });
    });

    it('should fail immediately on non-unique-constraint errors', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'game_rooms') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'room-id', status: 'waiting', max_players: 4 },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'game_players') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: '42501', message: 'Permission denied' }, // Not a unique constraint
                }),
              }),
            }),
          };
        }
        if (table === 'game_players_public') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await joinRoom('ABC123', 'Player 1');

      expect(result).toEqual({ success: false, error: 'Failed to join room' });
    });

    it('should handle player_index gaps from players leaving', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'game_rooms') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'room-id', status: 'waiting', max_players: 4 },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'game_players') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { player_index: 1, user_id: 'user-id' }, // Got index 1
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'game_players_public') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  // Gap: index 1 is missing (player left)
                  data: [{ player_index: 0 }, { player_index: 2 }],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      });

      const result = await joinRoom('ABC123', 'New Player');

      expect(result.success).toBe(true);
      expect(result.playerIndex).toBe(1); // Should fill the gap
    });
  });

  describe('leaveRoom', () => {
    it('should delete player from room', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
      });

      const mockDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      });
      mockFrom.mockReturnValue({ delete: mockDelete });

      await leaveRoom('room-id');

      expect(mockFrom).toHaveBeenCalledWith('game_players');
      expect(mockDelete).toHaveBeenCalled();
    });

    it('should do nothing if not authenticated', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
      });

      await leaveRoom('room-id');

      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  describe('getRoomPlayers', () => {
    it('should return players with proper formatting', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                { id: 'p1', player_name: 'Alice', player_index: 0, is_ready: true },
                { id: 'p2', player_name: 'Bob', player_index: 1, is_ready: false },
              ],
              error: null,
            }),
          }),
        }),
      });

      const players = await getRoomPlayers('room-id');

      expect(players).toEqual([
        { id: 'p1', player_name: 'Alice', player_index: 0, is_ready: true },
        { id: 'p2', player_name: 'Bob', player_index: 1, is_ready: false },
      ]);
    });

    it('should return empty array on error', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          }),
        }),
      });

      const players = await getRoomPlayers('room-id');

      expect(players).toEqual([]);
    });

    it('should handle missing fields with defaults', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                { id: null, player_name: null, player_index: null, is_ready: null },
              ],
              error: null,
            }),
          }),
        }),
      });

      const players = await getRoomPlayers('room-id');

      expect(players).toEqual([
        { id: '', player_name: '', player_index: 0, is_ready: false },
      ]);
    });
  });

  describe('toggleReady', () => {
    it('should call executeGameAction with toggle_ready', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: { success: true, data: { gameStarted: false } },
        error: null,
      });

      const result = await toggleReady('room-id');

      expect(mockFunctionsInvoke).toHaveBeenCalledWith('game-action', {
        body: { action: 'toggle_ready', roomId: 'room-id', payload: undefined },
      });
      expect(result).toEqual({ success: true, gameStarted: false, error: undefined });
    });

    it('should return gameStarted true when game starts', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: { success: true, data: { gameStarted: true } },
        error: null,
      });

      const result = await toggleReady('room-id');

      expect(result.gameStarted).toBe(true);
    });
  });

  describe('executeGameAction', () => {
    it('should invoke edge function with correct parameters', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: { success: true, someData: 'value' },
        error: null,
      });

      const result = await executeGameAction('place_tile', 'room-id', { tileId: '5F' });

      expect(mockFunctionsInvoke).toHaveBeenCalledWith('game-action', {
        body: { action: 'place_tile', roomId: 'room-id', payload: { tileId: '5F' } },
      });
      expect(result).toEqual({ success: true, someData: 'value' });
    });

    it('should return error on function invocation failure', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: null,
        error: { message: 'Network error' },
      });

      const result = await executeGameAction('place_tile', 'room-id');

      expect(result).toEqual({ success: false, error: 'Network error' });
    });

    it('should return error from data.error', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: { error: 'Invalid action' },
        error: null,
      });

      const result = await executeGameAction('invalid_action', 'room-id');

      expect(result).toEqual({ success: false, error: 'Invalid action' });
    });

    it('should return success true for empty data response', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await executeGameAction('some_action', 'room-id');

      expect(result).toEqual({ success: true });
    });
  });

  describe('startGame', () => {
    it('should call executeGameAction with start_game', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: { success: true },
        error: null,
      });

      const mockGameState = {} as any;
      const result = await startGame('room-id', mockGameState);

      expect(mockFunctionsInvoke).toHaveBeenCalledWith('game-action', {
        body: { action: 'start_game', roomId: 'room-id', payload: undefined },
      });
      expect(result).toBe(true);
    });

    it('should return false on failure', async () => {
      mockFunctionsInvoke.mockResolvedValue({
        data: { success: false },
        error: null,
      });

      const mockGameState = {} as any;
      const result = await startGame('room-id', mockGameState);

      expect(result).toBe(false);
    });
  });

  describe('updateGameState', () => {
    it('should return true (compatibility function)', async () => {
      const mockGameState = {} as any;
      const result = await updateGameState('room-id', mockGameState);

      expect(result).toBe(true);
    });
  });

  describe('dbToGameState', () => {
    it('should convert database state to GameState', () => {
      const dbState = {
        board: {
          '1A': { id: '1A', placed: true, chain: null },
          '5F': { id: '5F', placed: true, chain: 'sackson' },
        },
        current_player_index: 2,
        phase: 'buy_stock',
        chains: {
          sackson: { name: 'sackson', tiles: ['5F'], isActive: true, isSafe: false },
          tower: { name: 'tower', tiles: [], isActive: false, isSafe: false },
          worldwide: { name: 'worldwide', tiles: [], isActive: false, isSafe: false },
          american: { name: 'american', tiles: [], isActive: false, isSafe: false },
          festival: { name: 'festival', tiles: [], isActive: false, isSafe: false },
          continental: { name: 'continental', tiles: [], isActive: false, isSafe: false },
          imperial: { name: 'imperial', tiles: [], isActive: false, isSafe: false },
        },
        stock_bank: {
          sackson: 24, tower: 25, worldwide: 25, american: 25,
          festival: 25, continental: 25, imperial: 25,
        },
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
        { player_index: 1, player_name: 'Bob', cash: 5800, tiles: ['3D'], stocks: { tower: 2 }, is_connected: true },
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

    it('should handle missing board data', () => {
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

    it('should handle player with missing stocks', () => {
      const dbState = {
        board: {},
        current_player_index: 0,
        phase: 'place_tile',
        chains: {},
        stock_bank: {},
        tile_bag: [],
        stocks_purchased_this_turn: 0,
        game_log: [],
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

  describe('subscribeToRoom', () => {
    it('should set up channel subscriptions', () => {
      const channelObj = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      };
      mockChannel.mockReturnValue(channelObj);

      const onPlayersChange = vi.fn();
      const onGameStateChange = vi.fn();
      const onRoomStatusChange = vi.fn();

      const unsubscribe = subscribeToRoom(
        'room-id',
        onPlayersChange,
        onGameStateChange,
        onRoomStatusChange
      );

      expect(mockChannel).toHaveBeenCalledWith('room-room-id');
      expect(channelObj.on).toHaveBeenCalledTimes(3);
      expect(channelObj.subscribe).toHaveBeenCalled();

      // Call unsubscribe
      unsubscribe();
      expect(mockRemoveChannel).toHaveBeenCalledWith(channelObj);
    });

    it('should subscribe to game_players changes', () => {
      const channelObj = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      };
      mockChannel.mockReturnValue(channelObj);

      subscribeToRoom('room-id', vi.fn(), vi.fn(), vi.fn());

      // First .on() call should be for game_players
      expect(channelObj.on).toHaveBeenNthCalledWith(
        1,
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_players',
          filter: 'room_id=eq.room-id',
        },
        expect.any(Function)
      );
    });

    it('should subscribe to game_states changes', () => {
      const channelObj = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      };
      mockChannel.mockReturnValue(channelObj);

      subscribeToRoom('room-id', vi.fn(), vi.fn(), vi.fn());

      // Second .on() call should be for game_states
      expect(channelObj.on).toHaveBeenNthCalledWith(
        2,
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_states',
          filter: 'room_id=eq.room-id',
        },
        expect.any(Function)
      );
    });

    it('should subscribe to game_rooms status changes', () => {
      const channelObj = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn().mockReturnThis(),
      };
      mockChannel.mockReturnValue(channelObj);

      subscribeToRoom('room-id', vi.fn(), vi.fn(), vi.fn());

      // Third .on() call should be for game_rooms
      expect(channelObj.on).toHaveBeenNthCalledWith(
        3,
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'game_rooms',
          filter: 'id=eq.room-id',
        },
        expect.any(Function)
      );
    });
  });

  describe('getSecurePlayerData', () => {
    it('should return player data with tiles only for authenticated user', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
      });

      // Mock for game_players_public
      const publicSelectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              { id: 'p1', room_id: 'room-id', player_name: 'Alice', player_index: 0, cash: 6000, stocks: {}, is_connected: true },
              { id: 'p2', room_id: 'room-id', player_name: 'Bob', player_index: 1, cash: 5500, stocks: {}, is_connected: true },
            ],
            error: null,
          }),
        }),
      });

      // Mock for game_players (own player data)
      const privateSelectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { player_index: 0, tiles: ['1A', '2B', '3C'] },
              error: null,
            }),
          }),
        }),
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'game_players_public') {
          return { select: publicSelectMock };
        }
        if (table === 'game_players') {
          return { select: privateSelectMock };
        }
        return {};
      });

      const result = await getSecurePlayerData('room-id');

      expect(result).toHaveLength(2);
      // Own player should have tiles
      expect(result[0].tiles).toEqual(['1A', '2B', '3C']);
      // Other player should have empty tiles
      expect(result[1].tiles).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-id' } },
      });

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          }),
        }),
      });

      const result = await getSecurePlayerData('room-id');

      expect(result).toEqual([]);
    });
  });
});
