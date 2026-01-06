import { TileId } from '@/types/game';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Check, X } from 'lucide-react';

interface TileConfirmationModalProps {
  selectedTile: TileId | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const TileConfirmationModal = ({
  selectedTile,
  onConfirm,
  onCancel,
}: TileConfirmationModalProps) => {
  if (!selectedTile) return null;

  return (
    <Dialog open={!!selectedTile} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Tile Placement</DialogTitle>
          <DialogDescription>
            Place tile <span className="font-mono font-semibold text-primary">{selectedTile}</span> on the board?
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center py-6">
          <div className="w-20 h-16 rounded-lg bg-primary/20 border-2 border-primary flex items-center justify-center font-mono text-2xl font-bold text-primary animate-pulse-subtle">
            {selectedTile}
          </div>
        </div>

        <DialogFooter className="flex gap-3 sm:gap-3">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
          <Button onClick={onConfirm} className="flex-1">
            <Check className="w-4 h-4 mr-2" />
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
