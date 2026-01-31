import { TileId } from '@/types/game';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogPortal,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

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
      <DialogPortal>
        {/* Transparent overlay - allows viewing the board and hotels */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
        />
        {/* Modal content */}
        <DialogPrimitive.Content
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-md translate-x-[-50%] translate-y-[-50%]",
            "gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          )}
        >
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

          {/* Close button */}
          <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
};
