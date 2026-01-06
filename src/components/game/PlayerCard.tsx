import { useState } from 'react';
import { PlayerState, ChainName, GameState, CHAINS } from '@/types/game';
import { getPlayerNetWorth, getStockPrice, getStockholderRankings } from '@/utils/gameLogic';
import { cn } from '@/lib/utils';
import { User, Crown, Wifi, WifiOff, ChevronDown, ChevronUp } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface PlayerCardProps {
  player: PlayerState;
  gameState: GameState;
  isCurrentTurn: boolean;
  isYou?: boolean;
  rank?: number;
}

export const PlayerCard = ({ player, gameState, isCurrentTurn, isYou, rank }: PlayerCardProps) => {
  const [isExpanded, setIsExpanded] = useState(isCurrentTurn);
  const netWorth = getPlayerNetWorth(player, gameState.chains);
  
  const activeStocks = (Object.entries(player.stocks) as [ChainName, number][])
    .filter(([_, qty]) => qty > 0)
    .map(([chain, qty]) => {
      const rankings = getStockholderRankings(gameState.players, chain);
      const isMajority = rankings.majority.some(p => p.id === player.id);
      const isMinority = rankings.minority.some(p => p.id === player.id);
      
      return {
        chain,
        quantity: qty,
        value: gameState.chains[chain].isActive 
          ? getStockPrice(chain, gameState.chains[chain].tiles.length) * qty 
          : 0,
        isMajority,
        isMinority,
      };
    });

  // Keep active player expanded
  const effectiveExpanded = isCurrentTurn || isExpanded;

  return (
    <Collapsible open={effectiveExpanded} onOpenChange={setIsExpanded}>
      <div className={cn(
        "player-card",
        isCurrentTurn && "player-card-active",
        isYou && "ring-1 ring-primary/30"
      )}>
        {/* Header - Always visible */}
        <CollapsibleTrigger className="w-full" disabled={isCurrentTurn}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn(
                "w-7 h-7 rounded-full flex items-center justify-center",
                isCurrentTurn ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                {rank === 1 ? <Crown className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
              </div>
              <div className="text-left">
                <p className={cn(
                  "font-semibold text-sm",
                  isCurrentTurn && "text-primary"
                )}>
                  {player.name}
                  {isYou && <span className="text-muted-foreground ml-1 text-xs">(You)</span>}
                </p>
                {isCurrentTurn && (
                  <p className="text-xs text-primary animate-pulse">Current Turn</p>
                )}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Cash & Net Worth on same line */}
              <div className="text-right mr-2">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">
                    ${player.cash.toLocaleString()}
                  </span>
                  <span className="cash-display text-sm">
                    ${netWorth.toLocaleString()}
                  </span>
                </div>
              </div>
              
              {player.isConnected ? (
                <Wifi className="w-3 h-3 text-cash-positive" />
              ) : (
                <WifiOff className="w-3 h-3 text-destructive" />
              )}
              
              {!isCurrentTurn && (
                effectiveExpanded ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        {/* Collapsible content - Stocks */}
        <CollapsibleContent>
          <div className="mt-3 pt-3 border-t border-border/50">
            <p className="text-xs text-muted-foreground mb-2">Stocks</p>
            {activeStocks.length === 0 ? (
              <p className="text-xs text-muted-foreground/60 italic">No stocks owned</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {activeStocks.map(({ chain, quantity, isMajority, isMinority }) => (
                  <div
                    key={chain}
                    className={cn(
                      "stock-badge",
                      `chain-${chain}`
                    )}
                    title={`${quantity} shares${isMajority ? ' (Majority)' : isMinority ? ' (Minority)' : ''}`}
                  >
                    <span className={cn(
                      "font-semibold",
                      chain === 'tower' ? "text-background" : "text-foreground"
                    )}>
                      {CHAINS[chain].displayName.slice(0, 3)}
                    </span>
                    <span className={cn(
                      chain === 'tower' ? "text-background/80" : "text-foreground/80"
                    )}>
                      {quantity}
                    </span>
                    {isMajority && (
                      <Crown className={cn(
                        "w-3 h-3 ml-0.5",
                        chain === 'tower' ? "text-background" : "text-cash-neutral"
                      )} />
                    )}
                    {isMinority && (
                      <span className={cn(
                        "text-[10px] font-bold ml-0.5",
                        chain === 'tower' ? "text-background" : "text-chain-minority"
                      )}>
                        2
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};
