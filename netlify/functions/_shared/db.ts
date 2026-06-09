// =============================================================================
// Minimal Supabase-compatible query shim over the Neon serverless driver.
// =============================================================================
// The ported game-action handler uses only a small subset of the Supabase
// client API:
//
//   db.from(t).select('*').eq('a', x).eq('b', y).single()
//   db.from(t).select('*').eq('a', x).order('player_index')
//   db.from(t).insert({ ... })
//   db.from(t).update({ ... }).eq('id', id)
//   db.from(t).delete().eq('room_id', roomId)
//
// Each builder is awaitable and resolves to `{ data, error }`, matching the
// Supabase shape so the rest of the handler is unchanged. Identifiers (table
// and column names) come from our own trusted code; all values are bound as
// parameters.
// =============================================================================

import pg from 'pg';
const { Pool, types } = pg;

// int8 (bigint, OID 20) → JS number. Our only bigint is turn_deadline_epoch
// (epoch seconds), well within Number.MAX_SAFE_INTEGER.
types.setTypeParser(20, (v: string | null) => (v === null ? null : Number(v)));

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    'db: no connection string — set DATABASE_URL in the environment.',
  );
}

const pool = new Pool({ connectionString, max: 20, idleTimeoutMillis: 30000 });

// Columns that are jsonb (must be JSON-encoded and cast ::jsonb).
const JSONB_COLUMNS = new Set([
  'stocks', 'custom_rules', 'board', 'chains', 'stock_bank',
  'merger', 'game_log', 'rules_snapshot',
]);

// Columns that are Postgres text[] (bound as a JS array, cast ::text[]).
const ARRAY_COLUMNS = new Set([
  'tiles', 'tile_bag', 'pending_chain_foundation', 'end_game_votes',
]);

type Row = Record<string, any>;
type Result = { data: any; error: Error | null };

// Encode a column value: returns the SQL placeholder and pushes the bound param.
function encodeValue(col: string, val: any, params: any[]): string {
  if (JSONB_COLUMNS.has(col)) {
    if (val === null || val === undefined) {
      params.push(null);
      return `$${params.length}::jsonb`;
    }
    params.push(JSON.stringify(val));
    return `$${params.length}::jsonb`;
  }
  if (ARRAY_COLUMNS.has(col)) {
    if (val === null || val === undefined) {
      params.push(null);
      return `$${params.length}::text[]`;
    }
    params.push(val);
    return `$${params.length}::text[]`;
  }
  params.push(val === undefined ? null : val);
  return `$${params.length}`;
}

class QueryBuilder implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private cols = '*';
  private values: Row = {};
  private filters: [string, any][] = [];
  private orderCol: string | null = null;
  private wantSingle = false;

  constructor(private table: string) {}

  select(cols = '*') { this.op = 'select'; this.cols = cols; return this; }
  insert(obj: Row) { this.op = 'insert'; this.values = obj; return this; }
  update(obj: Row) { this.op = 'update'; this.values = obj; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col: string, val: any) { this.filters.push([col, val]); return this; }
  order(col: string) { this.orderCol = col; return this; }
  single() { this.wantSingle = true; return this; }

  private buildWhere(params: any[]): string {
    if (this.filters.length === 0) return '';
    const clauses = this.filters.map(([col, val]) => {
      params.push(val);
      return `${col} = $${params.length}`;
    });
    return ` WHERE ${clauses.join(' AND ')}`;
  }

  private build(): { text: string; params: any[] } {
    const params: any[] = [];
    switch (this.op) {
      case 'select': {
        let text = `SELECT ${this.cols} FROM ${this.table}${this.buildWhere(params)}`;
        if (this.orderCol) text += ` ORDER BY ${this.orderCol}`;
        return { text, params };
      }
      case 'insert': {
        const cols = Object.keys(this.values);
        const placeholders = cols.map((c) => encodeValue(c, this.values[c], params));
        const text = `INSERT INTO ${this.table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
        return { text, params };
      }
      case 'update': {
        const cols = Object.keys(this.values);
        const sets = cols.map((c) => `${c} = ${encodeValue(c, this.values[c], params)}`);
        const text = `UPDATE ${this.table} SET ${sets.join(', ')}${this.buildWhere(params)}`;
        return { text, params };
      }
      case 'delete':
        return { text: `DELETE FROM ${this.table}${this.buildWhere(params)}`, params };
    }
  }

  private async exec(): Promise<Result> {
    try {
      const { text, params } = this.build();
      const res = await pool.query(text, params);
      if (this.op === 'select') {
        const rows = res.rows as Row[];
        return { data: this.wantSingle ? (rows[0] ?? null) : rows, error: null };
      }
      return { data: null, error: null };
    } catch (err) {
      return { data: null, error: err as Error };
    }
  }

  // PromiseLike: lets callers `await db.from(...)...`
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

export const db = {
  from(table: string) {
    return new QueryBuilder(table);
  },
};

export type Db = typeof db;

// Raw parameterized query — used by the auth endpoints which need RETURNING
// and other shapes the shim doesn't cover.
export async function query<T = Row>(text: string, params: any[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
