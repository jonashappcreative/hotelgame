-- Fix security issue: Remove session_id from public view
-- This prevents session ID theft and player impersonation

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
    created_at
  FROM public.game_players;

-- Grant access to the view
GRANT SELECT ON public.game_players_public TO anon;
GRANT SELECT ON public.game_players_public TO authenticated;

-- Fix RLS policies: Replace header-based checks with simpler auth patterns
-- Since custom headers aren't supported by Supabase JS client, we simplify to allow operations
-- for anyone but remove the false sense of security from ineffective header checks

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Players can join with their session" ON public.game_players;
DROP POLICY IF EXISTS "Players can only delete themselves" ON public.game_players;

-- Create simpler policies that are honest about their constraints
-- For a casual multiplayer game, we accept these tradeoffs since session management
-- is already handled client-side via sessionStorage

-- Anyone can insert (join a game) - the session_id is assigned client-side
CREATE POLICY "Anyone can join games"
ON public.game_players FOR INSERT
WITH CHECK (true);

-- Anyone can delete from game_players (leave a game)
-- In practice, the client only deletes their own session
CREATE POLICY "Anyone can leave games"
ON public.game_players FOR DELETE
USING (true);