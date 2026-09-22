-- =============================================================================
-- Epic 14 — Stock Selling ("Broker's Cut")
-- =============================================================================
-- Nothing applies db/schema.sql or this directory to production — not a
-- deploy, not a restart — so this must be run by hand against the live
-- database, before the code that needs it reaches main (see
-- docs/infrastructure/DEPLOYMENT.md → "Database changes"):
--
--   ssh hetzner "docker exec -i a8ws9g5d9w9j1rhz2lfx73k2 psql -v ON_ERROR_STOP=1 -U postgres -d postgres" \
--     < db/migrations/2026-08-30-epic14-stock-selling.sql
--
-- Idempotent: safe to re-run. The same statements live in db/schema.sql so a
-- freshly provisioned database gets them without this file.
--
-- The rule itself needs no migration — game_rooms.custom_rules and
-- game_states.rules_snapshot are schemaless JSONB, and existing rooms fall back
-- to stockSellingEnabled: false.
-- =============================================================================

BEGIN;

-- Selling has its own per-turn budget, independent of stocks_purchased_this_turn.
ALTER TABLE game_states ADD COLUMN IF NOT EXISTS stocks_sold_this_turn INTEGER NOT NULL DEFAULT 0;

-- Chains bought this turn cannot be sold back in the same turn.
ALTER TABLE game_states ADD COLUMN IF NOT EXISTS chains_bought_this_turn TEXT[] NOT NULL DEFAULT '{}';

-- The browser reads game state through this view, so both columns must be
-- projected or dbToGameState sees them as undefined.
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
    stocks_sold_this_turn,
    chains_bought_this_turn,
    merger,
    winner,
    updated_at,
    rules_snapshot,
    turn_deadline_epoch,
    round_number
  FROM game_states;

COMMIT;
