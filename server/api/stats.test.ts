import { describe, it, expect, vi, beforeEach } from 'vitest';

// /api/stats is the only unauthenticated endpoint in the codebase. These tests
// exist mostly to hold that line: it must stay read-only, and no payload may
// ever leak an identifier that would let a stranger find or join a live game.

const executed: string[] = [];

// Rows shaped like the real queries, but deliberately seeded with identifiers
// (room codes, user ids, session ids) in adjacent columns — if a handler ever
// starts selecting them, the leak test below sees them.
vi.mock('../lib/db', () => ({
  query: vi.fn(async (text: string) => {
    executed.push(text);
    if (text.includes('FROM game_rooms')) {
      return [{ games_in_progress: '3', rooms_waiting: '2', longest_minutes: '47.4' }];
    }
    if (text.includes('FROM game_players gp')) return [{ players_in_game: '11' }];
    if (text.includes('COUNT(*) AS games_completed')) {
      return [{
        games_completed: '1204', games_today: '87', games_7d: '300', games_30d: '1204',
        avg_duration: '2705.4', avg_rounds: '26.2', avg_players: '3.6', avg_mergers: '4.3',
      }];
    }
    if (text.includes('jsonb_each_text(gr.rules)')) {
      return [
        { rule: 'chainSafety', value: 'none', games: '812' },
        { rule: 'chainSafety', value: '11', games: '392' },
        { rule: 'boardSize', value: 'large', games: '1100' },
      ];
    }
    if (text.includes('jsonb_each_text(gr.final_chains)')) {
      return [{ chain: 'continental', times_founded: '800', times_largest: '176', avg_size: '14.9', max_size: '41' }];
    }
    if (text.includes('AVG(winning_total)')) return [{ avg_total: '39284.2', max_total: '73065', min_total: '13840' }];
    if (text.includes('AVG(spread)')) return [{ avg_spread: '19727.3' }];
    if (text.includes('(winning_total / 10000)')) return [{ bucket: '30000', games: '351' }];
    if (text.includes('FROM game_result_players\n      GROUP BY 1')) {
      return [{ seat_type: 'human', seats: '3313', wins: '1008', avg_placement: '2.4', avg_total: '27486' }];
    }
    if (text.includes('ORDER BY p.final_total DESC')) {
      return [{ display_name: 'Ana', value: '73065', ended_at: '2026-08-19T21:52:00Z', room_code: 'SECRET1', user_id: 'u-1' }];
    }
    if (text.includes('ORDER BY duration_seconds DESC')) {
      return [{ display_name: 'Bruno', value: '9803', ended_at: '2026-08-26T21:38:00Z', room_code: 'SECRET2' }];
    }
    if (text.includes('ORDER BY rounds DESC')) return [{ display_name: 'Cleo', value: '41', ended_at: '2026-08-02T12:05:00Z' }];
    if (text.includes('ORDER BY largest_chain_size DESC')) {
      return [{ display_name: 'Dmitri', value: '38', ended_at: '2026-08-04T09:52:00Z', largest_chain: 'tower' }];
    }
    if (text.includes('ORDER BY s.spread DESC')) return [{ display_name: 'Elif', value: '58838', ended_at: '2026-08-25T18:00:00Z' }];
    if (text.includes('generate_series')) return [{ day: '2026-08-31', games: '65' }];
    if (text.includes('MIN(ended_at)')) return [{ since: '2026-08-02T09:00:00Z' }];
    if (text.includes('FROM game_result_players')) {
      return [{ seat_type: 'human', seats: '3313', wins: '1008', avg_placement: '2.4', avg_total: '27486' }];
    }
    return [];
  }),
}));

import stats, { clearStatsCache } from './stats';

const post = (op?: string) => stats(new Request('http://localhost/api/stats', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(op ? { op } : {}),
}));

beforeEach(() => {
  executed.length = 0;
  clearStatsCache();
});

const ALL_OPS = ['live', 'totals', 'rules', 'chains', 'economy', 'bots', 'records', 'activity', 'overview'];

describe('stats endpoint', () => {
  it('serves without an Authorization header', async () => {
    const res = await post('totals');
    expect(res.status).toBe(200);
  });

  it('rejects a GET', async () => {
    const res = await stats(new Request('http://localhost/api/stats'));
    expect(res.status).toBe(405);
  });

  it('rejects an unknown op instead of guessing', async () => {
    const res = await post('drop_tables');
    expect(res.status).toBe(400);
  });

  it('defaults to the overview when no op is given', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('totals');
  });

  it('only ever reads', async () => {
    for (const op of ALL_OPS) {
      clearStatsCache();
      await post(op);
    }
    const writes = executed.filter((sql) => /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i.test(sql));
    expect(writes).toEqual([]);
  });

  it('leaks no identifier in any payload', async () => {
    // The mocked rows carry room codes and user ids on purpose. Nothing that
    // could be used to find, join or attribute a game may reach the wire.
    const forbidden = /(room_code|room_id|user_id|session_id|host_user_id|SECRET\d)/i;
    for (const op of ALL_OPS) {
      clearStatsCache();
      const body = await (await post(op)).text();
      expect(body, `op ${op} leaked an identifier`).not.toMatch(forbidden);
    }
  });

  it('exposes no per-game row for a game still in progress', async () => {
    const live = await (await post('live')).json() as any;
    expect(Object.keys(live).sort()).toEqual(
      ['gamesInProgress', 'longestRunningMinutes', 'playersInGame', 'roomsWaiting'],
    );
  });

  it('coerces Postgres numeric strings to numbers', async () => {
    const totals = await (await post('totals')).json() as any;
    expect(totals.gamesCompleted).toBe(1204);
    expect(totals.avgDurationSeconds).toBe(2705);
    expect(totals.avgRounds).toBe(26.2);
  });

  it('shapes the rule distribution as { rule: { value: games } }', async () => {
    const rules = await (await post('rules')).json() as any;
    expect(rules.chainSafety).toEqual({ none: 812, '11': 392 });
  });

  it('caches, so a refresh loop cannot hammer the database', async () => {
    await post('totals');
    const afterFirst = executed.length;
    await post('totals');
    await post('totals');
    expect(executed.length).toBe(afterFirst);
  });

  it('caches each op separately', async () => {
    await post('totals');
    const afterTotals = executed.length;
    await post('activity');
    expect(executed.length).toBeGreaterThan(afterTotals);
  });
});
