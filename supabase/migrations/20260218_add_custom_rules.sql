-- Persist rules chosen at room creation
ALTER TABLE public.game_rooms
  ADD COLUMN custom_rules JSONB DEFAULT NULL;

-- Snapshot of resolved rules for fast access during gameplay
ALTER TABLE public.game_states
  ADD COLUMN rules_snapshot JSONB DEFAULT NULL;

-- Unix epoch timestamp (seconds) for the current player's turn deadline
ALTER TABLE public.game_states
  ADD COLUMN turn_deadline_epoch BIGINT DEFAULT NULL;

-- Recreate game_states_public view to include new columns (tile_bag remains excluded)
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
    turn_deadline_epoch
  FROM public.game_states;
