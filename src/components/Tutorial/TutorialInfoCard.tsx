import React from 'react';
import { ChainName, CHAINS, BASE_PRICES } from '@/types/game';
import { TutorialGameState } from './types';
import { getStockPrice, getBonuses } from '@/utils/gameLogic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Info, Star } from 'lucide-react';

interface TutorialInfoCardProps {
  gameState: TutorialGameState;
}

export const TutorialInfoCard: React.FC<TutorialInfoCardProps> = ({ gameState }) => {
  const chainNames = Object.keys(CHAINS) as ChainName[];

  return (
    <Card className="shadow-lg" data-tutorial="info-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Info className="w-4 h-4" />
          Stock Information Card
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Chain Status */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground mb-2">Active Chains</h4>
          <div className="grid grid-cols-2 gap-2">
            {chainNames.map(chain => {
              const state = gameState.chains[chain];
              const price = state.isActive ? getStockPrice(chain, state.tiles.length) : 0;
              const bonuses = state.isActive ? getBonuses(chain, state.tiles.length) : { majority: 0, minority: 0 };
              
              return (
                <div
                  key={chain}
                  className={cn(
                    "p-2 rounded-lg border text-xs",
                    state.isActive 
                      ? "bg-card border-border" 
                      : "bg-muted/30 border-border/30 opacity-50"
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className={cn("w-2.5 h-2.5 rounded-full", `chain-${chain}`)} />
                    <span className="font-medium">{CHAINS[chain].displayName}</span>
                    {state.isSafe && <Star className="w-2.5 h-2.5 text-cash-neutral fill-current" />}
                  </div>
                  
                  {state.isActive ? (
                    <div className="space-y-0.5 text-[10px]">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Size</span>
                        <span className="font-mono">{state.tiles.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Price</span>
                        <span className="font-mono">${price}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bank</span>
                        <span className="font-mono">{gameState.stockBank[chain]}</span>
                      </div>
                      <div className="flex justify-between text-cash-positive">
                        <span>Majority</span>
                        <span className="font-mono">${bonuses.majority.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-cash-neutral">
                        <span>Minority</span>
                        <span className="font-mono">${bonuses.minority.toLocaleString()}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground italic">Not founded</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Price Matrix Summary */}
        <div className="p-2 rounded-lg bg-muted/30 text-[10px] text-muted-foreground">
          <p><strong>Majority Bonus:</strong> 10× stock price</p>
          <p><strong>Minority Bonus:</strong> 5× stock price</p>
          <p><strong>Safe Chain:</strong> 11+ tiles (★)</p>
        </div>
      </CardContent>
    </Card>
  );
};
