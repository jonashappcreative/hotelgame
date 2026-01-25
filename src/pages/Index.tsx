import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameState } from '@/hooks/useGameState';
import { useAuth } from '@/contexts/AuthContext';
import { Lobby } from '@/components/game/Lobby';
import { GameContainer } from '@/components/game/GameContainer';
import { TileId, ChainName } from '@/types/game';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Monitor, Sparkles, Wifi, User, LogOut, History } from 'lucide-react';

type GameMode = 'select' | 'local';

const Index = () => {
  const [mode, setMode] = useState<GameMode>('select');
  const navigate = useNavigate();
  const { user, profile, signOut, loading: authLoading } = useAuth();
  
  const {
    gameState,
    startGame,
    handleTilePlacement,
    handleFoundChain,
    handleChooseMergerSurvivor,
    handlePayMergerBonuses,
    handleMergerStockChoice,
    handleBuyStocks,
    handleSkipBuyStock,
    handleEndGameVote,
    resetGame,
  } = useGameState();

  const handleSignOut = async () => {
    await signOut();
  };

  // Mode selection screen
  if (mode === 'select') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* User Menu - Top Right */}
          <div className="absolute top-4 right-4 flex items-center gap-2">
            {!authLoading && (
              <>
                {user ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate('/history')}
                    >
                      <History className="w-4 h-4 mr-2" />
                      History
                    </Button>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50">
                      <User className="w-4 h-4 text-primary" />
                      <span className="text-sm font-medium">
                        {profile?.display_name || 'Player'}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleSignOut}
                      title="Sign out"
                    >
                      <LogOut className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate('/auth')}
                  >
                    <User className="w-4 h-4 mr-2" />
                    Sign In
                  </Button>
                )}
              </>
            )}
          </div>

          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight mb-2">Acquire</h1>
            <p className="text-muted-foreground">
              The classic hotel empire building game
            </p>
          </div>

          {/* Mode Selection */}
          <Card className="shadow-lg">
            <CardHeader className="text-center pb-4">
              <CardTitle className="text-xl">Choose Game Mode</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                variant="outline"
                className="w-full h-20 flex flex-col items-center justify-center gap-2"
                onClick={() => setMode('local')}
              >
                <div className="flex items-center gap-2">
                  <Monitor className="w-5 h-5" />
                  <span className="text-lg font-semibold">Local Play</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  Play on one device, passing it around
                </span>
              </Button>

              <Button
                className="w-full h-20 flex flex-col items-center justify-center gap-2"
                onClick={() => navigate('/online')}
              >
                <div className="flex items-center gap-2">
                  <Wifi className="w-5 h-5" />
                  <span className="text-lg font-semibold">Online Multiplayer</span>
                </div>
                <span className="text-xs text-primary-foreground/80">
                  Play with friends on separate devices
                </span>
              </Button>
            </CardContent>
          </Card>

          {/* Game Info */}
          <div className="mt-6 p-4 rounded-xl bg-muted/30 border border-border/50">
            <h3 className="font-medium mb-2 text-sm">How to Play</h3>
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Place tiles to form hotel chains</li>
              <li>• Buy stocks in chains you believe will grow</li>
              <li>• Merge chains to earn bonuses</li>
              <li>• End with the most cash to win!</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // Local mode - show lobby if no game
  if (!gameState) {
    return <Lobby onStartGame={startGame} onBack={() => setMode('select')} />;
  }

  return (
    <GameContainer
      gameState={gameState}
      onTilePlacement={(tileId) => handleTilePlacement(tileId as TileId)}
      onFoundChain={(chain) => handleFoundChain(chain as ChainName)}
      onChooseMergerSurvivor={handleChooseMergerSurvivor}
      onPayMergerBonuses={handlePayMergerBonuses}
      onMergerStockChoice={handleMergerStockChoice}
      onBuyStocks={(purchases) => handleBuyStocks(purchases as { chain: ChainName; quantity: number }[])}
      onEndTurn={handleSkipBuyStock}
      onEndGameVote={handleEndGameVote}
      onNewGame={() => {
        resetGame();
        setMode('select');
      }}
    />
  );
};

export default Index;
