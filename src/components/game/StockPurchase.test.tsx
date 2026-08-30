import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StockPurchase } from './StockPurchase';
import { getSellPrice, getStockPrice } from '@/utils/gameLogic';
import { DEFAULT_RULES } from '@/types/game';
import type { GameState, PlayerState, ChainName, ChainState, TileId } from '@/types/game';

const ALL_CHAINS: ChainName[] = [
  'sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial',
];

const zeroStocks = () => Object.fromEntries(ALL_CHAINS.map((c) => [c, 0])) as Record<ChainName, number>;

const makeChains = (): Record<ChainName, ChainState> =>
  Object.fromEntries(
    ALL_CHAINS.map((c) => [c, { name: c, tiles: [], isActive: false, isSafe: false }])
  ) as Record<ChainName, ChainState>;

const makePlayer = (stocks: Partial<Record<ChainName, number>> = {}): PlayerState => ({
  id: 'p1',
  name: 'Alice',
  cash: 6000,
  tiles: [] as TileId[],
  stocks: { ...zeroStocks(), ...stocks },
  isConnected: true,
});

// Sackson (budget) and Continental (premium) are live at 7 tiles:
// $600 and $700 a share respectively.
const tilesFor = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}A`) as TileId[];

const makeGameState = (overrides: Partial<GameState> = {}): GameState => {
  const chains = makeChains();
  chains.sackson = { name: 'sackson', tiles: tilesFor(7), isActive: true, isSafe: false };
  chains.continental = { name: 'continental', tiles: tilesFor(7), isActive: true, isSafe: false };

  return {
    roomCode: 'TEST',
    players: [makePlayer()],
    currentPlayerIndex: 0,
    phase: 'buy_stock',
    board: new Map(),
    chains,
    stockBank: Object.fromEntries(ALL_CHAINS.map((c) => [c, 25])) as Record<ChainName, number>,
    tileBag: [],
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
    rulesSnapshot: { ...DEFAULT_RULES, stockSelling: '75' },
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

const renderPanel = (
  gameState: GameState,
  stocks: Partial<Record<ChainName, number>> = {},
  props: { onSell?: (sales: { chain: ChainName; quantity: number }[]) => void } = {}
) => {
  const onPurchase = vi.fn();
  const onSell = 'onSell' in props ? props.onSell : vi.fn();
  render(
    <StockPurchase
      gameState={gameState}
      playerCash={6000}
      playerStocks={{ ...zeroStocks(), ...stocks }}
      onPurchase={onPurchase}
      onSell={onSell ?? undefined}
    />
  );
  return { onPurchase, onSell };
};

const sellRow = (displayName: string) =>
  screen.getByText(displayName).closest('div.flex.items-center.justify-between') as HTMLElement;

const clickSellPlus = (displayName: string, times = 1) => {
  const button = screen.getByLabelText(`Sell one more ${displayName}`);
  for (let i = 0; i < times; i++) fireEvent.click(button);
};

describe('StockPurchase — Buy/Sell control visibility', () => {
  it('is absent when stockSellingEnabled is false', () => {
    renderPanel(
      makeGameState({ rulesSnapshot: { ...DEFAULT_RULES, stockSelling: 'off' } }),
      { sackson: 3 }
    );

    expect(screen.queryByRole('button', { name: /^Sell$/ })).toBeNull();
    expect(screen.getByText('Buy Stocks')).toBeTruthy();
  });

  it('is absent when no onSell handler is wired up (local play)', () => {
    renderPanel(makeGameState(), { sackson: 3 }, { onSell: undefined });

    expect(screen.queryByRole('button', { name: /^Sell$/ })).toBeNull();
  });

  it('appears when the rule is enabled and selling is wired up', () => {
    renderPanel(makeGameState(), { sackson: 3 });

    expect(screen.getByRole('button', { name: /^Sell$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Buy$/ })).toBeTruthy();
  });
});

describe('StockPurchase — sell view', () => {
  it('omits chains with zero holdings', () => {
    renderPanel(makeGameState(), { sackson: 2 });
    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));

    expect(screen.getByText('Sackson')).toBeTruthy();
    expect(screen.queryByText('Continental')).toBeNull();
  });

  it('omits chains that have gone defunct even when shares are still held', () => {
    const gameState = makeGameState();
    gameState.chains.continental = {
      name: 'continental', tiles: [], isActive: false, isSafe: false,
    };
    renderPanel(gameState, { sackson: 2, continental: 4 });
    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));

    expect(screen.queryByText('Continental')).toBeNull();
  });

  it('shows holdings, market price and the per-share sale price', () => {
    renderPanel(makeGameState(), { continental: 4 });
    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));

    // Continental at 7 tiles: $700 market, $520 back from the bank at 75%.
    expect(within(sellRow('Continental')).getByText(/4 held/)).toBeTruthy();
    expect(within(sellRow('Continental')).getByText(/\$700 market/)).toBeTruthy();
    expect(within(sellRow('Continental')).getByText(/you receive \$520/)).toBeTruthy();
  });

  it('disables a chain bought this turn and says why', () => {
    renderPanel(makeGameState({ chainsBoughtThisTurn: ['sackson'] }), { sackson: 3 });
    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));

    expect(screen.getByText('Bought this turn')).toBeTruthy();
    expect(screen.getByLabelText('Sell one more Sackson').hasAttribute('disabled')).toBe(true);
  });

  it('caps the stepper at the shares actually held', () => {
    renderPanel(makeGameState(), { continental: 2 });
    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));

    clickSellPlus('Continental', 5);

    expect(screen.getByRole('button', { name: /Sell 2 Shares/ })).toBeTruthy();
    expect(screen.getByLabelText('Sell one more Continental').hasAttribute('disabled')).toBe(true);
  });

  it('caps the stepper at the remaining sell allowance', () => {
    renderPanel(makeGameState({ stocksSoldThisTurn: 2 }), { continental: 5 });
    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));

    clickSellPlus('Continental', 4);

    expect(screen.getByRole('button', { name: /Sell 1 Share$/ })).toBeTruthy();
  });

  it('shows proceeds and spread matching getSellPrice for the basket', () => {
    renderPanel(makeGameState(), { continental: 3 });
    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));

    clickSellPlus('Continental', 2);

    const proceeds = getSellPrice('continental', 7, 0.75) * 2; // 1,040
    const spread = getStockPrice('continental', 7) * 2 - proceeds; // 360
    expect(screen.getByText(`$${proceeds.toLocaleString()}`)).toBeTruthy();
    expect(screen.getByText(`−$${spread.toLocaleString()}`)).toBeTruthy();
  });

  it('shows no spread at the Full Value setting', () => {
    const gameState = makeGameState({
      rulesSnapshot: { ...DEFAULT_RULES, stockSelling: '100' },
    });
    renderPanel(gameState, { continental: 1 });
    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));

    clickSellPlus('Continental');

    expect(screen.getByText('$700')).toBeTruthy();
    expect(screen.getByText('−$0')).toBeTruthy();
  });

  it('disables confirm until something is selected, then reports the basket', () => {
    const { onSell } = renderPanel(makeGameState(), { continental: 3, sackson: 2 });
    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));

    const confirm = screen.getByRole('button', { name: /Sell 0 Shares/ });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    clickSellPlus('Continental', 2);
    clickSellPlus('Sackson', 1);
    fireEvent.click(screen.getByRole('button', { name: /Sell 3 Shares/ }));

    expect(onSell).toHaveBeenCalledWith([
      { chain: 'sackson', quantity: 1 },
      { chain: 'continental', quantity: 2 },
    ]);
  });

  it('preserves each tab\'s pending selection when switching between them', () => {
    renderPanel(makeGameState(), { continental: 3 });

    fireEvent.click(screen.getByLabelText('Buy one more Sackson'));
    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));
    clickSellPlus('Continental', 2);
    expect(screen.getByRole('button', { name: /Sell 2 Shares/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Buy$/ }));
    expect(screen.getByRole('button', { name: /Buy 1 Share$/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));
    expect(screen.getByRole('button', { name: /Sell 2 Shares/ })).toBeTruthy();
  });

  it('reports both baskets through onPendingChange', () => {
    const onPendingChange = vi.fn();
    render(
      <StockPurchase
        gameState={makeGameState()}
        playerCash={6000}
        playerStocks={{ ...zeroStocks(), continental: 2 }}
        onPurchase={vi.fn()}
        onSell={vi.fn()}
        onPendingChange={onPendingChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));
    clickSellPlus('Continental');

    expect(onPendingChange).toHaveBeenLastCalledWith({
      shares: 0,
      cost: 0,
      sellShares: 1,
      proceeds: getSellPrice('continental', 7, 0.75),
    });
  });

  it('tells the player when they hold nothing sellable', () => {
    renderPanel(makeGameState(), {});
    fireEvent.click(screen.getByRole('button', { name: /^Sell$/ }));

    expect(screen.getByText(/don't hold shares in any active chain/)).toBeTruthy();
  });
});

describe('StockPurchase — buying is unaffected', () => {
  it('still buys through the buy tab with selling enabled', () => {
    const { onPurchase } = renderPanel(makeGameState(), { continental: 2 });

    fireEvent.click(screen.getByLabelText('Buy one more Sackson'));
    fireEvent.click(screen.getByRole('button', { name: /Buy 1 Share$/ }));

    expect(onPurchase).toHaveBeenCalledWith([{ chain: 'sackson', quantity: 1 }]);
  });

  it('keeps the buy allowance independent of shares already sold', () => {
    renderPanel(makeGameState({ stocksSoldThisTurn: 3 }), { continental: 2 });

    expect(screen.getByText('3 of 3 remaining')).toBeTruthy();
  });
});
