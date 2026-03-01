-- =============================================================================
-- Security Audit Fix: LOW-009
-- Add server-side CHECK constraint on player_name length
-- =============================================================================
-- Without this constraint, a crafted API call bypassing the frontend could
-- insert a player_name of arbitrary length, bloating game_log JSONB entries.

ALTER TABLE public.game_players
  ADD CONSTRAINT player_name_length CHECK (char_length(player_name) BETWEEN 1 AND 30);
