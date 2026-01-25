import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Trophy, Loader2, Calendar, DollarSign } from 'lucide-react';
import { format } from 'date-fns';

interface GameHistoryEntry {
  id: string;
  room_id: string;
  final_cash: number | null;
  final_stock_value: number | null;
  final_total: number | null;
  placement: number | null;
  played_at: string;
}

const GameHistory = () => {
  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchHistory();
    }
  }, [user]);

  const fetchHistory = async () => {
    const { data, error } = await supabase
      .from('game_history')
      .select('*')
      .order('played_at', { ascending: false })
      .limit(50);

    if (!error && data) {
      setHistory(data);
    }
    setLoading(false);
  };

  const getPlacementColor = (placement: number | null) => {
    switch (placement) {
      case 1: return 'text-[hsl(var(--chain-tower))]'; // Gold
      case 2: return 'text-muted-foreground'; 
      case 3: return 'text-[hsl(var(--chain-sackson))]'; // Bronze-ish
      default: return 'text-muted-foreground';
    }
  };

  const getPlacementLabel = (placement: number | null) => {
    if (!placement) return 'N/A';
    switch (placement) {
      case 1: return '1st';
      case 2: return '2nd';
      case 3: return '3rd';
      default: return `${placement}th`;
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Game History</h1>
            <p className="text-sm text-muted-foreground">
              Your past games and results
            </p>
          </div>
        </div>

        {/* Stats Summary */}
        {history.length > 0 && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{history.length}</p>
                  <p className="text-xs text-muted-foreground">Games Played</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-[hsl(var(--chain-tower))]">
                    {history.filter(g => g.placement === 1).length}
                  </p>
                  <p className="text-xs text-muted-foreground">Wins</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {history.length > 0 
                      ? (history.filter(g => g.placement === 1).length / history.length * 100).toFixed(0)
                      : 0}%
                  </p>
                  <p className="text-xs text-muted-foreground">Win Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Game List */}
        {history.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Trophy className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No games played yet</p>
              <Button className="mt-4" onClick={() => navigate('/')}>
                Start Playing
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {history.map((game) => (
              <Card key={game.id} className="hover:bg-muted/30 transition-colors">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`text-2xl font-bold ${getPlacementColor(game.placement)}`}>
                        {game.placement === 1 && <Trophy className="w-6 h-6 inline mr-1 text-[hsl(var(--chain-tower))]" />}
                        {getPlacementLabel(game.placement)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(game.played_at), 'MMM d, yyyy')}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-1 text-lg font-mono font-semibold">
                        <DollarSign className="w-4 h-4 text-cash" />
                        <span className="cash-display">
                          {game.final_total?.toLocaleString() ?? 'N/A'}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Final Value
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GameHistory;
