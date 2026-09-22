import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  powerCards: [],
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
    tileBagCount: 1,
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

const renderGame = (
  gameState: GameState,
  opts: {
    withSelling?: boolean; online?: boolean; declareFails?: boolean;
    withPowerCards?: boolean;
  } = {},
) => {
  const onEndTurn = vi.fn();
  const onSellStocks = vi.fn();
  const onDeclareGameEnd = vi.fn(async () => !opts.declareFails);
  const onPlayPowerCard = vi.fn();
  render(
    <GameContainer
      gameState={gameState}
      // Epic 18's declaration path is the online path; local hot-seat keeps the
      // engine's own automatic end, and passing no handler is what selects it.
      myPlayerIndex={opts.online ? gameState.currentPlayerIndex : undefined}
      onTilePlacement={noop}
      onFoundChain={noop}
      onChooseMergerSurvivor={noop}
      onPayMergerBonuses={noop}
      onMergerStockChoice={noop}
      onBuyStocks={noop}
      onSellStocks={opts.withSelling ? onSellStocks : undefined}
      onEndTurn={onEndTurn}
      onDeclareGameEnd={opts.online ? onDeclareGameEnd : undefined}
      onPlayPowerCard={opts.withPowerCards ? onPlayPowerCard : undefined}
      onNewGame={noop}
    />
  );
  return { onEndTurn, onSellStocks, onDeclareGameEnd, onPlayPowerCard };
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
      rulesSnapshot: { ...DEFAULT_RULES, stockSelling: '75' },
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

// =============================================================================
// Epic 18 — Story 18.4: once the game can be ended, turns stop ending themselves
// =============================================================================
// The declaration is worthless if the player never gets to make it, so the buy
// phase stops auto-closing while a condition holds and the turn leaves through
// the modal instead.
describe('GameContainer — ending a turn once the game can be ended', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  // A board with a 41-tile chain: the condition is met, so the turn must not
  // end itself even though the allowance is spent and nothing is affordable.
  const endableState = (overrides: Partial<GameState> = {}) => {
    const state = makeGameState({ stocksPurchasedThisTurn: 3, ...overrides });
    state.chains.sackson = {
      name: 'sackson',
      tiles: Array.from({ length: 41 }, (_, i) => `t${i}`) as TileId[],
      isActive: true,
      isSafe: false,
    };
    return state;
  };

  // Every active chain safe — the second route, invisible in a default room.
  const allSafeState = () => {
    const state = makeGameState({ stocksPurchasedThisTurn: 3 });
    state.chains.sackson = {
      name: 'sackson',
      tiles: Array.from({ length: 12 }, (_, i) => `t${i}`) as TileId[],
      isActive: true,
      isSafe: true,
    };
    return state;
  };

  it('does not auto-end the turn once a chain has reached 41 tiles', async () => {
    const { onEndTurn } = renderGame(endableState(), { online: true });

    expect(screen.getByRole('button', { name: /end turn/i })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1200));
    expect(onEndTurn).not.toHaveBeenCalled();
  });

  it('does not auto-end the turn when nothing is affordable either', async () => {
    const state = endableState();
    state.stocksPurchasedThisTurn = 0;
    state.players[0].cash = 0;
    const { onEndTurn } = renderGame(state, { online: true });

    await new Promise((r) => setTimeout(r, 1200));
    expect(onEndTurn).not.toHaveBeenCalled();
  });

  it('names the met condition and offers the choice', () => {
    renderGame(endableState(), { online: true });

    clickEndTurn();

    expect(screen.getByText('The game can be ended')).toBeInTheDocument();
    // Named in both the banner and the modal — one reminder, two places.
    expect(screen.getAllByText(/A chain has reached 41 tiles/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /declare & end game/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /keep playing/i })).toBeInTheDocument();
  });

  it('names the all-safe condition on that route instead', () => {
    renderGame(allSafeState(), { online: true });

    clickEndTurn();

    expect(screen.getAllByText(/Every chain on the board is safe/).length).toBeGreaterThan(0);
  });

  it('Declare & End Game declares and then ends the turn', async () => {
    const { onEndTurn, onDeclareGameEnd } = renderGame(endableState(), { online: true });

    clickEndTurn();
    fireEvent.click(screen.getByRole('button', { name: /declare & end game/i }));

    await waitFor(() => expect(onDeclareGameEnd).toHaveBeenCalledOnce());
    await waitFor(() => expect(onEndTurn).toHaveBeenCalledOnce());
  });

  it('leaves the turn open when the declaration is rejected', async () => {
    const { onEndTurn, onDeclareGameEnd } = renderGame(
      endableState(), { online: true, declareFails: true },
    );

    clickEndTurn();
    fireEvent.click(screen.getByRole('button', { name: /declare & end game/i }));

    await waitFor(() => expect(onDeclareGameEnd).toHaveBeenCalledOnce());
    await new Promise((r) => setTimeout(r, 50));
    expect(onEndTurn).not.toHaveBeenCalled();
  });

  it('End Turn — Keep Playing ends the turn without declaring', async () => {
    const { onEndTurn, onDeclareGameEnd } = renderGame(endableState(), { online: true });

    clickEndTurn();
    fireEvent.click(screen.getByRole('button', { name: /keep playing/i }));

    expect(onEndTurn).toHaveBeenCalledOnce();
    expect(onDeclareGameEnd).not.toHaveBeenCalled();
  });

  it('confirms rather than re-offering the choice to a player who already declared', () => {
    renderGame(endableState({ endDeclaredBy: 0 }), { online: true });

    clickEndTurn();

    expect(screen.getByText('Ending this turn ends the game')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /declare & end game/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /end turn & finish game/i })).toBeInTheDocument();
  });

  it('shows every player that the game will end after this turn', () => {
    // Bob's browser, watching Alice's declared turn.
    const state = endableState({ endDeclaredBy: 0, currentPlayerIndex: 0 });
    render(
      <GameContainer
        gameState={state}
        myPlayerIndex={1}
        onTilePlacement={noop}
        onFoundChain={noop}
        onChooseMergerSurvivor={noop}
        onPayMergerBonuses={noop}
        onMergerStockChoice={noop}
        onBuyStocks={noop}
        onEndTurn={noop}
        onDeclareGameEnd={async () => true}
        onNewGame={noop}
      />
    );

    expect(
      screen.getByText('Alice has declared the game will end after this turn.')
    ).toBeInTheDocument();
  });

  it('shows every player that the condition is met while nobody has declared', () => {
    renderGame(endableState(), { online: true });

    expect(screen.getByText('The game can now be ended.')).toBeInTheDocument();
  });

  // The gate only widens once a condition holds — with none met, nothing about
  // the buy phase changes.
  it('is byte-identical to before when no condition is met', async () => {
    const { onEndTurn } = renderGame(
      makeGameState({ stocksPurchasedThisTurn: 3 }), { online: true },
    );

    expect(screen.queryByRole('button', { name: /end turn/i })).not.toBeInTheDocument();
    await waitFor(() => expect(onEndTurn).toHaveBeenCalled(), { timeout: 2000 });
  });

  // Local hot-seat play keeps the engine's automatic end (see Out of Scope).
  it('leaves local hot-seat play auto-ending as before', async () => {
    const { onEndTurn } = renderGame(endableState());

    await waitFor(() => expect(onEndTurn).toHaveBeenCalled(), { timeout: 2000 });
  });
});


