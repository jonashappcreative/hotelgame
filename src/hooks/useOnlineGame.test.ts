import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ChainName } from '@/types/game';

// The hook talks to the server only through multiplayerService; dbToGameState
// is pure, so it stays real and the fixture below is a genuine DB row shape.
vi.mock('@/utils/multiplayerService', async () => {
  const actual = await vi.importActual<typeof import('@/utils/multiplayerService')>(
    '@/utils/multiplayerService'
  );
  return {
    ...actual,
    joinRoom: vi.fn(),
    createRoom: vi.fn(),
    leaveRoom: vi.fn(),
    getRoomPlayers: vi.fn(async () => [
      { id: 'a', player_name: 'Alice', player_index: 0, is_ready: true },
      { id: 'b', player_name: 'Bob', player_index: 1, is_ready: true },
    ]),
    getSecurePlayerData: vi.fn(),
    executeGameAction: vi.fn(),
    addBot: vi.fn(),
    removeBot: vi.fn(),
    subscribeToRoom: vi.fn(() => () => {}),
    getOrCreateAuthSession: vi.fn(async () => 'user-1'),
    getCurrentUserId: vi.fn(() => 'user-1'),
    toggleReady: vi.fn(),
    checkActiveGame: vi.fn(async () => ({ hasActiveGame: false })),
    sendHeartbeat: vi.fn(),
    markDisconnected: vi.fn(),
    clearActiveGameFromStorage: vi.fn(),
    getPublicGameState: vi.fn(),
    getRoomStatus: vi.fn(async () => ({ status: 'playing', max_players: 2 })),
  };
});

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
  useToast: () => ({ toast: toastMock }),
}));

import { useOnlineGame } from './useOnlineGame';
import {
  joinRoom,
  getSecurePlayerData,
  executeGameAction,
  getPublicGameState,
} from '@/utils/multiplayerService';

const ALL_CHAINS: ChainName[] = [
  'sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial',
];

const zero = () => Object.fromEntries(ALL_CHAINS.map((c) => [c, 0]));

const dbChains = () =>
  Object.fromEntries(
    ALL_CHAINS.map((c) => [c, {
      name: c,
      tiles: c === 'continental' ? ['1A', '1B', '1C', '1D', '1E', '1F', '1G'] : [],
      isActive: c === 'continental',
      isSafe: false,
    }])
  );

const dbState = (currentPlayerIndex: number) => ({
  current_player_index: currentPlayerIndex,
  phase: 'buy_stock',
  board: {},
  chains: dbChains(),
  stock_bank: { ...zero(), continental: 20 },
  tile_bag: [],
  last_placed_tile: null,
  pending_chain_foundation: null,
  merger: null,
  stocks_purchased_this_turn: 0,
  stocks_sold_this_turn: 0,
  chains_bought_this_turn: [],
  game_log: [],
  winner: null,
  end_game_votes: [],
  round_number: 1,
  rules_snapshot: null,
  turn_deadline_epoch: null,
});

const dbPlayers = () => [
  { player_index: 0, player_name: 'Alice', cash: 6000, tiles: [], stocks: { ...zero(), continental: 5 }, is_connected: true },
  { player_index: 1, player_name: 'Bob', cash: 6000, tiles: [], stocks: zero(), is_connected: true },
];

// Drives the hook into an in-progress game where Alice is seat 0.
const joinGameInProgress = async (currentPlayerIndex: number) => {
  vi.mocked(joinRoom).mockResolvedValue({
    success: true, roomId: 'room-1', playerIndex: 0, maxPlayers: 2,
  } as never);
  vi.mocked(getPublicGameState).mockResolvedValue(dbState(currentPlayerIndex));
  vi.mocked(getSecurePlayerData).mockResolvedValue(dbPlayers());

  const hook = renderHook(() => useOnlineGame());
  await act(async () => {
    await hook.result.current.handleJoinRoom('ABC123', 'Alice');
  });
  await waitFor(() => expect(hook.result.current.gameState).not.toBeNull());
  return hook;
};

describe('useOnlineGame — handleSellStocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSecurePlayerData).mockResolvedValue(dbPlayers());
  });

  it('is a no-op when it is not the local player\'s turn', async () => {
    const hook = await joinGameInProgress(1); // Bob's turn
    vi.mocked(executeGameAction).mockClear();
    toastMock.mockClear();

    await act(async () => {
      await hook.result.current.handleSellStocks([{ chain: 'continental', quantity: 1 }]);
    });

    expect(executeGameAction).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Not Your Turn', variant: 'destructive' })
    );
  });

  it('sends the basket as sell_stocks and refreshes on success', async () => {
    const hook = await joinGameInProgress(0);
    vi.mocked(executeGameAction).mockResolvedValue({ success: true, turnEnded: false });
    vi.mocked(getPublicGameState).mockClear();

    await act(async () => {
      await hook.result.current.handleSellStocks([{ chain: 'continental', quantity: 2 }]);
    });

    expect(executeGameAction).toHaveBeenCalledWith('sell_stocks', 'room-1', {
      sales: [{ chain: 'continental', quantity: 2 }],
    });
    // Server state is authoritative — the hook re-reads rather than guessing.
    expect(getPublicGameState).toHaveBeenCalled();
  });

  it('leaves local state untouched and raises a toast on a 400', async () => {
    const hook = await joinGameInProgress(0);
    const before = hook.result.current.gameState;
    vi.mocked(executeGameAction).mockResolvedValue({
      success: false, error: 'You only hold 1 Continental share(s)',
    });
    toastMock.mockClear();

    await act(async () => {
      await hook.result.current.handleSellStocks([{ chain: 'continental', quantity: 9 }]);
    });

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Sale rejected',
        description: 'You only hold 1 Continental share(s)',
        variant: 'destructive',
      })
    );
    // The refetch returns the same unchanged server row.
    expect(hook.result.current.gameState?.players[0].stocks.continental)
      .toBe(before?.players[0].stocks.continental);
    expect(hook.result.current.gameState?.stocksSoldThisTurn).toBe(0);
  });

  it('never ends the turn — no turn-complete toast on success', async () => {
    const hook = await joinGameInProgress(0);
    vi.mocked(executeGameAction).mockResolvedValue({ success: true, turnEnded: false });
    toastMock.mockClear();

    await act(async () => {
      await hook.result.current.handleSellStocks([{ chain: 'continental', quantity: 1 }]);
    });

    expect(toastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Turn Complete' })
    );
  });
});
