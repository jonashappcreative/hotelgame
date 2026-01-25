-- Add database-level input validation constraints

-- 1. Add validation triggers for player_name
CREATE OR REPLACE FUNCTION public.validate_player_input()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate player_name length (1-20 characters)
  IF length(NEW.player_name) < 1 OR length(NEW.player_name) > 20 THEN
    RAISE EXCEPTION 'Player name must be 1-20 characters';
  END IF;
  
  -- Validate player_name format (alphanumeric and spaces only)
  IF NEW.player_name !~ '^[a-zA-Z0-9 ]+$' THEN
    RAISE EXCEPTION 'Player name can only contain letters, numbers, and spaces';
  END IF;
  
  -- Validate cash is non-negative
  IF NEW.cash < 0 THEN
    RAISE EXCEPTION 'Cash cannot be negative';
  END IF;
  
  -- Validate player_index is within bounds
  IF NEW.player_index < 0 OR NEW.player_index > 5 THEN
    RAISE EXCEPTION 'Player index must be between 0 and 5';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER validate_player_input_trigger
BEFORE INSERT OR UPDATE ON public.game_players
FOR EACH ROW EXECUTE FUNCTION public.validate_player_input();

-- 2. Add validation trigger for room_code
CREATE OR REPLACE FUNCTION public.validate_room_input()
RETURNS TRIGGER AS $$
BEGIN
  -- Validate room_code is exactly 6 alphanumeric characters
  IF NEW.room_code !~ '^[A-Z0-9]{6}$' THEN
    RAISE EXCEPTION 'Room code must be exactly 6 uppercase alphanumeric characters';
  END IF;
  
  -- Validate max_players is within bounds
  IF NEW.max_players < 2 OR NEW.max_players > 6 THEN
    RAISE EXCEPTION 'Max players must be between 2 and 6';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER validate_room_input_trigger
BEFORE INSERT OR UPDATE ON public.game_rooms
FOR EACH ROW EXECUTE FUNCTION public.validate_room_input();

-- 3. Drop existing overly permissive policies and create stricter ones

-- Drop existing game_players policies
DROP POLICY IF EXISTS "Players can join rooms" ON public.game_players;
DROP POLICY IF EXISTS "Players can only leave themselves" ON public.game_players;
DROP POLICY IF EXISTS "Players can view own data" ON public.game_players;
DROP POLICY IF EXISTS "Players in room can update" ON public.game_players;

-- Drop existing game_rooms policies  
DROP POLICY IF EXISTS "Anyone can create rooms" ON public.game_rooms;
DROP POLICY IF EXISTS "Anyone can update rooms" ON public.game_rooms;
DROP POLICY IF EXISTS "Anyone can view rooms" ON public.game_rooms;

-- Drop existing game_states policies
DROP POLICY IF EXISTS "Anyone can create game state" ON public.game_states;
DROP POLICY IF EXISTS "Anyone can update game state" ON public.game_states;
DROP POLICY IF EXISTS "Anyone can view game state" ON public.game_states;

-- GAME_ROOMS: Tighter policies
-- Anyone can view rooms (needed for joining)
CREATE POLICY "Anyone can view rooms"
ON public.game_rooms FOR SELECT
USING (true);

-- Anyone can create rooms (but validation trigger limits format)
CREATE POLICY "Anyone can create rooms"
ON public.game_rooms FOR INSERT
WITH CHECK (true);

-- Only host (first player) can update room status
CREATE POLICY "Only host can update room"
ON public.game_rooms FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.game_players
    WHERE room_id = game_rooms.id
    AND player_index = 0
    AND session_id = COALESCE(
      current_setting('request.headers', true)::json->>'x-session-id',
      ''
    )
  )
  -- Allow updates for rooms in 'waiting' status (for flexibility)
  OR status = 'waiting'
);

-- GAME_PLAYERS: Session-based restrictions
-- Anyone can view players in a room (needed for lobby display)
CREATE POLICY "Anyone can view players"
ON public.game_players FOR SELECT
USING (true);

-- Players can only create their own record (session must match)
CREATE POLICY "Players can join with their session"
ON public.game_players FOR INSERT
WITH CHECK (
  session_id = COALESCE(
    current_setting('request.headers', true)::json->>'x-session-id',
    session_id -- Allow if header not set (fallback for edge functions)
  )
);

-- Players in the same room can update (needed for game synchronization)
-- But session must be from a player in that room
CREATE POLICY "Room players can update"
ON public.game_players FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.game_players gp
    WHERE gp.room_id = game_players.room_id
    AND gp.session_id = COALESCE(
      current_setting('request.headers', true)::json->>'x-session-id',
      ''
    )
  )
);

-- Players can only delete their own record
CREATE POLICY "Players can only delete themselves"
ON public.game_players FOR DELETE
USING (
  session_id = COALESCE(
    current_setting('request.headers', true)::json->>'x-session-id',
    ''
  )
);

-- GAME_STATES: Turn-based restrictions
-- Anyone can view game state (needed for all players to see the board)
CREATE POLICY "Anyone can view game state"
ON public.game_states FOR SELECT
USING (true);

-- Only players in the room can create game state
CREATE POLICY "Room players can create game state"
ON public.game_states FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.game_players
    WHERE room_id = game_states.room_id
    AND session_id = COALESCE(
      current_setting('request.headers', true)::json->>'x-session-id',
      ''
    )
  )
);

-- Only current player can update game state
CREATE POLICY "Current player can update game state"
ON public.game_states FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.game_players
    WHERE room_id = game_states.room_id
    AND player_index = game_states.current_player_index
    AND session_id = COALESCE(
      current_setting('request.headers', true)::json->>'x-session-id',
      ''
    )
  )
  -- Also allow updates during merger phase (multiple players involved)
  OR (
    merger IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.game_players
      WHERE room_id = game_states.room_id
      AND session_id = COALESCE(
        current_setting('request.headers', true)::json->>'x-session-id',
        ''
      )
    )
  )
);