// =============================================================================
// Epic 17.4 — the turn stays open while a card is still worth playing
// =============================================================================
// The third term of the same gate Epic 14 widened with canSellAnything and
// Epic 18 with canDeclareGameEnd. The failure this prevents is specific: the
// turn where nothing is affordable is precisely the turn Free Shares exists
// for, and auto-ending it takes the card off the table at the only moment it
// matters. The opposite failure matters just as much — a turn that never ends
// on its own because the player holds a card with no possible use.
describe('GameContainer — auto-end and power cards', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  const cardsOn = { ...DEFAULT_RULES, powerCards: 'on' as const };

  /** A broke player: nothing on the board is affordable. */
  const brokeState = (powerCards: GameState['players'][number]['powerCards']) => {
    const state = makeGameState({ rulesSnapshot: cardsOn });
    state.players[0] = { ...state.players[0], cash: 0, powerCards };
    return state;
  };

  it('does not auto-end a turn where nothing is affordable but Free Shares is held', async () => {
    const { onEndTurn } = renderGame(brokeState(['free_stock']), {
      online: true, withPowerCards: true,
    });

    await new Promise((r) => setTimeout(r, 1200));
    expect(onEndTurn).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /end turn/i })).toBeInTheDocument();
  });

  it('does not auto-end with the full allowance spent and a usable Stock Trade in hand', async () => {
    const state = makeGameState({
      rulesSnapshot: cardsOn,
      stocksPurchasedThisTurn: 3,
    });
    state.players[0] = {
      ...state.players[0],
      powerCards: ['stock_trade'],
      stocks: { ...state.players[0].stocks, sackson: 2 },
    };
    // Bought a different chain, so the sackson shares are still tradeable.
    const { onEndTurn } = renderGame(state, { online: true, withPowerCards: true });

    await new Promise((r) => setTimeout(r, 1200));
    expect(onEndTurn).not.toHaveBeenCalled();
  });

  it('still auto-ends for a player holding only Stock Trade with nothing tradeable', async () => {
    const { onEndTurn } = renderGame(brokeState(['stock_trade']), {
      online: true, withPowerCards: true,
    });

    await waitFor(() => expect(onEndTurn).toHaveBeenCalled());
  });

  it('still auto-ends for a player holding only the two placement cards', async () => {
    const { onEndTurn } = renderGame(brokeState(['extra_tiles', 'multi_tile']), {
      online: true, withPowerCards: true,
    });

    await waitFor(() => expect(onEndTurn).toHaveBeenCalled());
  });

  it('is byte-identical to today with the rule off', async () => {
    const state = makeGameState({ rulesSnapshot: { ...DEFAULT_RULES, powerCards: 'off' } });
    state.players[0] = { ...state.players[0], cash: 0, powerCards: ['free_stock'] };
    const { onEndTurn } = renderGame(state, { online: true, withPowerCards: true });

    await waitFor(() => expect(onEndTurn).toHaveBeenCalled());
  });

  it('is byte-identical to today once every card is spent', async () => {
    const { onEndTurn } = renderGame(brokeState([]), { online: true, withPowerCards: true });

    await waitFor(() => expect(onEndTurn).toHaveBeenCalled());
  });

  it('names a card the player is about to forfeit when they end the turn', () => {
    const state = makeGameState({ rulesSnapshot: cardsOn });
    state.players[0] = { ...state.players[0], powerCards: ['extra_buy'] };
    renderGame(state, { online: true, withPowerCards: true });

    clickEndTurn();

    expect(screen.getByText(/you can still play/i)).toBeInTheDocument();
    expect(screen.getByText(/Extra Purchase/)).toBeInTheDocument();
  });
});

