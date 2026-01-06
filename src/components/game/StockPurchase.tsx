import { useState } from 'react';
import { ChainName, GameState, CHAINS, MAX_STOCKS_PER_TURN, STOCKS_PER_CHAIN } from '@/types/game';
import { getStockPrice } from '@/utils/gameLogic';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Minus, Plus, ShoppingCart, ArrowRight } from 'lucide-react';

interface StockPurchaseProps {
  gameState: GameState;
  playerCash: number;
  onPurchase: (purchases: { chain: ChainName; quantity: number }[]) => void;
  onEndTurn: () => void;
}

export const StockPurchase = ({ gameState, playerCash, onPurchase, onEndTurn }: StockPurchaseProps) => {
  const [selections, setSelections] = useState<Record<ChainName, number>>({
    sackson: 0,
    tower: 0,
    worldwide: 0,
    american: 0,
    festival: 0,
    continental: 0,
    imperial: 0,
  });
  const [hasPurchased, setHasPurchased] = useState(false);

  const totalSelected = Object.values(selections).reduce((a, b) => a + b, 0);
  
  const getTotalCost = (): number => {
    return (Object.entries(selections) as [ChainName, number][]).reduce((total, [chain, qty]) => {
      if (qty === 0) return total;
      const price = getStockPrice(chain, gameState.chains[chain].tiles.length);
      return total + (price * qty);
    }, 0);
  };

  const totalCost = getTotalCost();
  const canAfford = totalCost <= playerCash;
  const remainingPurchases = MAX_STOCKS_PER_TURN - totalSelected;

  // All chains for display (active first, then inactive/sold out)
  const allChains = (Object.keys(gameState.chains) as ChainName[]);
  
  const activeChains = allChains
    .filter(chain => gameState.chains[chain].isActive && gameState.stockBank[chain] > 0)
    .sort((a, b) => {
      const priceA = getStockPrice(a, gameState.chains[a].tiles.length);
      const priceB = getStockPrice(b, gameState.chains[b].tiles.length);
      return priceA - priceB;
    });

  const soldOutChains = allChains
    .filter(chain => gameState.chains[chain].isActive && gameState.stockBank[chain] === 0);

  const updateSelection = (chain: ChainName, delta: number) => {
    const currentQty = selections[chain];
    const available = gameState.stockBank[chain];
    const newQty = Math.max(0, Math.min(currentQty + delta, available));
    
    // Check if adding would exceed max purchases
    if (delta > 0 && totalSelected >= MAX_STOCKS_PER_TURN) return;
    
    // Check if can afford
    if (delta > 0) {
      const price = getStockPrice(chain, gameState.chains[chain].tiles.length);
      if (totalCost + price > playerCash) return;
    }

    setSelections(prev => ({ ...prev, [chain]: newQty }));
  };

  const handleBuy = () => {
    const purchases = (Object.entries(selections) as [ChainName, number][])
      .filter(([_, qty]) => qty > 0)
      .map(([chain, quantity]) => ({ chain, quantity }));
    
    if (purchases.length > 0) {
      onPurchase(purchases);
      setHasPurchased(true);
      // Reset selections after purchase
      setSelections({
        sackson: 0,
        tower: 0,
        worldwide: 0,
        american: 0,
        festival: 0,
        continental: 0,
        imperial: 0,
      });
    }
  };

  if (activeChains.length === 0 && soldOutChains.length === 0) {
    return (
      <div className="bg-card rounded-xl p-6 text-center animate-slide-up">
        <p className="text-muted-foreground mb-4">No active chains to purchase stock from</p>
        <Button onClick={onEndTurn} size="lg">
          <ArrowRight className="w-4 h-4 mr-2" />
          End Turn
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl p-4 md:p-6 animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Buy Stocks</h3>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {remainingPurchases} of {MAX_STOCKS_PER_TURN} remaining
          </span>
        </div>
      </div>

      <div className="space-y-3 mb-4">
        {/* Active purchasable chains */}
        {activeChains.map(chain => {
          const chainState = gameState.chains[chain];
          const price = getStockPrice(chain, chainState.tiles.length);
          const available = gameState.stockBank[chain];
          const selected = selections[chain];
          const canBuyMore = selected < available && totalSelected < MAX_STOCKS_PER_TURN && totalCost + price <= playerCash;

          return (
            <div
              key={chain}
              className={cn(
                "flex items-center justify-between p-3 rounded-lg",
                "bg-secondary/50 border border-border/50"
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn("w-4 h-4 rounded-full", `chain-${chain}`)} />
                <div>
                  <p className="font-medium">{CHAINS[chain].displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    ${price.toLocaleString()} • {available} left
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => updateSelection(chain, -1)}
                  disabled={selected === 0}
                >
                  <Minus className="w-4 h-4" />
                </Button>
                
                <span className="w-8 text-center font-mono font-semibold">
                  {selected}
                </span>
                
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => updateSelection(chain, 1)}
                  disabled={!canBuyMore}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          );
        })}

        {/* Sold out chains - muted display */}
        {soldOutChains.map(chain => {
          const chainState = gameState.chains[chain];
          const price = getStockPrice(chain, chainState.tiles.length);

          return (
            <div
              key={chain}
              className={cn(
                "flex items-center justify-between p-3 rounded-lg",
                "bg-secondary/30 border border-border/30 opacity-50"
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn("w-4 h-4 rounded-full opacity-50", `chain-${chain}`)} />
                <div>
                  <p className="font-medium text-muted-foreground">{CHAINS[chain].displayName}</p>
                  <p className="text-xs text-muted-foreground/60">
                    ${price.toLocaleString()} • Sold Out
                  </p>
                </div>
              </div>
              <span className="text-xs text-muted-foreground italic">No shares available</span>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 mb-4">
        <div>
          <p className="text-sm text-muted-foreground">Total Cost</p>
          <p className={cn(
            "text-xl font-mono font-bold",
            !canAfford && "text-destructive"
          )}>
            ${totalCost.toLocaleString()}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">Your Cash</p>
          <p className="text-xl font-mono font-bold cash-display">
            ${playerCash.toLocaleString()}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {totalSelected > 0 && (
          <Button
            className="flex-1"
            onClick={handleBuy}
            disabled={!canAfford}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            Buy {totalSelected} Share{totalSelected !== 1 ? 's' : ''}
          </Button>
        )}
        <Button
          variant={totalSelected > 0 ? "outline" : "default"}
          className={totalSelected > 0 ? "" : "flex-1"}
          size="lg"
          onClick={onEndTurn}
        >
          <ArrowRight className="w-4 h-4 mr-2" />
          End Turn
        </Button>
      </div>

      {hasPurchased && (
        <p className="text-xs text-muted-foreground text-center mt-3">
          Stocks purchased! You can buy more or end your turn.
        </p>
      )}
    </div>
  );
};
