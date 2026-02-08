import React from 'react';
import { TileId } from '@/types/game';
import { TutorialGameState } from './types';
import { cn } from '@/lib/utils';

interface TutorialPlayerHandProps {
  gameState: TutorialGameState;
  highlightedTile?: TileId;
  onTileClick?: (tileId: TileId) => void;
  selectedTile?: TileId | null;
}

export const TutorialPlayerHand: React.FC<TutorialPlayerHandProps> = ({
  gameState,
  highlightedTile,
  onTileClick,
  selectedTile,
}) => {
  const { playerTiles } = gameState;

  return (
    <div className="bg-card rounded-xl p-4 shadow-md" data-tutorial="player-hand">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Your Tiles</h3>
      <div className="grid grid-cols-3 gap-2">
        {playerTiles.map(tileId => {
          const isHighlighted = highlightedTile === tileId;
          const isSelected = selectedTile === tileId;
          
          return (
            <button
              key={tileId}
              data-tutorial={`tile-${tileId}`}
              onClick={() => onTileClick?.(tileId)}
              className={cn(
                "relative aspect-[4/3] rounded-lg font-mono text-sm font-semibold",
                "border-2 transition-all duration-200",
                isSelected
                  ? "bg-primary border-primary text-primary-foreground scale-105 ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : isHighlighted
                    ? "bg-primary/30 border-primary text-primary cursor-pointer hover:bg-primary/40 hover:scale-105 animate-pulse-subtle"
                    : "bg-primary/20 border-primary text-primary cursor-pointer hover:bg-primary/30 hover:scale-105"
              )}
            >
              {tileId}
              {!isSelected && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
        
        {/* Empty slots */}
        {Array.from({ length: Math.max(0, 6 - playerTiles.length) }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="aspect-[4/3] rounded-lg border-2 border-dashed border-border/30 bg-muted/20"
          />
        ))}
      </div>
      
      <p className="mt-3 text-xs text-muted-foreground text-center">
        Click a highlighted tile to place it
      </p>
    </div>
  );
};
