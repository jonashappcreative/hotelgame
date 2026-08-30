-- =============================================================================
-- Epic 15 — host identity and turn order
-- =============================================================================
-- Apply by hand, once, per environment:
--
--   psql "$DATABASE_URL" -f db/migrations/2026-08-30-epic15-host-and-turn-order.sql
--
-- deploy.sh never runs schema.sql or this directory, so nothing applies this
-- for you. Every statement is idempotent and additive, so it is safe to run
-- against a live database and safe to run twice.
--
-- Why:
--   * host_user_id — host privilege used to *be* seat 0 (game_players.
--     player_index = 0), which is exactly what stopped the host from moving in
--     the turn order. Ownership becomes an explicit column so the host can sit
--     anywhere, including last.
--   * turn_order_mode — 'random' shuffles every seat when the game starts;
--     'manual' means the host arranged the seats by hand and they are final.
--
-- The rules model needs no migration: game_rooms.custom_rules and
-- game_states.rules_snapshot are schemaless JSONB, and v1 blobs are translated
-- on read by normalizeRules() (src/types/rules-normalize.ts).
-- =============================================================================

ALTER TABLE game_rooms
  ADD COLUMN IF NOT EXISTS host_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE game_rooms
  ADD COLUMN IF NOT EXISTS turn_order_mode VARCHAR(10) NOT NULL DEFAULT 'random';

-- Named separately so the ADD COLUMN above stays re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_turn_order_mode'
  ) THEN
    ALTER TABLE game_rooms
      ADD CONSTRAINT valid_turn_order_mode CHECK (turn_order_mode IN ('random', 'manual'));
  END IF;
END $$;

-- Backfill: today's host is whoever sits at seat 0.
UPDATE game_rooms gr
   SET host_user_id = gp.user_id
  FROM game_players gp
 WHERE gp.room_id = gr.id
   AND gp.player_index = 0
   AND gr.host_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_game_rooms_host_user_id ON game_rooms (host_user_id);
