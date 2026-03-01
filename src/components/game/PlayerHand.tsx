import { TileId, GameState } from '@/types/game';
import { analyzeTilePlacement } from '@/utils/gameLogic';
import { cn } from '@/lib/utils';
import { Ban } from 'lucide-react';

interface PlayerHandProps {
  tiles: TileId[];
  gameState: GameState;
  isCurrentPlayer: boolean;
  canPlace: boolean;
  onTileClick: (tileId: TileId) => void;
  selectedTile?: TileId | null;
}

export const PlayerHand = ({ tiles, gameState, isCurrentPlayer, canPlace, onTileClick, selectedTile }: PlayerHandProps) => {
  const isTilePlayable = (tileId: TileId): boolean => {
    if (!isCurrentPlayer || !canPlace) return false;
    const analysis = analyzeTilePlacement(gameState, tileId);
    return analysis.valid;
  };

  // Check if tile is inherently invalid (regardless of turn)
  const isTileInvalid = (tileId: TileId): boolean => {
    const analysis = analyzeTilePlacement(gameState, tileId);
    return !analysis.valid;
  };

  const getTileReason = (tileId: TileId): string | null => {
    const analysis = analyzeTilePlacement(gameState, tileId);
    if (!analysis.valid) return analysis.reason || null;
    return null;
  };

  return (
    <div className="bg-card rounded-xl p-3 shadow-md">
      <h3 className="text-xs font-semibold text-muted-foreground mb-2">Your Tiles</h3>
      <div className="grid grid-cols-3 gap-1.5">
        {tiles.map(tileId => {
          const playable = isTilePlayable(tileId);
          const invalid = isTileInvalid(tileId);
          const reason = getTileReason(tileId);
          const isSelected = selectedTile === tileId;

          return (
            <button
              key={tileId}
              onClick={() => playable && onTileClick(tileId)}
              disabled={!playable}
              className={cn(
                "relative aspect-[4/3] rounded-md font-mono text-xs font-semibold",
                "border-2 transition-all duration-200 flex items-center justify-center gap-0.5",
                isSelected
                  ? "bg-primary border-primary text-primary-foreground scale-105 ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : playable
                    ? "bg-primary/20 border-primary text-primary cursor-pointer hover:bg-primary/30 hover:scale-105 animate-pulse-subtle"
                    : invalid
                      ? "bg-muted/50 border-border/50 text-muted-foreground cursor-not-allowed opacity-60"
                      : "bg-primary/10 border-primary/50 text-primary/60"
              )}
              title={reason || undefined}
            >
              <span>{tileId}</span>
              {invalid && <Ban className="w-3 h-3 flex-shrink-0" />}
              {playable && !isSelected && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full" />
              )}
            </button>
          );
        })}
        
        {/* Empty slots */}
        {Array.from({ length: Math.max(0, 6 - tiles.length) }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="aspect-[4/3] rounded-md border-2 border-dashed border-border/30 bg-muted/20"
          />
        ))}
      </div>

      {isCurrentPlayer && canPlace && (
        <p className="mt-2 text-[10px] text-muted-foreground text-center">
          Click a highlighted tile to place it
        </p>
      )}
    </div>
  );
};
