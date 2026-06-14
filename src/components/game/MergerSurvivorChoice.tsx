import { useState, useEffect } from 'react';
import { ChainName, CHAINS } from '@/types/game';
import { Button } from '@/components/ui/button';
import { Crown, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MergerSurvivorChoiceProps {
  chains: ChainName[];
  chainSizes: Record<ChainName, number>;
  onSelectSurvivor: (chain: ChainName) => void;
}

const TIMEOUT_SECONDS = 30;

export const MergerSurvivorChoice = ({
  chains,
  chainSizes,
  onSelectSurvivor,
}: MergerSurvivorChoiceProps) => {
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT_SECONDS);

  // Sort by size (descending), then by tier (premium > midrange > budget)
  const sortedChains = [...chains].sort((a, b) => {
    const sizeA = chainSizes[a] || 0;
    const sizeB = chainSizes[b] || 0;
    if (sizeB !== sizeA) return sizeB - sizeA;
    const tierOrder = { premium: 3, midrange: 2, budget: 1 };
    return tierOrder[CHAINS[b].tier] - tierOrder[CHAINS[a].tier];
  });

  const maxSize = Math.max(...chains.map(c => chainSizes[c] || 0));

  // Countdown timer — auto-selects a random chain when it hits 0
  useEffect(() => {
    if (sortedChains.length === 0) return;
    if (secondsLeft <= 0) {
      const random = sortedChains[Math.floor(Math.random() * sortedChains.length)];
      onSelectSurvivor(random);
      return;
    }
    const t = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, sortedChains, onSelectSurvivor]);

  const progress = (secondsLeft / TIMEOUT_SECONDS) * 100;
  const isUrgent = secondsLeft <= 10;

  return (
    <div className="bg-card rounded-xl p-6 shadow-lg border border-primary/50 animate-slide-up max-w-2xl w-full">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
          <Crown className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold">Choose Surviving Chain</h3>
          <p className="text-sm text-muted-foreground">
            Multiple chains are tied for largest. Select which chain will survive the merger.
          </p>
        </div>
        {/* Countdown */}
        <div className={cn(
          "flex items-center gap-1.5 text-sm font-mono font-semibold",
          isUrgent ? "text-destructive" : "text-muted-foreground"
        )}>
          <Timer className="w-4 h-4" />
          {secondsLeft}s
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-muted rounded-full mb-4 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-1000 ease-linear",
            isUrgent ? "bg-destructive" : "bg-primary"
          )}
          style={{ width: `${progress}%` }}
        />
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
                className="w-full h-auto p-4 flex items-center justify-between hover:bg-accent hover:text-accent-foreground"
                onClick={() => onSelectSurvivor(chain)}
              >
                <div className="flex items-center gap-3">
                  <div className={cn("w-8 h-8 rounded-full flex-shrink-0", `chain-${chain}`)} />
                  <div className="text-left">
                    <p className="font-semibold">{info.displayName}</p>
                    <p className="text-xs text-muted-foreground capitalize">{info.tier} Tier</p>
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
