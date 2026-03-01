import { useState } from 'react';
import { ChainName, CHAINS } from '@/types/game';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Building2, Check } from 'lucide-react';

interface ChainFounderProps {
  availableChains: ChainName[];
  onSelectChain: (chain: ChainName) => void;
}

export const ChainFounder = ({ availableChains, onSelectChain }: ChainFounderProps) => {
  const [selectedChain, setSelectedChain] = useState<ChainName | null>(null);

  // Sort chains by tier for better UX
  const sortedChains = [...availableChains].sort((a, b) => {
    const tierOrder = { budget: 0, midrange: 1, premium: 2 };
    return tierOrder[CHAINS[a].tier] - tierOrder[CHAINS[b].tier];
  });

  const handleConfirm = () => {
    if (selectedChain) {
      onSelectChain(selectedChain);
    }
  };

  return (
    <div className="bg-card rounded-xl p-6 shadow-lg border border-primary/50 animate-slide-up">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
          <Building2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Found a Hotel Chain!</h3>
          <p className="text-sm text-muted-foreground">
            Choose which chain to establish. You'll receive 1 bonus share.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {sortedChains.map((chain, index) => {
          const info = CHAINS[chain];
          const tierLabel = {
            budget: 'Budget • Lower prices, higher volatility',
            midrange: 'Mid-range • Balanced risk and reward',
            premium: 'Premium • Higher prices, stable growth',
          }[info.tier];
          const isLastOdd = sortedChains.length % 2 === 1 && index === sortedChains.length - 1;
          const isSelected = selectedChain === chain;

          return (
            <Button
              key={chain}
              variant="outline"
              className={cn(
                "h-auto p-4 justify-start gap-4",
                "hover:border-primary/50 hover:bg-primary/5 hover:text-foreground",
                isLastOdd && "col-span-2 justify-self-center w-[calc(50%-0.25rem)]",
                isSelected && "border-primary bg-primary/10"
              )}
              onClick={() => setSelectedChain(chain)}
            >
              <div className={cn("w-6 h-6 rounded-full shrink-0", `chain-${chain}`)} />
              <div className="text-left">
                <p className="font-semibold">{info.displayName}</p>
                <p className="text-xs text-muted-foreground">{tierLabel}</p>
              </div>
            </Button>
          );
        })}
      </div>

      <div className="mt-4">
        <Button
          onClick={handleConfirm}
          disabled={!selectedChain}
          className="w-full"
        >
          <Check className="w-4 h-4 mr-2" />
          Confirm
        </Button>
      </div>
    </div>
  );
};
