import { GameState, ChainName, CHAINS } from '@/types/game';
import { calculateFinalScores, getStockPrice, getBonuses, getStockholderRankings } from '@/utils/gameLogic';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Trophy, Medal, RefreshCw, Crown, X, Home } from 'lucide-react';

interface GameOverProps {
  gameState: GameState;
  onNewGame: () => void;
  onReturnToLobby?: () => void;
  onClose?: () => void;
}

// Calculate detailed score breakdown
const calculateDetailedScores = (gameState: GameState) => {
  const players = gameState.players.map(p => {
    const stockDetails: {
      chain: ChainName;
      quantity: number;
      price: number;
      value: number;
      majorityBonus: number;
      minorityBonus: number;
    }[] = [];

    let totalBonuses = 0;
    let totalStockValue = 0;

    for (const [chainName, quantity] of Object.entries(p.stocks) as [ChainName, number][]) {
      if (quantity === 0) continue;
      
      const chain = gameState.chains[chainName];
      if (!chain.isActive) continue;
      
      const price = getStockPrice(chainName, chain.tiles.length);
      const value = price * quantity;
      totalStockValue += value;
      
      const bonuses = getBonuses(chainName, chain.tiles.length);
      const rankings = getStockholderRankings(gameState.players, chainName);
      
      let majorityBonus = 0;
      let minorityBonus = 0;
      
      if (rankings.majority.some(mp => mp.id === p.id)) {
        if (rankings.minority.length === 0) {
          // Split both bonuses among majority holders
          majorityBonus = Math.floor((bonuses.majority + bonuses.minority) / rankings.majority.length);
        } else {
          majorityBonus = Math.floor(bonuses.majority / rankings.majority.length);
        }
      } else if (rankings.minority.some(mp => mp.id === p.id)) {
        minorityBonus = Math.floor(bonuses.minority / rankings.minority.length);
      }
      
      totalBonuses += majorityBonus + minorityBonus;
      
      stockDetails.push({
        chain: chainName,
        quantity,
        price,
        value,
        majorityBonus,
        minorityBonus,
      });
    }

    const finalCash = p.cash + totalStockValue + totalBonuses;

    return {
      ...p,
      stockDetails,
      totalBonuses,
      totalStockValue,
      finalCash,
    };
  });

  return players.sort((a, b) => b.finalCash - a.finalCash);
};

export const GameOver = ({ gameState, onNewGame, onReturnToLobby, onClose }: GameOverProps) => {
  const detailedScores = calculateDetailedScores(gameState);

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-slide-up shadow-2xl border border-border relative">
        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        )}

        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-cash-neutral/20 flex items-center justify-center">
            <Trophy className="w-8 h-8 text-cash-neutral" />
          </div>
          <h2 className="text-2xl font-bold">Game Over!</h2>
          <p className="text-muted-foreground">Final standings and score breakdown</p>
        </div>

        <div className="space-y-4 mb-6">
          {detailedScores.map((player, index) => {
            const isWinner = index === 0;
            const icons = [Crown, Medal, Medal, Medal];
            const Icon = icons[index];

            return (
              <div
                key={player.id}
                className={cn(
                  "p-4 rounded-xl transition-all",
                  isWinner 
                    ? "bg-cash-neutral/10 ring-2 ring-cash-neutral" 
                    : "bg-muted/30"
                )}
              >
                {/* Player header */}
                <div className="flex items-center gap-4 mb-3">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                    isWinner ? "bg-cash-neutral text-background" : "bg-muted text-muted-foreground"
                  )}>
                    <Icon className="w-5 h-5" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "font-semibold truncate",
                      isWinner && "text-cash-neutral"
                    )}>
                      {player.name}
                      {isWinner && <span className="ml-2">🏆</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      #{index + 1} Place
                    </p>
                  </div>

                  <div className="text-right">
                    <p className={cn(
                      "font-mono text-xl font-bold",
                      isWinner ? "cash-display" : "text-foreground"
                    )}>
                      ${player.finalCash.toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Stock breakdown */}
                {player.stockDetails.length > 0 && (
                  <div className="ml-14 space-y-1 text-sm">
                    {player.stockDetails.map(detail => (
                      <div key={detail.chain} className="flex items-center justify-between text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <div className={cn("w-3 h-3 rounded-full", `chain-${detail.chain}`)} />
                          <span>{CHAINS[detail.chain].displayName}</span>
                          <span className="text-xs">
                            {detail.quantity} × ${detail.price.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span>${detail.value.toLocaleString()}</span>
                          {detail.majorityBonus > 0 && (
                            <span className="text-xs text-cash-neutral">+${detail.majorityBonus.toLocaleString()} maj</span>
                          )}
                          {detail.minorityBonus > 0 && (
                            <span className="text-xs text-chain-minority">+${detail.minorityBonus.toLocaleString()} min</span>
                          )}
                        </div>
                      </div>
                    ))}
                    
                    {/* Summary line */}
                    <div className="flex items-center justify-between pt-2 border-t border-border/50 text-muted-foreground">
                      <span>Cash on hand</span>
                      <span>${player.cash.toLocaleString()}</span>
                    </div>
                    {player.totalBonuses > 0 && (
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Total bonuses</span>
                        <span className="text-cash-neutral">+${player.totalBonuses.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          {onReturnToLobby && (
            <Button
              variant="outline"
              className="flex-1"
              size="lg"
              onClick={onReturnToLobby}
            >
              <Home className="w-4 h-4 mr-2" />
              Return to Lobby
            </Button>
          )}
          <Button
            className="flex-1"
            size="lg"
            onClick={onNewGame}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            New Game
          </Button>
        </div>
      </div>
    </div>
  );
};
