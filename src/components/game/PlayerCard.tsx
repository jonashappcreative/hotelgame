import { useState } from 'react';
import { PlayerState, ChainName, GameState, CHAINS, PowerCardId, POWER_CARDS } from '@/types/game';
import { POWER_CARD_INFO } from '@/types/power-cards';
import { PowerCardDialog } from './PowerCardDialog';
import { POWER_CARD_ICONS } from './powerCardIcons';
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
  cashVisibility?: 'hidden' | 'visible' | 'aggregate';
  myPlayerIndex?: number;
}

export const PlayerCard = ({ player, gameState, isCurrentTurn, isYou, rank, cashVisibility = 'visible', myPlayerIndex }: PlayerCardProps) => {
  const [isExpanded, setIsExpanded] = useState(isCurrentTurn);
  const [openCard, setOpenCard] = useState<PowerCardId | null>(null);
  const netWorth = getPlayerNetWorth(player, gameState.chains);
  const totalCash = gameState.players.reduce((sum, p) => sum + p.cash, 0);

  // Determine what cash/net-worth to display based on visibility mode
  const showExact = isYou || cashVisibility === 'visible';
  const cashLabel = showExact
    ? `$${player.cash.toLocaleString()}`
    : cashVisibility === 'aggregate'
    ? `$${totalCash.toLocaleString()}`
    : '—';
  const netWorthLabel = showExact ? `$${netWorth.toLocaleString()}` : '—';
  void myPlayerIndex; // prop reserved for future use
  
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

  const isDisconnected = player.isConnected === false;

  const powerCards = player.powerCards ?? [];
  // Opponents only: your own five live in PowerCardBar, higher up the same
  // rail, where they can actually be played. Repeating them here would be two
  // rows of the same icons a few hundred pixels apart.
  const showPowerCards = gameState.rulesSnapshot?.powerCards === 'on' && !isYou;

  return (
    <Collapsible open={effectiveExpanded} onOpenChange={setIsExpanded}>
      <div className={cn(
        "player-card relative",
        isCurrentTurn && "player-card-active",
        isYou && "ring-1 ring-primary/30",
        isDisconnected && "opacity-60 border-destructive/50"
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
                  isCurrentTurn && "text-primary",
                  isDisconnected && "text-muted-foreground"
                )}>
                  {player.name}
                  {isYou && <span className="text-muted-foreground ml-1 text-xs">(You)</span>}
                </p>
                {isDisconnected ? (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <WifiOff className="w-3 h-3" />
                    Disconnected
                  </p>
                ) : isCurrentTurn ? (
                  <p className="text-xs text-primary animate-pulse">Current Turn</p>
                ) : null}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Cash & Net Worth on same line */}
              <div className="text-right mr-2">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {cashLabel}
                  </span>
                  <span className="cash-display text-sm">
                    {netWorthLabel}
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

        {/* Remaining power cards (Epic 17). Outside the collapsible on purpose:
            "what does everyone still hold" has to be one uninterrupted scan down
            the rail, not five cards to expand one at a time.

            Public information, so it renders for every seat regardless of the
            room's cash visibility — that setting hides money and nothing else. */}
        {showPowerCards && (
          <div className="mt-2 flex items-center gap-2">
            <p className="text-[10px] text-muted-foreground shrink-0">Cards left</p>
            <div className="flex gap-1">
              {POWER_CARDS.map((card) => {
                const held = powerCards.includes(card);
                const Icon = POWER_CARD_ICONS[card];
                return (
                  <button
                    key={card}
                    type="button"
                    onClick={() => setOpenCard(card)}
                    aria-label={`${POWER_CARD_INFO[card].name} — ${held ? 'still held' : 'spent'}`}
                    title={`${POWER_CARD_INFO[card].name} — ${held ? 'still held' : 'spent'}`}
                    className={cn(
                      'relative flex h-5 w-5 items-center justify-center rounded border transition-colors',
                      held
                        ? 'border-primary/60 bg-primary/15 text-primary hover:bg-primary/25'
                        : 'border-border/40 bg-muted/30 text-muted-foreground/40',
                    )}
                  >
                    <Icon className="h-2.5 w-2.5" />
                    {!held && (
                      <span className="absolute inset-x-0.5 top-1/2 h-px -translate-y-1/2 bg-muted-foreground/50" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

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

        {/* The same read-only dialog the player's own bar opens, so a card is
            explained identically wherever it is clicked. */}
        <PowerCardDialog
          card={openCard}
          // Always read-only: the one place a card can be played is its owner's
          // own bar, and this card belongs to an opponent.
          status={openCard && powerCards.includes(openCard) ? 'blocked' : 'spent'}
          ownerName={player.name}
          onClose={() => setOpenCard(null)}
        />
      </div>
    </Collapsible>
  );
};
