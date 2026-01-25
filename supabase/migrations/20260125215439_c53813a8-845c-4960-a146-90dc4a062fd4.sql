-- Add unique constraint to prevent same user joining same room twice
-- This also helps with race condition handling
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_per_room ON public.game_players (room_id, user_id);
