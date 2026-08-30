import { describe, it, expect, vi, beforeEach } from 'vitest';

// A stand-in for the two tables Epic 16 writes, enforcing the constraint that
// makes recording safe to call from anywhere:
//   game_results.source_room_id UNIQUE
const resultsBySourceRoom = new Map<string, string>();
const resultRows: any[][] = [];
const seatRows: any[] = [];
let roomRow: any;
let stateRow: any;
let playerRows: any[];

vi.mock('./db', () => ({
  query: vi.fn(async (text: string, params: any[] = []) => {
    if (text.includes('FROM game_rooms')) return roomRow ? [roomRow] : [];
    if (text.includes('FROM game_states')) {
      if (text.includes("phase = 'game_over'")) {
        return stateRow?.phase === 'game_over' ? [{ '?column?': 1 }] : [];
      }
      return stateRow ? [stateRow] : [];
    }
    if (text.includes('SELECT id FROM game_results')) {
      const id = resultsBySourceRoom.get(params[0]);
      return id ? [{ id }] : [];
    }
    if (text.includes('FROM game_players')) return playerRows;
    return [];
  }),
  withTransaction: vi.fn(async (fn: any) => fn(async (text: string, params: any[] = []) => {
    if (text.includes('INSERT INTO game_results')) {
      const sourceRoomId = params[0];
      if (resultsBySourceRoom.has(sourceRoomId)) return []; // ON CONFLICT DO NOTHING
      const id = `result-${resultsBySourceRoom.size + 1}`;
      resultsBySourceRoom.set(sourceRoomId, id);
      resultRows.push(params);
      return [{ id }];
    }
    if (text.includes('INSERT INTO game_result_players')) {
      seatRows.push(params);
      return [];
    }
    return [];
  })),
}));

import {
  recordGameResult, recordIfFinished, scoreSeats, summariseChains, endReasonForAction,
} from './results';
import { query } from './db';

const noStocks = {
  sackson: 0, tower: 0, worldwide: 0, american: 0, festival: 0, continental: 0, imperial: 0,
};

const chainsWith = (sizes: Record<string, number>) =>
  Object.fromEntries(Object.keys(noStocks).map((name) => [
    name,
    {
      name,
      tiles: Array.from({ length: sizes[name] ?? 0 }, (_, i) => `${i}`),
      isActive: (sizes[name] ?? 0) > 0,
      isSafe: false,
    },
  ]));

beforeEach(() => {
  resultsBySourceRoom.clear();
  resultRows.length = 0;
  seatRows.length = 0;
  roomRow = { id: 'room-1', room_code: 'ABC123', created_at: '2026-08-31T12:00:00Z' };
  stateRow = {
    phase: 'game_over',
    chains: chainsWith({ tower: 12, american: 25 }),
    game_log: [
      { action: 'Placed tile' },
      { action: 'Merger complete' },
      { action: 'Merger auto-resolved' },
    ],
    round_number: 22,
    rules_snapshot: null,
    updated_at: '2026-08-31T13:00:00Z',
  };
  playerRows = [
    { player_index: 0, player_name: 'Ana', user_id: 'u1', is_bot: false, bot_difficulty: null, cash: 9000, stocks: { ...noStocks, american: 10 } },
    { player_index: 1, player_name: 'Bot (Hard)', user_id: null, is_bot: true, bot_difficulty: 'hard', cash: 4000, stocks: { ...noStocks, tower: 3 } },
  ];
});

describe('scoreSeats', () => {
  it('splits a final score into cash, share value and bonuses that add up', () => {
    const seats = scoreSeats(playerRows, stateRow.chains, 'standard');
    for (const seat of seats) {
      expect(seat.final_cash + seat.final_stock_value + seat.final_bonus_total)
        .toBe(seat.final_total);
    }
  });

  it('does not let the scorer strip the stocks it was handed', () => {
    // calculateFinalScores zeroes player.stocks as it liquidates, and its
    // {...p} copy is shallow — so a caller that passes the live objects loses
    // the portfolio it was trying to record.
    const before = JSON.parse(JSON.stringify(playerRows));
    const seats = scoreSeats(playerRows, stateRow.chains, 'standard');
    expect(playerRows).toEqual(before);
    expect(seats[0].stocks.american).toBe(10);
  });

  it('values a majority holding above bare cash', () => {
    const seats = scoreSeats(playerRows, stateRow.chains, 'standard');
    const ana = seats.find((s) => s.display_name === 'Ana')!;
    expect(ana.final_total).toBeGreaterThan(ana.final_cash);
    expect(ana.final_bonus_total).toBeGreaterThan(0);
  });
});

