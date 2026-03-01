import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PlayerCard } from './PlayerCard';
import type { GameState, PlayerState, ChainName, ChainState } from '@/types/game';

const ALL_CHAINS: ChainName[] = [
  'sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial',
];

const makeChains = (): Record<ChainName, ChainState> =>
  Object.fromEntries(
    ALL_CHAINS.map((c) => [c, { name: c, tiles: [], isActive: false, isSafe: false }])
  ) as Record<ChainName, ChainState>;

const makePlayer = (overrides: Partial<PlayerState> = {}): PlayerState => ({
  id: 'p1',
  name: 'Alice',
  cash: 5000,
  tiles: [],
  stocks: Object.fromEntries(ALL_CHAINS.map((c) => [c, 0])) as Record<ChainName, number>,
  isConnected: true,
  ...overrides,
});

const makeGameState = (players: PlayerState[], overrides: Partial<GameState> = {}): GameState => ({
  roomCode: 'TEST',
  players,
  currentPlayerIndex: 0,
  phase: 'place_tile',
  board: new Map(),
  chains: makeChains(),
  stockBank: Object.fromEntries(ALL_CHAINS.map((c) => [c, 25])) as Record<ChainName, number>,
  tileBag: [],
  lastPlacedTile: null,
  pendingChainFoundation: null,
  merger: null,
  mergerAdjacentChains: null,
  stocksPurchasedThisTurn: 0,
  gameLog: [],
  winner: null,
  endGameVotes: [],
  roundNumber: 0,
  rulesSnapshot: null,
  turnDeadlineEpoch: null,
  safeChainSize: 11,
  ...overrides,
});

describe('PlayerCard — cash visibility', () => {
  it('renders opponent cash as — when cashVisibility is hidden', () => {
    const you = makePlayer({ id: 'p1', name: 'Alice', cash: 5000 });
    const opponent = makePlayer({ id: 'p2', name: 'Bob', cash: 3000 });
    const gameState = makeGameState([you, opponent]);

    const { getAllByText, queryByText } = render(
      <PlayerCard
        player={opponent}
        gameState={gameState}
        isCurrentTurn={false}
        isYou={false}
        cashVisibility="hidden"
      />
    );

    expect(getAllByText('—').length).toBeGreaterThan(0);
    expect(queryByText('$3,000')).toBeNull();
  });

  it('renders opponent exact cash when cashVisibility is visible', () => {
    const you = makePlayer({ id: 'p1', name: 'Alice', cash: 5000 });
    const opponent = makePlayer({ id: 'p2', name: 'Bob', cash: 3000 });
    const gameState = makeGameState([you, opponent]);

    const { getAllByText } = render(
      <PlayerCard
        player={opponent}
        gameState={gameState}
        isCurrentTurn={false}
        isYou={false}
        cashVisibility="visible"
      />
    );

    // Cash and net worth both shown (both equal $3,000 when no stocks)
    const cashValues = getAllByText('$3,000');
    expect(cashValues.length).toBeGreaterThan(0);
  });

  it('always renders the current player own cash regardless of visibility mode', () => {
    const you = makePlayer({ id: 'p1', name: 'Alice', cash: 5000 });
    const opponent = makePlayer({ id: 'p2', name: 'Bob', cash: 3000 });
    const gameState = makeGameState([you, opponent]);

    for (const mode of ['hidden', 'visible', 'aggregate'] as const) {
      const { getAllByText, unmount } = render(
        <PlayerCard
          player={you}
          gameState={gameState}
          isCurrentTurn={false}
          isYou={true}
          cashVisibility={mode}
        />
      );
      expect(getAllByText('$5,000').length).toBeGreaterThan(0);
      unmount();
    }
  });

  it('renders an aggregate total (not individual values) when cashVisibility is aggregate', () => {
    const you = makePlayer({ id: 'p1', name: 'Alice', cash: 5000 });
    const opponent = makePlayer({ id: 'p2', name: 'Bob', cash: 3000 });
    const gameState = makeGameState([you, opponent]);
    // Total pool = 5000 + 3000 = 8000

    const { getByText, queryByText } = render(
      <PlayerCard
        player={opponent}
        gameState={gameState}
        isCurrentTurn={false}
        isYou={false}
        cashVisibility="aggregate"
      />
    );

    expect(getByText('$8,000')).toBeTruthy();
    // Individual opponent cash not shown as cash value (net worth shown as —)
    expect(queryByText('$3,000')).toBeNull();
  });
});
