-- =============================================================================
-- Acquire — Netlify DB (Neon Postgres) consolidated schema
-- =============================================================================
-- This is the single, idempotent schema for the post-Supabase backend.
-- It replaces the entire supabase/migrations/ history.
--
-- Key differences from the Supabase schema:
--   * No Row Level Security. Access control moves to the Netlify Functions
--     layer (JWT verification via `jose`), which is the only thing that talks
--     to this database. The browser never connects directly.
--   * `auth.users` is replaced by a local `users` table. All `user_id` FKs
--     point at `users(id)`.
--   * No `supabase_realtime` publication. Realtime fan-out is handled by the
--     Hetzner Socket.io server (see ws-server/).
--   * `gen_random_uuid()` is built into Postgres 13+ (Neon), no pgcrypto needed.
--
-- Apply with:  psql "$DATABASE_URL" -f db/schema.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Shared trigger function: keep updated_at fresh
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- users — replaces Supabase auth.users
-- -----------------------------------------------------------------------------
-- Anonymous sessions: a row with is_anonymous = true, email/password_hash NULL.
-- Registered accounts: email + bcrypt password_hash.
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE,
  password_hash TEXT,
  is_anonymous  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- profiles — display names linked to user accounts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- game_rooms — room metadata, status, settings
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_rooms (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code    VARCHAR(8) NOT NULL UNIQUE,
  status       VARCHAR(20) NOT NULL DEFAULT 'waiting'
               CHECK (status IN ('waiting', 'playing', 'finished')),
  max_players  INTEGER NOT NULL DEFAULT 4,
  custom_rules JSONB DEFAULT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_player_count CHECK (max_players >= 2 AND max_players <= 6)
);

DROP TRIGGER IF EXISTS update_game_rooms_updated_at ON game_rooms;
CREATE TRIGGER update_game_rooms_updated_at
  BEFORE UPDATE ON game_rooms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- game_players — per-player state (cash, stocks, tiles, connection)
-- -----------------------------------------------------------------------------
-- Sensitive columns (tiles, session_id) are never returned to the browser;
-- the Netlify Functions layer serves a player only their own tiles
-- (WHERE user_id = <jwt sub>). The game_players_public view mirrors this.
CREATE TABLE IF NOT EXISTS game_players (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  player_name     VARCHAR(50) NOT NULL,
  player_index    INTEGER NOT NULL,
  session_id      VARCHAR(100) NOT NULL,
  is_connected    BOOLEAN NOT NULL DEFAULT true,
  is_ready        BOOLEAN NOT NULL DEFAULT false,
  is_bot          BOOLEAN NOT NULL DEFAULT false,
  bot_difficulty  VARCHAR(10),
  cash            INTEGER NOT NULL DEFAULT 6000,
  tiles           TEXT[] DEFAULT '{}',
  stocks          JSONB NOT NULL DEFAULT '{"sackson":0,"tower":0,"worldwide":0,"american":0,"festival":0,"continental":0,"imperial":0}',
  last_seen_at    TIMESTAMPTZ DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_player_per_room UNIQUE (room_id, player_index),
  CONSTRAINT player_name_length CHECK (char_length(player_name) BETWEEN 1 AND 30)
);

-- Bot players (added post-launch): is_bot flags AI-controlled seats and
-- bot_difficulty is one of 'easy' | 'medium' | 'hard' (NULL for humans).
-- Idempotent so this file can be re-applied to an already-provisioned DB.
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS bot_difficulty VARCHAR(10);

-- Prevent the same user joining the same room twice (also guards race conditions)
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_per_room
  ON game_players (room_id, user_id);

-- Efficient lookups of a user's active games (reconnection)
CREATE INDEX IF NOT EXISTS idx_game_players_user_active
  ON game_players (user_id, room_id)
  WHERE user_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- game_states — full serialized game state per room
-- -----------------------------------------------------------------------------
-- tile_bag is the only "hidden" column; it must never be sent to the browser.
CREATE TABLE IF NOT EXISTS game_states (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id                   UUID NOT NULL UNIQUE REFERENCES game_rooms(id) ON DELETE CASCADE,
  current_player_index      INTEGER NOT NULL DEFAULT 0,
  phase                     VARCHAR(30) NOT NULL DEFAULT 'place_tile',
  board                     JSONB NOT NULL DEFAULT '{}',
  chains                    JSONB NOT NULL DEFAULT '{}',
  stock_bank                JSONB NOT NULL DEFAULT '{"sackson":25,"tower":25,"worldwide":25,"american":25,"festival":25,"continental":25,"imperial":25}',
  tile_bag                  TEXT[] DEFAULT '{}',
  last_placed_tile          VARCHAR(5),
  pending_chain_foundation  TEXT[],
  merger                    JSONB,
  stocks_purchased_this_turn INTEGER NOT NULL DEFAULT 0,
  game_log                  JSONB NOT NULL DEFAULT '[]',
  winner                    VARCHAR(100),
  end_game_votes            TEXT[] DEFAULT '{}',
  rules_snapshot            JSONB DEFAULT NULL,
  turn_deadline_epoch       BIGINT DEFAULT NULL,
  round_number              INTEGER DEFAULT 0,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_game_states_updated_at ON game_states;
CREATE TRIGGER update_game_states_updated_at
  BEFORE UPDATE ON game_states
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- game_history — completed game records per user
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id           UUID NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  final_cash        INTEGER,
  final_stock_value INTEGER,
  final_total       INTEGER,
  placement         INTEGER,
  played_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, room_id)
);

-- -----------------------------------------------------------------------------
-- Public views — the browser-facing projection that strips sensitive columns.
-- Without RLS these are plain views; the Netlify Functions layer queries them
-- (instead of the base tables) whenever it returns data to the client.
-- -----------------------------------------------------------------------------

-- game_players_public: excludes tiles and session_id
DROP VIEW IF EXISTS game_players_public;
CREATE VIEW game_players_public AS
  SELECT
    id,
    room_id,
    player_name,
    player_index,
    cash,
    stocks,
    is_connected,
    is_ready,
    is_bot,
    bot_difficulty,
    last_seen_at,
    disconnected_at,
    created_at
  FROM game_players;

-- game_states_public: excludes tile_bag
DROP VIEW IF EXISTS game_states_public;
CREATE VIEW game_states_public AS
  SELECT
    id,
    room_id,
    current_player_index,
    phase,
    board,
    chains,
    stock_bank,
    last_placed_tile,
    pending_chain_foundation,
    game_log,
    end_game_votes,
    stocks_purchased_this_turn,
    merger,
    winner,
    updated_at,
    rules_snapshot,
    turn_deadline_epoch,
    round_number
  FROM game_states;

-- =============================================================================
-- Notes on dropped Supabase constructs (now enforced in the app layer):
--   * check_room_creation_limit() trigger relied on auth.uid(); the
--     "max 5 active rooms per user" rule is enforced in the Netlify Function
--     that creates rooms instead.
--   * cleanup_abandoned_rooms() — run as a scheduled Netlify Function or a
--     manual maintenance query rather than a DB-side RPC.
-- =============================================================================