describe('summariseChains', () => {
  it('reports a size for every chain and picks the largest', () => {
    const { finalChains, largest } = summariseChains(chainsWith({ tower: 12, american: 25 }));
    expect(Object.keys(finalChains)).toHaveLength(7);
    expect(finalChains.worldwide).toBe(0);
    expect(largest).toEqual({ name: 'american', size: 25 });
  });

  it('has no largest chain when nothing was ever founded', () => {
    expect(summariseChains(chainsWith({})).largest).toBeNull();
  });
});

describe('endReasonForAction', () => {
  it('distinguishes the three ways a game ends', () => {
    expect(endReasonForAction('end_game_vote')).toBe('vote');
    expect(endReasonForAction('auto_end_turn')).toBe('auto');
    expect(endReasonForAction('place_tile')).toBe('threshold');
  });
});

describe('recordGameResult', () => {
  it('writes one result and one row per seat', async () => {
    expect(await recordGameResult('room-1', 'threshold')).toBe(true);
    expect(resultsBySourceRoom.size).toBe(1);
    expect(seatRows).toHaveLength(2);
  });

  it('is idempotent — a second call writes nothing', async () => {
    expect(await recordGameResult('room-1', 'threshold')).toBe(true);
    expect(await recordGameResult('room-1', 'threshold')).toBe(false);
    expect(resultsBySourceRoom.size).toBe(1);
    expect(seatRows).toHaveLength(2);
  });

  it('ranks placements by final total', async () => {
    await recordGameResult('room-1', 'threshold');
    // params: [result_id, user_id, display_name, seat_index, ...] placement at 10
    const placements = Object.fromEntries(seatRows.map((p) => [p[2], p[10]]));
    expect(placements).toEqual({ Ana: 1, 'Bot (Hard)': 2 });
  });

  it('counts both kinds of merger log entry', async () => {
    // The engine logs 'Merger complete' on the normal path and
    // 'Merger auto-resolved' when a merger resolves without a decision. Missing
    // the second would silently undercount every game that had one.
    await recordGameResult('room-1', 'threshold');
    const [row] = resultRows;
    expect(row[16]).toBe(2);          // mergers_count
    expect(row[5]).toBe(22);          // rounds
    expect(row[17]).toBe('american'); // largest_chain
    expect(row[18]).toBe(25);         // largest_chain_size
  });

  it('records the duration between room creation and the final state write', async () => {
    await recordGameResult('room-1', 'threshold');
    expect(resultRows[0][4]).toBe(3600); // one hour, in seconds
  });

  it('names the winner and their seat type', async () => {
    await recordGameResult('room-1', 'threshold');
    const [row] = resultRows;
    expect(row[10]).toBe('Ana');   // winner_name
    expect(row[11]).toBe(false);   // winner_is_bot
    expect(row[13]).toBeGreaterThan(9000); // winning_total beats bare cash
  });

  it('refuses to record a game that is not over', async () => {
    stateRow.phase = 'buy_stock';
    expect(await recordGameResult('room-1', 'threshold')).toBe(false);
    expect(resultsBySourceRoom.size).toBe(0);
  });

  it('records nothing for a room that no longer exists', async () => {
    roomRow = null;
    expect(await recordGameResult('room-1', 'threshold')).toBe(false);
  });

  it('falls back to the default rules when the snapshot is missing', async () => {
    stateRow.rules_snapshot = null;
    expect(await recordGameResult('room-1', 'threshold')).toBe(true);
  });

  it('never throws, whatever the database does', async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error('connection lost'));
    await expect(recordGameResult('room-1', 'threshold')).resolves.toBe(false);
  });
});

describe('recordIfFinished', () => {
  it('records a finished game', async () => {
    expect(await recordIfFinished('room-1', 'unknown')).toBe(true);
  });

  it('skips a game still in progress without touching the result tables', async () => {
    stateRow.phase = 'place_tile';
    expect(await recordIfFinished('room-1', 'unknown')).toBe(false);
    expect(resultsBySourceRoom.size).toBe(0);
  });
});