// =============================================================================
// Epic 17.10 / 17.11 — the card bar and the buy panel
// =============================================================================
describe('GameContainer — power card bar', () => {
  const cardsOn = { ...DEFAULT_RULES, powerCards: 'on' as const };

  // Opponents' remaining cards render on their own PlayerCards further down the
  // same rail, so queries here are scoped to the player's own bar.
  const bar = () => within(screen.getByRole('group', { name: /your power cards/i }));

  it('is hidden entirely when the rule is off', () => {
    const state = makeGameState({ rulesSnapshot: { ...DEFAULT_RULES, powerCards: 'off' } });
    state.players[0] = { ...state.players[0], powerCards: ['extra_buy'] };
    renderGame(state, { online: true, withPowerCards: true });

    expect(screen.queryByText('Your Cards')).not.toBeInTheDocument();
  });

  it('shows all five cards, spent ones included, when the rule is on', () => {
    const state = makeGameState({ rulesSnapshot: cardsOn });
    state.players[0] = { ...state.players[0], powerCards: ['extra_buy', 'multi_tile'] };
    renderGame(state, { online: true, withPowerCards: true });

    expect(screen.getByText('Your Cards')).toBeInTheDocument();
    expect(bar().getByRole('button', { name: /Extra Purchase — playable/ })).toBeInTheDocument();
    expect(bar().getByRole('button', { name: /Free Shares — spent/ })).toBeInTheDocument();
    // Building Spree is a placement card, so it is blocked during the buy phase.
    expect(bar().getByRole('button', { name: /Building Spree — blocked/ })).toBeInTheDocument();
  });

  it('opens a dialog offering Play card only for a legal card', () => {
    const state = makeGameState({ rulesSnapshot: cardsOn });
    state.players[0] = { ...state.players[0], powerCards: ['extra_buy'] };
    const { onPlayPowerCard } = renderGame(state, { online: true, withPowerCards: true });

    fireEvent.click(bar().getByRole('button', { name: /Extra Purchase — playable/ }));
    expect(screen.getByText(/spent as soon as you play it/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^play card$/i }));
    expect(onPlayPowerCard).toHaveBeenCalledWith('extra_buy');
  });

  it('explains a spent card read-only rather than dead-ending', () => {
    const state = makeGameState({ rulesSnapshot: cardsOn });
    state.players[0] = { ...state.players[0], powerCards: [] };
    renderGame(state, { online: true, withPowerCards: true });

    fireEvent.click(bar().getByRole('button', { name: /Free Shares — spent/ }));

    expect(screen.getByText(/you have already spent this card/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^play card$/i })).not.toBeInTheDocument();
  });

  it('gives the reason from the shared legality helper on a blocked card', () => {
    const state = makeGameState({ rulesSnapshot: cardsOn, stocksPurchasedThisTurn: 1 });
    state.players[0] = { ...state.players[0], powerCards: ['extra_buy'] };
    renderGame(state, { online: true, withPowerCards: true });

    fireEvent.click(bar().getByRole('button', { name: /Extra Purchase — blocked/ }));

    expect(screen.getByText(/only before you buy shares this turn/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^play card$/i })).not.toBeInTheDocument();
  });

  it('reads an allowance of 5 under Extra Purchase', () => {
    const state = makeGameState({
      rulesSnapshot: cardsOn,
      activePowerCard: { card: 'extra_buy', tradesUsed: 0 },
    });
    renderGame(state, { online: true, withPowerCards: true });

    expect(screen.getByText(/5 of 5 remaining/)).toBeInTheDocument();
  });

  it('shows Free under Free Shares, with the market price struck through', () => {
    const state = makeGameState({
      rulesSnapshot: cardsOn,
      activePowerCard: { card: 'free_stock', tradesUsed: 0 },
    });
    renderGame(state, { online: true, withPowerCards: true });

    expect(screen.getByText('Free')).toBeInTheDocument();
    // The cap is still 3 — one card per turn, so this never stacks into 5.
    expect(screen.getByText(/3 of 3 remaining/)).toBeInTheDocument();
  });
});

