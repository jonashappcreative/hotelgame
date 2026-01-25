-- Fix security issue: Restrict SELECT access on game_players base table
-- Session IDs are sensitive and should never be exposed publicly
-- All public queries should use the game_players_public view instead

-- Drop the permissive SELECT policy
DROP POLICY IF EXISTS "Anyone can view players" ON public.game_players;

-- Create a restrictive SELECT policy - players can only see their own record with session_id
-- All other queries should use game_players_public view which excludes session_id
CREATE POLICY "Players can only view own record"
ON public.game_players FOR SELECT
USING (session_id = COALESCE(
  nullif(current_setting('app.current_session_id', true), ''),
  'no-session'
));

-- Note: Since Supabase JS client can't set custom settings, this effectively blocks
-- direct SELECT on game_players table. All reads must go through game_players_public view.
-- This is the desired behavior - session_id should never be readable.