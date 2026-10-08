import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_RULES, MULTI_TILE_LIMIT, getEligibleChains } from './rules';

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

import { reindexPlayers, resetReadyFlags, transferHost, refillHand, phaseAfterPlacement, MIN_PLAYERS_TO_START, ROOM_CAPACITY } from './players';
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


// =============================================================================
// Epic 17.1 — refillHand
// =============================================================================
// The blocking prerequisite for Building Spree and Extra Tiles. "Draw one tile"
// was only ever correct because exactly one tile had been placed; these tests
// pin the restated invariant AND that ordinary play is unchanged by it.
describe('refillHand', () => {
  const bagOf = (n: number) => Array.from({ length: n }, (_, i) => `bag-${i}`);

  it('draws exactly one tile for an ordinary turn — byte-identical to before', () => {
    const { tiles, bag } = refillHand(['a', 'b', 'c', 'd', 'e'], bagOf(20), 6);
    expect(tiles).toHaveLength(6);
    expect(bag).toHaveLength(19);
    // Drawn from the end, exactly as tileBag.pop() did.
    expect(tiles[5]).toBe('bag-19');
  });

  it('draws nothing when the hand is already at the limit', () => {
    const bag = bagOf(20);
    const res = refillHand(['a', 'b', 'c', 'd', 'e', 'f'], bag, 6);
    expect(res.tiles).toHaveLength(6);
    expect(res.bag).toHaveLength(20);
  });

  // The Extra Tiles drought is a consequence of this rule, not a mechanism of
  // its own: at 11 tiles the refill draws zero until normal play comes back down.
  it('draws nothing when the hand is above the limit', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);
    const res = refillHand(eleven, bagOf(20), 6);
    expect(res.tiles).toHaveLength(11);
    expect(res.bag).toHaveLength(20);
  });

  it('tops up by four after a Building Spree', () => {
    const res = refillHand(['a', 'b'], bagOf(20), 6);
    expect(res.tiles).toHaveLength(6);
    expect(res.bag).toHaveLength(16);
  });

  it('stops early and cleanly when the bag runs dry', () => {
    const res = refillHand(['a'], bagOf(2), 6);
    expect(res.tiles).toHaveLength(3);
    expect(res.bag).toEqual([]);
  });

  it('ends the turn cleanly on an empty bag instead of throwing', () => {
    const res = refillHand(['a', 'b', 'c'], [], 6);
    expect(res.tiles).toEqual(['a', 'b', 'c']);
    expect(res.bag).toEqual([]);
  });

  it('follows the room hand limit, not a hardcoded 6', () => {
    expect(refillHand(['a'], bagOf(20), 7).tiles).toHaveLength(7);
    expect(refillHand(['a'], bagOf(20), 5).tiles).toHaveLength(5);
  });

  it("does not mutate the caller's arrays", () => {
    const tiles = ['a'];
    const bag = bagOf(3);
    refillHand(tiles, bag, 6);
    expect(tiles).toEqual(['a']);
    expect(bag).toHaveLength(3);
  });
});

// =============================================================================
// Epic 17.9 — phaseAfterPlacement
// =============================================================================
// The one shared answer for all four placement exits (grow, isolated, found,
// merger). A missed exit strands a spree in place_tile forever, so the point of
// the helper is that there is only one of it.
describe('phaseAfterPlacement', () => {
  const rules = { ...DEFAULT_RULES };
  // An empty board and a hand of isolated tiles: everything is legally placeable.
  const board: Record<string, any> = {};
  const chains: Record<string, any> = {};
  const hand = ['1A', '3C', '5F', '7H'];

  const call = (over: Partial<Parameters<typeof phaseAfterPlacement>[0]> = {}) =>
    phaseAfterPlacement({
      activePowerCard: { card: 'multi_tile', tradesUsed: 0 },
      tilesPlacedThisTurn: 1,
      playerTiles: hand,
      board,
      chains,
      rules,
      ...over,
    });

  it('goes to buy_stock with no card active — today\'s behaviour, unchanged', () => {
    expect(call({ activePowerCard: null })).toBe('buy_stock');
  });

  it('goes to buy_stock under any card other than Building Spree', () => {
    expect(call({ activePowerCard: { card: 'extra_tiles', tradesUsed: 0 } })).toBe('buy_stock');
  });

  it('stays in place_tile through the spree budget', () => {
    for (const placed of [1, 2, 3]) {
      expect(call({ tilesPlacedThisTurn: placed })).toBe('place_tile');
    }
  });

  it('leaves for the buy phase once the fourth tile is down', () => {
    expect(call({ tilesPlacedThisTurn: MULTI_TILE_LIMIT })).toBe('buy_stock');
  });

  // The unplayable-tile modal is for the *start* of a turn; running dry
  // mid-spree just ends the spree.
  it('leaves for the buy phase when the hand is empty', () => {
    expect(call({ playerTiles: [] })).toBe('buy_stock');
  });

  it('leaves for the buy phase when every remaining tile is dead', () => {
    // Every eligible chain active, so a tile touching a loose tile can found
    // nothing — and 5F is adjacent to the loose 4F below.
    const allActive = Object.fromEntries(
      getEligibleChains(rules).map((c) => [c, { tiles: [], isActive: true, isSafe: false }]),
    );
    expect(call({
      playerTiles: ['5F'],
      board: { '4F': { id: '4F', placed: true, chain: null } },
      chains: allActive,
    })).toBe('buy_stock');
  });
});
