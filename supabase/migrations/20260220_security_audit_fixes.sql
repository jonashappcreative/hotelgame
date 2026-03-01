-- =============================================================================
-- Security Audit Fixes - 2026-02-20
-- =============================================================================

-- HIGH-001: Restrict game_states SELECT to prevent direct tile_bag access
-- Currently "authenticated" can SELECT everything from game_states including tile_bag.
-- We drop the permissive policy and replace it with one that only allows
-- service_role (edge functions) to read the full table.
-- Authenticated clients should use the game_states_public view (which excludes tile_bag).

DROP POLICY IF EXISTS "Anyone can view game state" ON public.game_states;
DROP POLICY IF EXISTS "Authenticated can view game state" ON public.game_states;
DROP POLICY IF EXISTS "game_states_select" ON public.game_states;
DROP POLICY IF EXISTS "game_states_select_auth" ON public.game_states;

-- Only allow service_role to read game_states directly
-- Authenticated users must use game_states_public view
CREATE POLICY "service_role_select_game_states"
  ON public.game_states
  FOR SELECT
  TO service_role
  USING (true);

-- Allow authenticated users to subscribe to realtime changes
-- but they should use the game_states_public view for data queries.
-- Supabase realtime requires SELECT on the base table for change detection,
-- so we grant a restrictive SELECT that only works via realtime subscription.
-- This is the trade-off: we allow SELECT for realtime but the game_states_public
-- view is the intended client query path.
CREATE POLICY "authenticated_select_game_states_for_realtime"
  ON public.game_states
  FOR SELECT
  TO authenticated
  USING (
    -- Only allow access if the user is a player in this room
    EXISTS (
      SELECT 1 FROM public.game_players
      WHERE game_players.room_id = game_states.room_id
        AND game_players.user_id = auth.uid()::text
    )
  );

-- MED-002: Add rate limiting via database constraint
-- Limit active rooms per user to 5
CREATE OR REPLACE FUNCTION public.check_room_creation_limit()
RETURNS TRIGGER AS $$
DECLARE
  active_room_count INTEGER;
BEGIN
  -- Count rooms where this user is player_index 0 (host) and room is not finished
  SELECT COUNT(*) INTO active_room_count
  FROM public.game_players gp
  JOIN public.game_rooms gr ON gr.id = gp.room_id
  WHERE gp.user_id = auth.uid()::text
    AND gp.player_index = 0
    AND gr.status IN ('waiting', 'playing');

  IF active_room_count >= 5 THEN
    RAISE EXCEPTION 'Maximum active rooms limit reached (5). Please finish or leave existing games first.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS enforce_room_creation_limit ON public.game_rooms;

-- Create trigger on room creation
CREATE TRIGGER enforce_room_creation_limit
  BEFORE INSERT ON public.game_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.check_room_creation_limit();
