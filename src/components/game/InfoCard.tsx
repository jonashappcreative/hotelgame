import { GameState, ChainName, CHAINS, BASE_PRICES, CHAIN_SIZE_BRACKETS } from '@/types/game';
import { getStockPrice, getBonuses } from '@/utils/gameLogic';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Info, Star, Flag } from 'lucide-react';

interface InfoCardProps {
  gameState: GameState;
}

export const InfoCard = ({ gameState }: InfoCardProps) => {
  const chainNames = Object.keys(CHAINS) as ChainName[];

  // Epic 18: mark the chain that put the game within reach of an end, so the
  // condition is visible to every player and not just to whoever could declare.
  const endGameSize = gameState.boardRows === 6 ? 30 : 41;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Info className="w-4 h-4" />
          Info Card
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Stock Information Card</DialogTitle>
        </DialogHeader>

        {/* Current Chain Status */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-muted-foreground mb-3">Active Chains</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {chainNames.map(chain => {
              const state = gameState.chains[chain];
              const price = state.isActive ? getStockPrice(chain, state.tiles.length) : 0;
              const bonuses = state.isActive ? getBonuses(chain, state.tiles.length) : { majority: 0, minority: 0 };
              
              return (
                <div
                  key={chain}
                  className={cn(
                    "p-3 rounded-lg border",
                    state.isActive 
                      ? "bg-card border-border" 
                      : "bg-muted/30 border-border/30 opacity-50"
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={cn("w-3 h-3 rounded-full", `chain-${chain}`)} />
                    <span className="font-medium text-sm">{CHAINS[chain].displayName}</span>
                    {state.isSafe && <Star className="w-3 h-3 text-cash-neutral fill-current" />}
                    {state.isActive && state.tiles.length >= endGameSize && (
                      <Flag
                        className="w-3 h-3 text-chain-merger"
                        aria-label={`At ${endGameSize}+ tiles — the game can be declared over`}
                      />
                    )}
                  </div>
                  
                  {state.isActive ? (
                    <div className="space-y-1 text-xs">
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
                    <p className="text-xs text-muted-foreground italic">Not founded</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Price Matrix */}
        <div>
          <h4 className="text-sm font-semibold text-muted-foreground mb-3">Stock Price Matrix</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">Chain Size</th>
                  <th className="text-center py-2 px-3">
                    <span className="inline-flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full chain-sackson" />
                      <div className="w-2 h-2 rounded-full chain-tower" />
                      Budget
                    </span>
                  </th>
                  <th className="text-center py-2 px-3">
                    <span className="inline-flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full chain-worldwide" />
                      <div className="w-2 h-2 rounded-full chain-american" />
                      <div className="w-2 h-2 rounded-full chain-festival" />
                      Mid-range
                    </span>
                  </th>
                  <th className="text-center py-2 px-3">
                    <span className="inline-flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full chain-continental" />
                      <div className="w-2 h-2 rounded-full chain-imperial" />
                      Premium
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  { range: '2', idx: 0 },
                  { range: '3', idx: 1 },
                  { range: '4-5', idx: 2 },
                  { range: '6-10', idx: 3 },
                  { range: '11-20', idx: 4 },
                  { range: '21-30', idx: 5 },
                  { range: '31-40', idx: 6 },
                  { range: '41+', idx: 7 },
                ].map(({ range, idx }) => (
                  <tr key={range} className="border-b border-border/50">
                    <td className="py-2 px-3 font-mono text-muted-foreground">{range}</td>
                    <td className="py-2 px-3 text-center font-mono">${BASE_PRICES.budget[idx]}</td>
                    <td className="py-2 px-3 text-center font-mono">${BASE_PRICES.midrange[idx]}</td>
                    <td className="py-2 px-3 text-center font-mono">${BASE_PRICES.premium[idx]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          <div className="mt-4 p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
            <p><strong>Majority Bonus:</strong> 10× stock price</p>
            <p><strong>Minority Bonus:</strong> 5× stock price</p>
            <p><strong>Safe Chain:</strong> 11+ tiles (★) - Cannot be acquired in mergers</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
