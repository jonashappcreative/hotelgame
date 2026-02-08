import React from 'react';
import { ChainName, CHAINS } from '@/types/game';
import { TutorialGameState } from './types';
import { cn } from '@/lib/utils';

interface TutorialPlayerInfoProps {
  gameState: TutorialGameState;
}

export const TutorialPlayerInfo: React.FC<TutorialPlayerInfoProps> = ({
  gameState,
}) => {
  const { playerCash, playerStocks } = gameState;

  // Calculate stock value
  const getStockPrice = (chain: ChainName, size: number): number => {
    if (size < 2) return 0;
    const tier = CHAINS[chain].tier;
    const basePrice = tier === 'budget' ? 200 : tier === 'midrange' ? 300 : 400;
    if (size >= 41) return basePrice + 700;
    if (size >= 31) return basePrice + 600;
    if (size >= 21) return basePrice + 500;
    if (size >= 11) return basePrice + 400;
    if (size >= 6) return basePrice + 300;
    if (size >= 4) return basePrice + 200;
    if (size >= 3) return basePrice + 100;
    return basePrice;
  };

  const stockValue = Object.entries(playerStocks).reduce((total, [chain, quantity]) => {
    const chainState = gameState.chains[chain as ChainName];
    const price = getStockPrice(chain as ChainName, chainState.tiles.length);
    return total + (quantity * price);
  }, 0);

  const netWorth = playerCash + stockValue;

  const activeStocks = Object.entries(playerStocks).filter(([_, qty]) => qty > 0);

  return (
    <div className="bg-card rounded-xl p-4 shadow-md space-y-4" data-tutorial="player-info">
      {/* Cash */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-1">Cash</h3>
        <p className="cash-display text-2xl">${playerCash.toLocaleString()}</p>
      </div>

      {/* Stocks */}
      <div data-tutorial="player-stocks">
        <h3 className="text-sm font-semibold text-muted-foreground mb-2">Stocks</h3>
        {activeStocks.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {activeStocks.map(([chain, quantity]) => (
              <div
                key={chain}
                className={cn(
                  "stock-badge",
                  `chain-${chain}`
                )}
              >
                <span className="font-semibold">{quantity}</span>
                <span>{CHAINS[chain as ChainName].displayName}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No stocks yet</p>
        )}
      </div>

      {/* Net Worth */}
      <div className="pt-3 border-t border-border/50">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Net Worth</span>
          <span className="font-semibold text-lg">${netWorth.toLocaleString()}</span>
        </div>
        {stockValue > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            (Cash: ${playerCash.toLocaleString()} + Stocks: ${stockValue.toLocaleString()})
          </p>
        )}
      </div>
    </div>
  );
};
