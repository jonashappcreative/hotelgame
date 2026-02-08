import React, { useState } from 'react';
import { ChainName, CHAINS } from '@/types/game';
import { TutorialGameState } from './types';
import { Button } from '@/components/ui/button';
import { Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TutorialStockPurchaseProps {
  gameState: TutorialGameState;
  onPurchase: (quantity: number) => void;
  targetQuantity?: number;
}

export const TutorialStockPurchase: React.FC<TutorialStockPurchaseProps> = ({
  gameState,
  onPurchase,
  targetQuantity = 2,
}) => {
  const [quantity, setQuantity] = useState(0);

  // Only Sackson is active in tutorial
  const chain: ChainName = 'sackson';
  const chainInfo = CHAINS[chain];
  const chainState = gameState.chains[chain];
  
  // Calculate price based on size
  const getStockPrice = (size: number): number => {
    const basePrice = chainInfo.tier === 'budget' ? 200 : chainInfo.tier === 'midrange' ? 300 : 400;
    if (size >= 4) return basePrice + 200;
    if (size >= 3) return basePrice + 100;
    return basePrice;
  };

  const price = getStockPrice(chainState.tiles.length);
  const totalCost = price * quantity;
  const canAfford = totalCost <= gameState.playerCash;
  const maxPurchase = Math.min(3, Math.floor(gameState.playerCash / price), gameState.stockBank[chain]);

  const handleIncrement = () => {
    if (quantity < maxPurchase) {
      setQuantity(q => q + 1);
    }
  };

  const handleDecrement = () => {
    if (quantity > 0) {
      setQuantity(q => q - 1);
    }
  };

  const handleConfirm = () => {
    if (quantity > 0) {
      onPurchase(quantity);
    }
  };

  return (
    <div className="bg-card rounded-xl p-4 shadow-lg border border-border" data-tutorial="stock-purchase">
      <h3 className="text-lg font-semibold mb-4 text-center">Buy Stocks</h3>
      
      <div className="space-y-4">
        {/* Sackson stock purchase */}
        <div className={cn(
          "p-4 rounded-lg border",
          quantity === targetQuantity ? "border-primary bg-primary/10" : "border-border bg-secondary/30"
        )}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={cn("w-4 h-4 rounded-full", `chain-${chain}`)} />
              <span className="font-medium">{chainInfo.displayName}</span>
            </div>
            <span className="text-sm text-muted-foreground">${price}/share</span>
          </div>
          
          <div className="flex items-center justify-center gap-4">
            <Button
              variant="outline"
              size="icon"
              onClick={handleDecrement}
              disabled={quantity === 0}
            >
              <Minus className="w-4 h-4" />
            </Button>
            
            <span className="text-2xl font-bold w-12 text-center">{quantity}</span>
            
            <Button
              variant="outline"
              size="icon"
              onClick={handleIncrement}
              disabled={quantity >= maxPurchase}
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          
          {quantity > 0 && (
            <p className="text-center text-sm text-muted-foreground mt-2">
              Cost: ${totalCost.toLocaleString()}
            </p>
          )}
        </div>

        {/* Confirm button */}
        <Button
          className="w-full"
          onClick={handleConfirm}
          disabled={quantity !== targetQuantity}
        >
          {quantity === targetQuantity 
            ? `Buy ${quantity} Stock${quantity > 1 ? 's' : ''} for $${totalCost}`
            : `Select ${targetQuantity} stocks to continue`
          }
        </Button>

        {quantity !== targetQuantity && (
          <p className="text-xs text-primary text-center">
            Buy exactly {targetQuantity} stocks to continue the tutorial
          </p>
        )}
      </div>
    </div>
  );
};
