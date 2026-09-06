-- =============================================================================
-- Epic 18 — End-Game Declaration
-- =============================================================================
-- db/schema.sql only runs when the Postgres volume is first created, and
-- deploy.sh never applies either file, so this must be run by hand against the
-- live database (see docs/infrastructure/DEPLOYMENT.md → "Database changes"):
--
--   ssh hetzner "docker exec -i acquire-db psql -U acquire -d acquire" \
--     < db/migrations/2026-09-06-epic18-end-declaration.sql
--
-- Idempotent: safe to re-run. The same statements live in db/schema.sql so a
-- freshly provisioned database gets them without this file.
--
-- !! BLOCKING, AND IT MUST RUN BEFORE THE DEPLOY. !!
-- Unlike the Epic 14/15/16 migrations this one is not deferrable. Epic 18
-- removes automatic end-game detection from the engine, so an unmigrated
-- database has no way to end a game at all: declare_game_end writes
-- end_declared_by, and the turn-end branch reads it.
-- =============================================================================

BEGIN;

-- The seat (game_players.player_index) that announced the game will end.
-- NULL means nobody has declared. Never reset during a game — a declaration is
-- final and the game ends at the end of that same turn. `new_game` deletes the
-- whole game_states row, so a rematch starts clean.
--
-- The seat rather than a boolean, so the turn-end branch can assert that the
-- player whose turn is ending is the one who declared.
ALTER TABLE game_states ADD COLUMN IF NOT EXISTS end_declared_by INTEGER DEFAULT NULL;

-- The round in which an end condition was first observed at a turn boundary.
-- Only the bots read it: it anchors their "declare unconditionally once the
-- condition has held for a full round" backstop, without which a table of hard
-- bots that all want to keep playing would never finish. NULL until a condition
-- is met, and never cleared afterwards.
ALTER TABLE game_states ADD COLUMN IF NOT EXISTS end_condition_round INTEGER DEFAULT NULL;

-- The statistics record gains two reasons (Epic 18.8). The Epic 16 constraint
-- would reject every row a declared or stalemated game writes, and
-- recordGameResult swallows its own errors — so an un-widened constraint would
-- lose the statistics record silently. Dropped and recreated rather than
-- guarded on existence, because the guard is what would skip the widening.
ALTER TABLE game_results DROP CONSTRAINT IF EXISTS valid_end_reason;
ALTER TABLE game_results
  ADD CONSTRAINT valid_end_reason
  CHECK (end_reason IN ('declared', 'stalemate', 'threshold', 'vote', 'auto', 'unknown'));

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
    end_declared_by,
    end_condition_round,
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
