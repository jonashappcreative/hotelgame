-- Track which round we are in (increments when currentPlayerIndex wraps to 0)
-- Used to enforce grace period for turn timer (disableTimerFirstRounds)
ALTER TABLE public.game_states
  ADD COLUMN IF NOT EXISTS rules_snapshot JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS turn_deadline_epoch BIGINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS round_number INTEGER DEFAULT 0;

-- Recreate game_states_public view to include round_number (tile_bag still excluded)
DROP VIEW IF EXISTS public.game_states_public;
CREATE VIEW public.game_states_public AS
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
