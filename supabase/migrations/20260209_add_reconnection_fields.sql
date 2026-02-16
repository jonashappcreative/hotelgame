-- Add columns for tracking player connection status and reconnection
-- last_seen_at: Updated by heartbeat to track active connections
-- disconnected_at: Set when player is detected as disconnected

ALTER TABLE public.game_players
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMP WITH TIME ZONE;

-- Create index for efficient queries on active games
CREATE INDEX IF NOT EXISTS idx_game_players_user_active
ON public.game_players (user_id, room_id)
WHERE user_id IS NOT NULL;

-- Drop and recreate the public view to include new columns
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
    last_seen_at,
    disconnected_at,
    created_at
  FROM public.game_players;
-- Note: tiles and session_id intentionally excluded for security
