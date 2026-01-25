-- Enable realtime for game_states_public view and game_players
-- This allows the frontend to receive updates when game state changes

-- First, we need to enable realtime on the base game_states table
-- The view will inherit the realtime updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_states;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rooms;