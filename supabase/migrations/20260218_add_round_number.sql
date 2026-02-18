-- Track which round we are in (increments when currentPlayerIndex wraps to 0)
-- Used to enforce grace period for turn timer (disableTimerFirstRounds)
ALTER TABLE public.game_states
  ADD COLUMN round_number INTEGER DEFAULT 0;

-- Recreate game_states_public view to include round_number (tile_bag still excluded)
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
