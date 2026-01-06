import { TileId, GameState } from '@/types/game';
import { analyzeTilePlacement } from '@/utils/gameLogic';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Trash2, AlertTriangle } from 'lucide-react';

interface UnplayableTilesModalProps {
  isOpen: boolean;
  tiles: TileId[];
  gameState: GameState;
  onDiscard: (tileId: TileId) => void;
  onClose: () => void;
}

export const UnplayableTilesModal = ({
  isOpen,
  tiles,
  gameState,
  onDiscard,
  onClose,
}: UnplayableTilesModalProps) => {
  const tilesWithReasons = tiles.map(tileId => {
    const analysis = analyzeTilePlacement(gameState, tileId);
    return {
      tileId,
      reason: analysis.reason || 'This tile cannot be played',
      valid: analysis.valid,
    };
  });

  const hasPlayable = tilesWithReasons.some(t => t.valid);

  if (!isOpen || hasPlayable) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            No Playable Tiles
          </DialogTitle>
          <DialogDescription>
            All your tiles are blocked. You must discard one tile and draw a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {tilesWithReasons.map(({ tileId, reason }) => (
            <div
              key={tileId}
              className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border/50"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-10 rounded bg-muted flex items-center justify-center font-mono font-semibold text-muted-foreground">
                  {tileId}
                </div>
                <p className="text-sm text-muted-foreground">{reason}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDiscard(tileId)}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Discard
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
