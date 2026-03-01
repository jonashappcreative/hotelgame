-- =============================================================================
-- Catch-up migration: safely adds columns/views that may be missing from the
-- remote DB because earlier migrations were run outside the CLI.
-- All statements use IF NOT EXISTS so this is safe to run on any state.
-- =============================================================================

-- game_rooms: max_players (20260125155607)
ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS max_players INTEGER NOT NULL DEFAULT 4;

ALTER TABLE public.game_rooms
  DROP CONSTRAINT IF EXISTS valid_player_count;
ALTER TABLE public.game_rooms
  ADD CONSTRAINT valid_player_count CHECK (max_players >= 2 AND max_players <= 6);

-- game_rooms: custom_rules (20260218_add_custom_rules)
ALTER TABLE public.game_rooms
  ADD COLUMN IF NOT EXISTS custom_rules JSONB DEFAULT NULL;

-- game_players: is_ready (20260202_add_is_ready)
ALTER TABLE public.game_players
  ADD COLUMN IF NOT EXISTS is_ready BOOLEAN NOT NULL DEFAULT false;

-- game_players: reconnection fields (20260209_add_reconnection_fields)
ALTER TABLE public.game_players
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_game_players_user_active
  ON public.game_players (user_id, room_id)
  WHERE user_id IS NOT NULL;

-- game_states: rules_snapshot + turn_deadline_epoch (20260218_add_custom_rules)
ALTER TABLE public.game_states
  ADD COLUMN IF NOT EXISTS rules_snapshot JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS turn_deadline_epoch BIGINT DEFAULT NULL;

-- game_states: round_number (20260218_add_round_number)
ALTER TABLE public.game_states
  ADD COLUMN IF NOT EXISTS round_number INTEGER DEFAULT 0;

-- Recreate game_players_public view with all current columns
DROP VIEW IF EXISTS public.game_players_public;
CREATE VIEW public.game_players_public
WITH (security_invoker=on) AS
  SELECT
    id,
    room_id,
    player_name,
    player_index,
    cash,
    stocks,
    is_connected,
    is_ready,
    last_seen_at,
    disconnected_at,
    created_at
  FROM public.game_players;
-- Note: tiles and session_id intentionally excluded for security

-- Recreate game_states_public view with all current columns
CREATE OR REPLACE VIEW public.game_states_public AS
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
  FROM public.game_states;
-- Note: tile_bag intentionally excluded for security

-- player_name NOT NULL constraint (20260221_player_name_constraint)
ALTER TABLE public.game_players
  ALTER COLUMN player_name SET NOT NULL;
