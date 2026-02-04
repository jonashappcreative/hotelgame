-- Add is_ready column to game_players for the "Ready to Start" feature
ALTER TABLE public.game_players ADD COLUMN is_ready BOOLEAN NOT NULL DEFAULT false;

-- Drop and recreate the public view to include is_ready
-- (CREATE OR REPLACE cannot change column order/names in an existing view)
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
    created_at
  FROM public.game_players;
-- Note: tiles and session_id intentionally excluded for security
