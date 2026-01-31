-- Enable realtime for game_states_public view and game_players
-- This allows the frontend to receive updates when game state changes

-- First, we need to enable realtime on the base game_states table
-- The view will inherit the realtime updates
-- Use DO blocks to make this migration idempotent
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.game_states;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.game_players;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rooms;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;