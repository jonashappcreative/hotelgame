import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameContainer } from './GameContainer';
import { DEFAULT_RULES } from '@/types/game';
import type { GameState, PlayerState, ChainName, ChainState, TileId } from '@/types/game';

// GameContainer only needs playSfx; keep Howler out of jsdom.
vi.mock('@/contexts/AudioContext', () => ({
  useAudio: () => ({ playSfx: vi.fn() }),
}));

const ALL_CHAINS: ChainName[] = [
  'sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial',
];

const makeChains = (): Record<ChainName, ChainState> =>
  Object.fromEntries(
    ALL_CHAINS.map((c) => [c, { name: c, tiles: [], isActive: false, isSafe: false }])
  ) as Record<ChainName, ChainState>;

const makePlayer = (id: string, name: string): PlayerState => ({
  id,
  name,
  cash: 6000,
  tiles: ['1A', '2B'] as TileId[],
  stocks: Object.fromEntries(ALL_CHAINS.map((c) => [c, 0])) as Record<ChainName, number>,
  isConnected: true,
});

// A live buy phase: Alice is up, Sackson is active at $200 a share.
const makeGameState = (overrides: Partial<GameState> = {}): GameState => {
  const chains = makeChains();
  chains.sackson = { name: 'sackson', tiles: ['5D', '5E'] as TileId[], isActive: true, isSafe: false };

  return {
    roomCode: 'TEST',
    players: [makePlayer('p1', 'Alice'), makePlayer('p2', 'Bob')],
    currentPlayerIndex: 0,
    phase: 'buy_stock',
    board: new Map(),
    chains,
    stockBank: Object.fromEntries(ALL_CHAINS.map((c) => [c, 25])) as Record<ChainName, number>,
    tileBag: ['3C'] as TileId[],
    lastPlacedTile: null,
    pendingChainFoundation: null,
    merger: null,
    mergerAdjacentChains: null,
    stocksPurchasedThisTurn: 0,
    stocksSoldThisTurn: 0,
    chainsBoughtThisTurn: [],
    gameLog: [],
    winner: null,
    endGameVotes: [],
    roundNumber: 1,
    rulesSnapshot: null,
    turnDeadlineEpoch: null,
    safeChainSize: 11,
    bonusTier: 'standard',
    boardRows: 9,
    boardCols: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
    maxChains: 7,
    eligibleChains: ALL_CHAINS,
    ...overrides,
  };
};

const noop = () => {};

const renderGame = (gameState: GameState, opts: { withSelling?: boolean } = {}) => {
  const onEndTurn = vi.fn();
  const onSellStocks = vi.fn();
  render(
    <GameContainer
      gameState={gameState}
      onTilePlacement={noop}
      onFoundChain={noop}
      onChooseMergerSurvivor={noop}
      onPayMergerBonuses={noop}
      onMergerStockChoice={noop}
      onBuyStocks={noop}
      onSellStocks={opts.withSelling ? onSellStocks : undefined}
      onEndTurn={onEndTurn}
      onEndGameVote={noop}
      onNewGame={noop}
    />
  );
  return { onEndTurn, onSellStocks };
};

const clickEndTurn = () =>
  fireEvent.click(screen.getByRole('button', { name: /end turn/i }));

describe('GameContainer — End Turn confirmation', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('warns instead of ending the turn while stock is still affordable', () => {
    const { onEndTurn } = renderGame(makeGameState());

    clickEndTurn();

    expect(screen.getByText("You haven't bought any stock")).toBeInTheDocument();
    expect(onEndTurn).not.toHaveBeenCalled();
  });

  it('ends the turn once the warning is confirmed', () => {
    const { onEndTurn } = renderGame(makeGameState());

    clickEndTurn();
    fireEvent.click(screen.getByRole('button', { name: /end turn anyway/i }));

    expect(onEndTurn).toHaveBeenCalledOnce();
  });

  it('returns to the buy panel without ending the turn', () => {
    const { onEndTurn } = renderGame(makeGameState());

    clickEndTurn();
    fireEvent.click(screen.getByRole('button', { name: /review purchases/i }));

    expect(screen.queryByText("You haven't bought any stock")).not.toBeInTheDocument();
    expect(onEndTurn).not.toHaveBeenCalled();
    expect(screen.getByText('Buy Stocks')).toBeInTheDocument();
  });

  it('warns about shares selected but never confirmed', () => {
    renderGame(makeGameState());

    // Add one Sackson share to the selection without pressing Buy.
    const plusButtons = screen.getAllByRole('button').filter(
      (b) => b.querySelector('.lucide-plus') !== null
    );
    fireEvent.click(plusButtons[0]);

    clickEndTurn();

    expect(screen.getByText(/never confirmed/)).toBeInTheDocument();
    expect(screen.getByText('1 share')).toBeInTheDocument();
  });

  it('reports what was already bought when the allowance is partly spent', () => {
    renderGame(makeGameState({ stocksPurchasedThisTurn: 2 }));

    clickEndTurn();

    expect(screen.getByText('You can still buy stock')).toBeInTheDocument();
    expect(screen.getByText(/bought 2 of 3 shares/)).toBeInTheDocument();
  });

  it('auto-ends the turn without warning once the allowance is spent', async () => {
    const { onEndTurn } = renderGame(makeGameState({ stocksPurchasedThisTurn: 3 }));

    expect(screen.queryByRole('button', { name: /end turn/i })).not.toBeInTheDocument();
    await waitFor(() => expect(onEndTurn).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('auto-ends the turn without warning when nothing is affordable', async () => {
    const broke = makeGameState();
    broke.players[0].cash = 100;
    const { onEndTurn } = renderGame(broke);

    expect(screen.queryByRole('button', { name: /end turn/i })).not.toBeInTheDocument();
    await waitFor(() => expect(onEndTurn).toHaveBeenCalled(), { timeout: 2000 });
  });
});

// Story 14.7: with stock selling on, the buy phase isn't over just because the
// player can't afford anything — they may still want to liquidate.
describe('GameContainer — End Turn with stock selling enabled', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  const sellableState = () => {
    const state = makeGameState({
      rulesSnapshot: { ...DEFAULT_RULES, stockSellingEnabled: true, sellPriceFactor: '75' },
    });
    state.players[0].cash = 100; // can't afford Sackson at $200
    state.players[0].stocks.sackson = 2;
    return state;
  };

  it('does not auto-end the turn for a broke player who can still sell', async () => {
    const { onEndTurn } = renderGame(sellableState(), { withSelling: true });

    expect(screen.getByRole('button', { name: /end turn/i })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1200));
    expect(onEndTurn).not.toHaveBeenCalled();
  });

  it('still auto-ends for a broke player holding nothing sellable', async () => {
    const state = sellableState();
    state.players[0].stocks.sackson = 0;
    const { onEndTurn } = renderGame(state, { withSelling: true });

    await waitFor(() => expect(onEndTurn).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('warns about a pending sale before ending the turn', async () => {
    const { onEndTurn } = renderGame(sellableState(), { withSelling: true });

    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));
    fireEvent.click(screen.getByLabelText('Sell one more Sackson'));
    clickEndTurn();

    expect(screen.getByText('You can still sell stock')).toBeInTheDocument();
    expect(screen.getByText(/marked to sell/)).toBeInTheDocument();
    expect(onEndTurn).not.toHaveBeenCalled();
  });
});
