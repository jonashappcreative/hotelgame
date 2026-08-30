-- =============================================================================
-- Epic 16 — durable game results (statistics dashboard)
-- =============================================================================
-- Apply with:  psql "$DATABASE_URL" -f db/migrations/2026-08-31-epic16-game-results.sql
--
-- Why new tables instead of using game_history:
--   game_history has never had a single writer (only db/schema.sql declares it
--   and server/api/account.ts reads it), and its room_id FK is
--   ON DELETE CASCADE against game_rooms — which server/api/cleanup-rooms.ts
--   deletes 10 minutes after a room goes idle. Any row written there would be
--   erased minutes after the game it describes ended.
--
-- A finished game is an immutable historical fact, so these tables hold NO
-- foreign key to game_rooms at all, and reference users only ON DELETE SET NULL.
-- Idempotent, so it can be re-applied and folded into db/schema.sql.
-- =============================================================================

CREATE TABLE IF NOT EXISTS game_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Deliberately NOT a foreign key: the room is deleted minutes after the game
  -- ends. Kept solely to make recording idempotent (ON CONFLICT DO NOTHING),
  -- since a game can reach game_over down several code paths.
  source_room_id    UUID NOT NULL UNIQUE,
  room_code         VARCHAR(8),

  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_seconds  INTEGER,
  rounds            INTEGER,
  end_reason        VARCHAR(16) NOT NULL DEFAULT 'unknown',

  player_count      INTEGER NOT NULL,
  human_count       INTEGER NOT NULL,
  bot_count         INTEGER NOT NULL,

  winner_name       VARCHAR(50),
  winner_is_bot     BOOLEAN,
  winner_difficulty VARCHAR(10),
  winning_total     INTEGER,

  rules             JSONB NOT NULL DEFAULT '{}'::jsonb,
  final_chains      JSONB NOT NULL DEFAULT '{}'::jsonb,
  mergers_count     INTEGER NOT NULL DEFAULT 0,
  largest_chain     VARCHAR(20),
  largest_chain_size INTEGER,
  app_version       VARCHAR(16),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valid_end_reason') THEN
    ALTER TABLE game_results
      ADD CONSTRAINT valid_end_reason
      CHECK (end_reason IN ('threshold', 'vote', 'auto', 'unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_game_results_ended_at ON game_results (ended_at DESC);

CREATE TABLE IF NOT EXISTS game_result_players (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id         UUID NOT NULL REFERENCES game_results(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  display_name      VARCHAR(50) NOT NULL,
  seat_index        INTEGER NOT NULL,
  is_bot            BOOLEAN NOT NULL DEFAULT false,
  bot_difficulty    VARCHAR(10),
  final_cash        INTEGER NOT NULL DEFAULT 0,
  final_stock_value INTEGER NOT NULL DEFAULT 0,
  final_bonus_total INTEGER NOT NULL DEFAULT 0,
  final_total       INTEGER NOT NULL DEFAULT 0,
  placement         INTEGER NOT NULL,
  stocks            JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT unique_seat_per_result UNIQUE (result_id, seat_index)
);

CREATE INDEX IF NOT EXISTS idx_game_result_players_result ON game_result_players (result_id);
CREATE INDEX IF NOT EXISTS idx_game_result_players_user
  ON game_result_players (user_id) WHERE user_id IS NOT NULL;
