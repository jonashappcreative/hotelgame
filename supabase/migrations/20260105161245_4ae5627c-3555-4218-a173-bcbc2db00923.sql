-- Create table for game rooms
CREATE TABLE public.game_rooms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_code VARCHAR(8) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create table for players in rooms
CREATE TABLE public.game_players (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  player_name VARCHAR(50) NOT NULL,
  player_index INTEGER NOT NULL,
  session_id VARCHAR(100) NOT NULL,
  is_connected BOOLEAN NOT NULL DEFAULT true,
  cash INTEGER NOT NULL DEFAULT 6000,
  tiles TEXT[] DEFAULT '{}',
  stocks JSONB NOT NULL DEFAULT '{"sackson":0,"tower":0,"worldwide":0,"american":0,"festival":0,"continental":0,"imperial":0}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT unique_player_per_room UNIQUE (room_id, player_index)
);

-- Create table for game state
CREATE TABLE public.game_states (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  room_id UUID NOT NULL UNIQUE REFERENCES public.game_rooms(id) ON DELETE CASCADE,
  current_player_index INTEGER NOT NULL DEFAULT 0,
  phase VARCHAR(30) NOT NULL DEFAULT 'place_tile',
  board JSONB NOT NULL DEFAULT '{}',
  chains JSONB NOT NULL DEFAULT '{}',
  stock_bank JSONB NOT NULL DEFAULT '{"sackson":25,"tower":25,"worldwide":25,"american":25,"festival":25,"continental":25,"imperial":25}',
  tile_bag TEXT[] DEFAULT '{}',
  last_placed_tile VARCHAR(5),
  pending_chain_foundation TEXT[],
  merger JSONB,
  stocks_purchased_this_turn INTEGER NOT NULL DEFAULT 0,
  game_log JSONB NOT NULL DEFAULT '[]',
  winner VARCHAR(100),
  end_game_votes TEXT[] DEFAULT '{}',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.game_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_states ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (no auth required for this game)
CREATE POLICY "Anyone can view rooms" ON public.game_rooms FOR SELECT USING (true);
CREATE POLICY "Anyone can create rooms" ON public.game_rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update rooms" ON public.game_rooms FOR UPDATE USING (true);

CREATE POLICY "Anyone can view players" ON public.game_players FOR SELECT USING (true);
CREATE POLICY "Anyone can join rooms" ON public.game_players FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update players" ON public.game_players FOR UPDATE USING (true);
CREATE POLICY "Anyone can leave rooms" ON public.game_players FOR DELETE USING (true);

CREATE POLICY "Anyone can view game state" ON public.game_states FOR SELECT USING (true);
CREATE POLICY "Anyone can create game state" ON public.game_states FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update game state" ON public.game_states FOR UPDATE USING (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_game_rooms_updated_at
  BEFORE UPDATE ON public.game_rooms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_game_states_updated_at
  BEFORE UPDATE ON public.game_states
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for all game tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_players;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_states;