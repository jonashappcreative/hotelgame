import React, { useState } from 'react';
import { ChainName, CHAINS } from '@/types/game';
import { TutorialGameState } from './types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TutorialChainSelectorProps {
  gameState: TutorialGameState;
  onSelectChain: (chain: ChainName) => void;
  allowedChain?: ChainName;
}

export const TutorialChainSelector: React.FC<TutorialChainSelectorProps> = ({
  gameState,
  onSelectChain,
  allowedChain = 'sackson',
}) => {
  const availableChains = Object.entries(CHAINS).filter(
    ([name]) => !gameState.chains[name as ChainName].isActive
  );

  return (
    <div className="bg-card rounded-xl p-4 shadow-lg border border-primary/50" data-tutorial="chain-selector">
      <h3 className="text-lg font-semibold mb-3 text-center">Choose a Chain to Found</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {availableChains.map(([name, chain]) => {
          const isAllowed = name === allowedChain;
          
          return (
            <Button
              key={name}
              variant="outline"
              onClick={() => isAllowed && onSelectChain(name as ChainName)}
              disabled={!isAllowed}
              className={cn(
                "h-auto py-3 flex flex-col items-center gap-1",
                isAllowed && "ring-2 ring-primary animate-pulse-subtle"
              )}
            >
              <div className={cn("w-6 h-6 rounded-full", `chain-${name}`)} />
              <span className="text-sm font-medium">{chain.displayName}</span>
              <span className="text-xs text-muted-foreground">{chain.tier}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
};
