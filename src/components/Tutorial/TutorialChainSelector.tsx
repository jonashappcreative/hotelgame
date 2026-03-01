import React, { useState } from 'react';
import { ChainName, CHAINS, TileId } from '@/types/game';
import { TutorialGameState } from './types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Building2 } from 'lucide-react';

interface TutorialChainSelectorProps {
  gameState: TutorialGameState;
  onSelectChain: (chain: ChainName) => void;
  allowedChain?: ChainName;
  placedTile?: TileId;
}

export const TutorialChainSelector: React.FC<TutorialChainSelectorProps> = ({
  gameState,
  onSelectChain,
  allowedChain = 'sackson',
  placedTile = '6D',
}) => {
  const availableChains = Object.entries(CHAINS).filter(
    ([name]) => !gameState.chains[name as ChainName].isActive
  );

  return (
    <div className="bg-card rounded-xl p-6 shadow-lg border border-primary/50" data-tutorial="chain-selector">
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

      {/* Tile visual - matching TileConfirmationModal style */}
      {placedTile && (
        <div className="flex items-center justify-center py-4 mb-4">
          <div className="w-20 h-16 rounded-lg bg-primary/20 border-2 border-primary flex items-center justify-center font-mono text-2xl font-bold text-primary animate-pulse-subtle">
            {placedTile}
          </div>
        </div>
      )}

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
