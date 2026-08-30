import { describe, it, expect, vi, beforeEach } from 'vitest';

// A stand-in for game_players that enforces the real constraint:
//   unique_player_per_room UNIQUE (room_id, player_index)
// Any reindexing strategy that writes a seat while another row still holds it
// blows up here, exactly as Postgres would.
const seats = new Map<string, number>();
const statements: string[] = [];

const assertUnique = () => {
  const taken = [...seats.values()];
  if (new Set(taken).size !== taken.length) {
    throw new Error(`unique_player_per_room violated: ${taken.join(',')}`);
  }
};

vi.mock('./db', () => ({
  query: vi.fn(async (text: string, params: any[] = []) => {
    statements.push(text.trim().split('\n')[0]);
    if (text.includes('SELECT id FROM game_players')) {
      return [...seats.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([id]) => ({ id }));
    }
    return [];
  }),
  withTransaction: vi.fn(async (fn: (exec: (t: string, p?: any[]) => Promise<any[]>) => Promise<any>) =>
    fn(async (text: string, params: any[] = []) => {
      statements.push(text.trim().split('\n')[0]);
      if (text.startsWith('UPDATE game_players SET player_index')) {
        const [index, id] = params;
        seats.set(id, index);
        assertUnique();
      }
      if (text.includes('SELECT id FROM game_players')) {
        return [...seats.keys()].map((id) => ({ id }));
      }
      return [];
    }),
  ),
}));

import { reindexPlayers, resetReadyFlags, transferHost, MIN_PLAYERS_TO_START, ROOM_CAPACITY } from './players';
import { query } from './db';

beforeEach(() => {
  seats.clear();
  statements.length = 0;
  vi.clearAllMocks();
});

const seatOrder = () => [...seats.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);

describe('reindexPlayers', () => {
  it('seats the given ids at 0..n-1 in order', async () => {
    ['a', 'b', 'c'].forEach((id, i) => seats.set(id, i));

    await reindexPlayers('room-1', ['c', 'a', 'b']);

    expect(seats.get('c')).toBe(0);
    expect(seats.get('a')).toBe(1);
    expect(seats.get('b')).toBe(2);
  });

  // The whole reason the helper exists: a straight "write the new indices" loop
  // collides the moment two players swap.
  it('never violates the unique seat constraint while swapping two players', async () => {
    seats.set('a', 0);
    seats.set('b', 1);

    await expect(reindexPlayers('room-1', ['b', 'a'])).resolves.toBeUndefined();
    expect(seatOrder()).toEqual(['b', 'a']);
  });

  it('never violates the constraint on a full six-player reversal', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    ids.forEach((id, i) => seats.set(id, i));

    await reindexPlayers('room-1', [...ids].reverse());

    expect(seatOrder()).toEqual([...ids].reverse());
  });

  it('parks every row at a negative index before writing any final seat', async () => {
    ['a', 'b'].forEach((id, i) => seats.set(id, i));
    await reindexPlayers('room-1', ['b', 'a']);

    const updates = statements.filter((s) => s.startsWith('UPDATE game_players SET player_index'));
    // 2 parking writes + 2 final writes, and the lock comes first.
    expect(updates).toHaveLength(4);
    expect(statements[0]).toContain('FOR UPDATE');
  });

  it('does nothing for an empty room', async () => {
    await reindexPlayers('room-1', []);
    expect(statements).toHaveLength(0);
  });
});

describe('resetReadyFlags', () => {
  // Bots are permanently ready; resetting them would deadlock a room that is
  // waiting on "every player ready".
  it('clears human ready flags only', async () => {
    await resetReadyFlags('room-1');
    const [text, params] = vi.mocked(query).mock.calls[0];
    expect(text).toContain('is_ready = false');
    expect(text).toContain('is_bot = false');
    expect(params).toEqual(['room-1']);
  });
});

describe('transferHost', () => {
  it('hands the room to the earliest-joined remaining human', async () => {
    vi.mocked(query).mockResolvedValueOnce([{ user_id: 'user-2' }] as never);

    expect(await transferHost('room-1')).toBe('user-2');

    const selectText = vi.mocked(query).mock.calls[0][0];
    expect(selectText).toContain('is_bot = false');
    expect(selectText).toContain('ORDER BY created_at');
    expect(vi.mocked(query).mock.calls[1]).toEqual([
      'UPDATE game_rooms SET host_user_id = $1 WHERE id = $2',
      ['user-2', 'room-1'],
    ]);
  });

  it('leaves the room hostless when only bots remain', async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    expect(await transferHost('room-1')).toBeNull();
  });
});

describe('room constants', () => {
  it('starts at two players and holds six', () => {
    expect(MIN_PLAYERS_TO_START).toBe(2);
    expect(ROOM_CAPACITY).toBe(6);
  });
});
