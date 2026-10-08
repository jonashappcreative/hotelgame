import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WaitingRoom } from './WaitingRoom';
import { DEFAULT_RULES } from '@/types/game';
import type { LobbyPlayer } from './PlayerList';

const player = (overrides: Partial<LobbyPlayer> & { player_index: number }): LobbyPlayer => ({
  id: `p${overrides.player_index}`,
  player_name: `Player ${overrides.player_index}`,
  is_ready: false,
  ...overrides,
});

const renderRoom = (props: Partial<React.ComponentProps<typeof WaitingRoom>> = {}) => {
  const handlers = {
    onLeaveRoom: vi.fn(),
    onToggleReady: vi.fn(),
    onEditRules: vi.fn(),
    onSetTurnOrderMode: vi.fn(),
    onSetPlayerOrder: vi.fn(),
    onAddBot: vi.fn(),
    onRemoveBot: vi.fn(),
  };
  render(
    <WaitingRoom
      roomCode="ABC123"
      players={[player({ player_index: 0 }), player({ player_index: 1 })]}
      myPlayerIndex={0}
      capacity={6}
      rules={DEFAULT_RULES}
      turnOrderMode="random"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
};

beforeEach(() => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
});

describe('WaitingRoom — seats', () => {
  // Before Epic 15 the room rendered max_players empty slots; with no fixed
  // player count there is nothing to count down to, just "room for more".
  it('renders exactly one Waiting… placeholder while under capacity', () => {
    renderRoom();
    expect(screen.getAllByText('Waiting…')).toHaveLength(1);
  });

  it('renders no placeholder once the room is full', () => {
    renderRoom({
      players: Array.from({ length: 6 }, (_, i) => player({ player_index: i })),
    });
    expect(screen.queryByText('Waiting…')).not.toBeInTheDocument();
  });

  it('marks the local player', () => {
    renderRoom();
    expect(screen.getByText('You')).toBeInTheDocument();
  });
});

describe('WaitingRoom — start condition', () => {
  it('asks for more players below the two-player minimum', () => {
    renderRoom({ players: [player({ player_index: 0 })] });
    expect(screen.getByText(/at least 2 players/i)).toBeInTheDocument();
  });

  // Bots are permanently ready, so only the humans are counted.
  it('counts only humans towards ready', () => {
    renderRoom({
      players: [
        player({ player_index: 0, is_ready: true }),
        player({ player_index: 1 }),
        player({ player_index: 2, is_bot: true, is_ready: true }),
      ],
    });
    expect(screen.getByText('1/2 players ready')).toBeInTheDocument();
  });

  it('announces the start once every human is ready', () => {
    renderRoom({
      players: [
        player({ player_index: 0, is_ready: true }),
        player({ player_index: 1, is_ready: true }),
      ],
    });
    expect(screen.getByText(/starting game/i)).toBeInTheDocument();
  });
});

describe('WaitingRoom — rules panel', () => {
  it('shows the room rules to everyone', () => {
    renderRoom();
    expect(screen.getByText('Room Rules')).toBeInTheDocument();
    // Derived from DEFAULT_RULES, so a default room describes itself honestly.
    expect(screen.getByText('Aggressive — no safe chains')).toBeInTheDocument();
  });

  it('offers Edit Rules to the host only', () => {
    renderRoom({ isHost: true });
    expect(screen.getByRole('button', { name: /edit rules/i })).toBeInTheDocument();
  });

  it('shows non-hosts a read-only panel', () => {
    renderRoom({ isHost: false });
    expect(screen.queryByRole('button', { name: /edit rules/i })).not.toBeInTheDocument();
    expect(screen.getByText(/only the host can change the rules/i)).toBeInTheDocument();
  });
});

describe('WaitingRoom — turn order', () => {
  it('hides seat numbers and explains the shuffle in Random mode', () => {
    renderRoom({ isHost: true, turnOrderMode: 'random' });
    expect(screen.getByText(/randomised when the game starts/i)).toBeInTheDocument();
    expect(screen.getAllByText('•').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /shuffle/i })).not.toBeInTheDocument();
  });

  it('shows real seat numbers and a Shuffle button in Custom mode', () => {
    renderRoom({ isHost: true, turnOrderMode: 'manual' });
    expect(screen.getByText(/drag players to set the turn order/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /shuffle/i })).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('submits a new order when the host shuffles', () => {
    const handlers = renderRoom({ isHost: true, turnOrderMode: 'manual' });
    fireEvent.click(screen.getByRole('button', { name: /shuffle/i }));

    expect(handlers.onSetPlayerOrder).toHaveBeenCalledTimes(1);
    const ids = handlers.onSetPlayerOrder.mock.calls[0][0];
    expect([...ids].sort()).toEqual(['p0', 'p1']);
  });

  it('gives a non-host neither the mode switch nor drag handles', () => {
    renderRoom({ isHost: false, turnOrderMode: 'manual' });
    expect(screen.queryByRole('group', { name: /turn order/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /shuffle/i })).not.toBeInTheDocument();
    expect(screen.getByText(/host is arranging the turn order/i)).toBeInTheDocument();
  });

  it('lets the host switch between Random and Custom', () => {
    const handlers = renderRoom({ isHost: true, turnOrderMode: 'random' });
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(handlers.onSetTurnOrderMode).toHaveBeenCalledWith('manual');
  });
});

describe('WaitingRoom — bots', () => {
  it('offers Add Bot to the host while there is room', () => {
    renderRoom({ isHost: true });
    expect(screen.getByRole('button', { name: /add bot/i })).toBeInTheDocument();
  });

  it('hides Add Bot from non-hosts', () => {
    renderRoom({ isHost: false });
    expect(screen.queryByRole('button', { name: /add bot/i })).not.toBeInTheDocument();
  });

  it('lets the host remove a bot by its seat', () => {
    const handlers = renderRoom({
      isHost: true,
      players: [player({ player_index: 0 }), player({ player_index: 1, is_bot: true, is_ready: true })],
    });
    fireEvent.click(screen.getByRole('button', { name: /remove player 1/i }));
    expect(handlers.onRemoveBot).toHaveBeenCalledWith(1);
  });
});

describe('WaitingRoom — room code', () => {
  it('copies the code to the clipboard', () => {
    renderRoom();
    fireEvent.click(screen.getByRole('button', { name: /copy room code/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABC123');
  });

  it('blocks Leave while the player is ready', () => {
    renderRoom({ players: [player({ player_index: 0, is_ready: true }), player({ player_index: 1 })] });
    expect(screen.getByRole('button', { name: /leave/i })).toBeDisabled();
  });
});
