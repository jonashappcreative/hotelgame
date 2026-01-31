-- Fix RLS policy to allow players to see all players in any room
-- This is necessary for the multiplayer join logic to work correctly
-- Players need to see which player_index slots are taken

-- Drop the restrictive policy that only allows viewing own record
DROP POLICY IF EXISTS "Players can view own record" ON public.game_players;

-- Add new policy: Players can view all players (for public multiplayer)
CREATE POLICY "Players can view all players"
ON public.game_players FOR SELECT
TO authenticated
USING (true);

-- Keep the restrictive INSERT policy (can only insert with your own user_id)
-- This is already in place from the previous migration

-- Note: Players still can't see other players' tiles through the view
-- because game_players_public excludes the tiles column
