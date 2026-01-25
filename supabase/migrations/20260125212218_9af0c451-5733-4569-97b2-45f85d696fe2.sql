-- Fix game_states SELECT policy to allow authenticated users to view public data
-- This is needed for realtime subscriptions to work
-- The frontend should use the game_states_public view which excludes tile_bag

DROP POLICY IF EXISTS "Deny direct game_states access" ON public.game_states;

-- Allow authenticated users to view game states (realtime needs this)
-- The frontend uses game_states_public view which hides tile_bag
CREATE POLICY "Authenticated can view game states"
ON public.game_states FOR SELECT
TO authenticated
USING (true);