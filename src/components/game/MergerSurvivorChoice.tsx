import { ChainName, CHAINS } from '@/types/game';
import { Button } from '@/components/ui/button';
import { Crown } from 'lucide-react';

interface MergerSurvivorChoiceProps {
  chains: ChainName[];
  chainSizes: Record<ChainName, number>;
  onSelectSurvivor: (chain: ChainName) => void;
}

export const MergerSurvivorChoice = ({
  chains,
  chainSizes,
  onSelectSurvivor,
}: MergerSurvivorChoiceProps) => {
  // Sort by size (descending), then by tier (premium > midrange > budget)
  const sortedChains = [...chains].sort((a, b) => {
    const sizeA = chainSizes[a] || 0;
    const sizeB = chainSizes[b] || 0;
    if (sizeB !== sizeA) return sizeB - sizeA;
    const tierOrder = { premium: 3, midrange: 2, budget: 1 };
    return tierOrder[CHAINS[b].tier] - tierOrder[CHAINS[a].tier];
  });

  const maxSize = Math.max(...chains.map(c => chainSizes[c] || 0));

  return (
    <div className="bg-card rounded-xl p-6 shadow-lg border border-primary/50 animate-slide-up max-w-2xl w-full">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
          <Crown className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Choose Surviving Chain</h3>
          <p className="text-sm text-muted-foreground">
            Multiple chains are tied for largest. Select which chain will survive the merger.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {sortedChains.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Loading chains...
          </p>
        ) : (
          sortedChains.map(chain => {
            const info = CHAINS[chain];
            const size = chainSizes[chain] || 0;
            const isTied = size === maxSize;

            return (
              <Button
                key={chain}
                variant="outline"
                className={`w-full h-auto p-4 flex items-center justify-between hover:border-primary chain-${chain}`}
                onClick={() => onSelectSurvivor(chain)}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full chain-${chain}`} />
                  <div className="text-left">
                    <p className="font-semibold">{info.displayName}</p>
                    <p className="text-xs text-muted-foreground capitalize">{info.tier} tier</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg">{size} tiles</p>
                  {isTied && (
                    <p className="text-xs text-primary">Tied for largest</p>
                  )}
                </div>
              </Button>
            );
          })
        )}
      </div>
    </div>
  );
};
