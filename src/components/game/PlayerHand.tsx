import { TileId, GameState } from '@/types/game';
import { analyzeTilePlacement } from '@/utils/gameLogic';
import { cn } from '@/lib/utils';

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

  const getTileReason = (tileId: TileId): string | null => {
    if (!isCurrentPlayer) return null;
    const analysis = analyzeTilePlacement(gameState, tileId);
    if (!analysis.valid) return analysis.reason || null;
    return null;
  };

  return (
    <div className="bg-card rounded-xl p-4 shadow-md">
      <h3 className="text-sm font-semibold text-muted-foreground mb-3">Your Tiles</h3>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map(tileId => {
          const playable = isTilePlayable(tileId);
          const reason = getTileReason(tileId);
          const isSelected = selectedTile === tileId;
          
          return (
            <button
              key={tileId}
              onClick={() => playable && onTileClick(tileId)}
              disabled={!playable}
              className={cn(
                "relative aspect-[4/3] rounded-lg font-mono text-sm font-semibold",
                "border-2 transition-all duration-200",
                isSelected
                  ? "bg-primary border-primary text-primary-foreground scale-105 ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : playable
                    ? "bg-primary/20 border-primary text-primary cursor-pointer hover:bg-primary/30 hover:scale-105 animate-pulse-subtle"
                    : "bg-muted/50 border-border/50 text-muted-foreground cursor-not-allowed opacity-60"
              )}
              title={reason || undefined}
            >
              {tileId}
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
            className="aspect-[4/3] rounded-lg border-2 border-dashed border-border/30 bg-muted/20"
          />
        ))}
      </div>
      
      {isCurrentPlayer && canPlace && (
        <p className="mt-3 text-xs text-muted-foreground text-center">
          Click a highlighted tile to place it
        </p>
      )}
    </div>
  );
};
