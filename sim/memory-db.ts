// =============================================================================
// memory-db — an in-memory stand-in for the Postgres backend in server/lib/db
// =============================================================================
// This is the single reason the simulator can run the *real* engine. Everything
// in server/api/game-action.ts is pure computation except its calls through the
// `db.from(...)` shim; swap the storage and handleGameAction becomes a fast
// synchronous state machine over plain objects. No engine logic is reimplemented
// here — if it were, every conclusion downstream would describe a game nobody
// plays.
//
// Two properties matter and are deliberate:
//
//  * Reads return deep copies. The production shim hands back rows freshly
//    decoded from the wire, and the engine relies on that: calculateFinalScores
//    shallow-copies its player list and then zeroes `player.stocks[chain]`,
//    which would corrupt the authoritative table if we returned live
//    references. Copying on read reproduces the boundary exactly.
//  * Writes merge, they do not replace. `update({...})` sets only the named
//    columns, like SQL.
//
// The raw `query()` surface is intentionally minimal: the only raw statements
// the engine path reaches are results.ts's game-over gate and the recording it
// guards. The gate is answered honestly; the recording queries return no rows,
// so recordGameResult exits at its first lookup. The simulator computes its own
// metrics (sim/metrics.ts) from the same calculateFinalScores production uses,
// so nothing is lost by not reproducing the stats tables.
// =============================================================================

import type { DbBackend, Exec } from '../server/lib/db';

type Row = Record<string, any>;
type Result = { data: any; error: Error | null };

export type Tables = Record<string, Row[]>;

/**
 * Deep copy for JSON-shaped data — which is all these tables ever hold, because
 * every column is a Postgres scalar, text[] or jsonb. Hand-rolled rather than
 * structuredClone because copying is the simulator's single hottest operation
 * (three reads per engine action, one of them the whole board) and this is
 * about 3x faster on exactly this shape.
 */
function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = clone(value[i]);
    return out as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const key in value) out[key] = clone((value as Record<string, unknown>)[key]);
  return out as T;
}

let idCounter = 0;
export function nextId(prefix = 'row'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

class MemoryQueryBuilder implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private values: Row = {};
  private filters: [string, any][] = [];
  private orderCol: string | null = null;
  private wantSingle = false;

  constructor(private rows: Row[]) {}

  select(_cols = '*') { this.op = 'select'; return this; }
  insert(obj: Row) { this.op = 'insert'; this.values = obj; return this; }
  update(obj: Row) { this.op = 'update'; this.values = obj; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col: string, val: any) { this.filters.push([col, val]); return this; }
  order(col: string) { this.orderCol = col; return this; }
  single() { this.wantSingle = true; return this; }

  private matches(row: Row): boolean {
    return this.filters.every(([col, val]) => row[col] === val);
  }

  private exec(): Result {
    switch (this.op) {
      case 'select': {
        let hits = this.rows.filter((r) => this.matches(r));
        if (this.orderCol) {
          const col = this.orderCol;
          hits = [...hits].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0));
        }
        // Column projection is ignored on purpose: every caller reads named
        // fields off the row, so handing back the whole row is a superset of
        // what SELECT would return and can never make a handler take a
        // different branch.
        return { data: this.wantSingle ? (hits[0] ? clone(hits[0]) : null) : clone(hits), error: null };
      }
      case 'insert': {
        const row = clone(this.values);
        if (row.id === undefined) row.id = nextId();
        this.rows.push(row);
        return { data: null, error: null };
      }
      case 'update': {
        for (const row of this.rows) {
          if (this.matches(row)) Object.assign(row, clone(this.values));
        }
        return { data: null, error: null };
      }
      case 'delete': {
        for (let i = this.rows.length - 1; i >= 0; i--) {
          if (this.matches(this.rows[i])) this.rows.splice(i, 1);
        }
        return { data: null, error: null };
      }
    }
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: any) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    // Resolved synchronously into an already-settled promise: the engine awaits
    // every call, so this still yields to the microtask queue exactly once,
    // like the real shim, but never waits on I/O.
    try {
      return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
    } catch (err) {
      return Promise.resolve({ data: null, error: err as Error }).then(onfulfilled, onrejected);
    }
  }
}

export class MemoryDb implements DbBackend {
  tables: Tables = {};

  private rowsFor(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = [];
    return this.tables[table];
  }

  from(table: string) {
    return new MemoryQueryBuilder(this.rowsFor(table));
  }

  /** Direct, uncopied access — for the harness's own bookkeeping, not the engine. */
  rows(table: string): Row[] {
    return this.rowsFor(table);
  }

  async query<T = Row>(text: string, params: any[] = []): Promise<T[]> {
    // results.ts's gate: "is this room finished?". Answered for real so the
    // engine's exit path behaves as it does in production.
    if (/FROM game_states\s+WHERE room_id = \$1 AND phase = 'game_over'/i.test(text)) {
      const hit = this.rowsFor('game_states').some(
        (r) => r.room_id === params[0] && r.phase === 'game_over',
      );
      return (hit ? [{ '?column?': 1 }] : []) as unknown as T[];
    }
    // Everything else is the statistics recording path. Returning no rows makes
    // recordGameResult bail at its first lookup, which is what we want: the
    // simulator does not populate the dashboard's tables.
    return [] as unknown as T[];
  }

  async withTransaction<T>(fn: (exec: Exec) => Promise<T>): Promise<T> {
    // No isolation to model: the simulator is single-threaded per game.
    return fn(async (text, p = []) => this.query(text, p) as Promise<Row[]>);
  }

  /** A restorable copy of the whole world. This is what a rollout branches from. */
  snapshot(): Tables {
    return clone(this.tables);
  }

  restore(snapshot: Tables): void {
    this.tables = clone(snapshot);
  }

  reset(): void {
    this.tables = {};
  }
}
