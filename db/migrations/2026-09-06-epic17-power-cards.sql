-- =============================================================================
-- Epic 17 — Power Cards
-- =============================================================================
-- Nothing applies db/schema.sql or this directory to production — not a
-- deploy, not a restart — so this must be run by hand against the live
-- database, before the code that needs it reaches main (see
-- docs/infrastructure/DEPLOYMENT.md → "Database changes"):
--
--   ssh hetzner "docker exec -i a8ws9g5d9w9j1rhz2lfx73k2 psql -v ON_ERROR_STOP=1 -U postgres -d postgres" \
--     < db/migrations/2026-09-06-epic17-power-cards.sql
--
-- Run AFTER 2026-09-06-epic18-end-declaration.sql (same date, so date order
-- does not settle it): the game_states_public view below selects Epic 18's
-- end_declared_by / end_condition_round and fails without them.
--
-- Idempotent: safe to re-run. The same statements live in db/schema.sql so a
-- freshly provisioned database gets them without this file.
--
-- Deferrable, unlike the Epic 18 migration. Every statement is additive and its
-- default makes an unmigrated row behave exactly like a game with the rule off,
-- so the deploy is safe in either order — the feature is simply inert until
-- this lands. It joins the Epic 14/15/16 migrations on the v2.0.0 checklist.
-- =============================================================================

BEGIN;

-- The power cards this player still holds. Dealt as the full set of five when
-- the room rule is on, '{}' when it is off; removing an element is how a card
-- is spent.
--
-- PUBLIC on purpose. Every player sees which cards every other player has left:
-- knowing an opponent can still spend Building Spree changes how you leave the
-- board, and hiding it would be a false secret anyway since every play is
-- logged. `tiles` and `session_id` remain the only hidden columns.
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS power_cards TEXT[] NOT NULL DEFAULT '{}';

-- The card in effect for the current turn, or NULL. One JSONB column rather
-- than four booleans because exactly one card can be active and each carries
-- different bookkeeping: {"card": "stock_trade", "tradesUsed": 2}.
-- Cleared at every turn end, alongside the other per-turn counters.
ALTER TABLE game_states  ADD COLUMN IF NOT EXISTS active_power_card JSONB DEFAULT NULL;

-- Tiles placed this turn. Maintained ALWAYS, not just under Building Spree — it
-- is what lets the server say "you may only play Extra Tiles before you have
-- placed" without inspecting last_placed_tile, which the starting tile at game
-- setup also writes.
ALTER TABLE game_states  ADD COLUMN IF NOT EXISTS tiles_placed_this_turn INTEGER NOT NULL DEFAULT 0;

-- The browser reads player and game state through these views, so the new
-- columns must be projected or dbToGameState sees them as undefined.
DROP VIEW IF EXISTS game_players_public;
CREATE VIEW game_players_public AS
  SELECT
    id,
    room_id,
    player_name,
    player_index,
    cash,
    stocks,
    power_cards,
    is_connected,
    is_ready,
    is_bot,
    bot_difficulty,
    last_seen_at,
    disconnected_at,
    created_at
  FROM game_players;

-- The count, not the contents: extra_tiles is refused on an empty bag (see
-- canPlayPowerCard in src/types/power-cards.ts), and the client needs that
-- number without seeing which tiles are left to draw.
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
    end_declared_by,
    end_condition_round,
    stocks_purchased_this_turn,
    stocks_sold_this_turn,
    chains_bought_this_turn,
    active_power_card,
    tiles_placed_this_turn,
    merger,
    winner,
    updated_at,
    rules_snapshot,
    turn_deadline_epoch,
    round_number,
    COALESCE(array_length(tile_bag, 1), 0) AS tile_bag_count
  FROM game_states;

COMMIT;
