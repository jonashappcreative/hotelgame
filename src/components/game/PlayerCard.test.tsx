import { render, screen, fireEvent } from '@testing-library/react';
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
  powerCards: [],
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
  tileBagCount: 0,
  lastPlacedTile: null,
  pendingChainFoundation: null,
  merger: null,
  mergerAdjacentChains: null,
  stocksPurchasedThisTurn: 0,
  stocksSoldThisTurn: 0,
  chainsBoughtThisTurn: [],
  activePowerCard: null,
  tilesPlacedThisTurn: 0,
  gameLog: [],
  winner: null,
  endGameVotes: [],
  endDeclaredBy: null,
  roundNumber: 0,
  rulesSnapshot: null,
  turnDeadlineEpoch: null,
  safeChainSize: 11,
  bonusTier: 'standard',
  boardRows: 9,
  boardCols: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
  maxChains: 7,
  eligibleChains: ALL_CHAINS,
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


// Epic 17. Which cards an opponent has left is public — knowing someone can
// still spend Building Spree changes how you leave the board — so it renders
// for every seat regardless of the room's cash visibility, which hides money
// and nothing else.
describe('PlayerCard — opponent power cards', () => {
  const cardsOn = (rules = {}) => ({
    rulesSnapshot: { powerCards: 'on', cashVisibility: 'hidden', ...rules } as any,
  });

  const renderOpponent = (powerCards: any[], overrides = {}) => {
    const you = makePlayer({ id: 'p1', name: 'Alice' });
    const opponent = makePlayer({ id: 'p2', name: 'Bob', powerCards });
    const state = makeGameState([you, opponent], { ...cardsOn(), ...overrides });
    render(
      <PlayerCard player={opponent} gameState={state} isCurrentTurn={false} isYou={false} />
    );
  };

  it('shows which cards an opponent still holds, even with cash hidden', () => {
    renderOpponent(['extra_buy', 'multi_tile']);

    expect(screen.getByText('Cards left')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Extra Purchase — still held/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Free Shares — spent/ })).toBeInTheDocument();
  });

  it('opens a read-only dialog attributed to that player', () => {
    renderOpponent(['multi_tile']);

    fireEvent.click(screen.getByRole('button', { name: /Building Spree — still held/ }));

    expect(screen.getByText(/Bob still holds this card/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^play card$/i })).not.toBeInTheDocument();
  });

  it('renders nothing when the room rule is off', () => {
    const you = makePlayer({ id: 'p1', name: 'Alice' });
    const opponent = makePlayer({ id: 'p2', name: 'Bob', powerCards: [] });
    const state = makeGameState([you, opponent], {
      rulesSnapshot: { powerCards: 'off' } as any,
    });
    render(
      <PlayerCard player={opponent} gameState={state} isCurrentTurn={false} isYou={false} />
    );

    expect(screen.queryByText('Cards left')).not.toBeInTheDocument();
  });
});