// =============================================================================
// Epic 17.9 — Building Spree, from the player's side
// =============================================================================
describe('GameContainer — Building Spree controls', () => {
  const cardsOn = { ...DEFAULT_RULES, powerCards: 'on' as const };

  const spreeState = (tilesPlacedThisTurn: number) =>
    makeGameState({
      phase: 'place_tile',
      rulesSnapshot: cardsOn,
      activePowerCard: { card: 'multi_tile', tradesUsed: 0 },
      tilesPlacedThisTurn,
    });

  it('offers Done placing once a tile is down, and reports progress', () => {
    render(
      <GameContainer
        gameState={spreeState(2)}
        myPlayerIndex={0}
        onTilePlacement={noop}
        onFoundChain={noop}
        onChooseMergerSurvivor={noop}
        onPayMergerBonuses={noop}
        onMergerStockChoice={noop}
        onBuyStocks={noop}
        onEndTurn={noop}
        onPlayPowerCard={noop}
        onEndPlacements={noop}
        onNewGame={noop}
      />
    );

    expect(screen.getByRole('button', { name: /done placing \(2\/4\)/i })).toBeInTheDocument();
    expect(screen.getByText(/place a tile \(2\/4\)/i)).toBeInTheDocument();
  });

  it('does not offer Done placing before the first tile of the turn', () => {
    render(
      <GameContainer
        gameState={spreeState(0)}
        myPlayerIndex={0}
        onTilePlacement={noop}
        onFoundChain={noop}
        onChooseMergerSurvivor={noop}
        onPayMergerBonuses={noop}
        onMergerStockChoice={noop}
        onBuyStocks={noop}
        onEndTurn={noop}
        onPlayPowerCard={noop}
        onEndPlacements={noop}
        onNewGame={noop}
      />
    );

    expect(screen.queryByRole('button', { name: /done placing/i })).not.toBeInTheDocument();
  });
});
