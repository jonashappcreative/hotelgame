ALTER TABLE public.game_rooms 
ADD COLUMN max_players INTEGER NOT NULL DEFAULT 4;

ALTER TABLE public.game_rooms 
ADD CONSTRAINT valid_player_count CHECK (max_players >= 2 AND max_players <= 6);