import { useState } from 'react';
import { GameState } from '@/types/game';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Flag } from 'lucide-react';
import { endConditionReason } from '@/utils/gameLogic';

interface EndGameDeclarationProps {
  gameState: GameState;
  /** Seat this browser plays. The declaration is the current player's alone. */
  myPlayerIndex: number;
  onDeclare: () => void;
}

/**
 * Epic 18. The header button that announces the game will end — the slot the
 * retired end-game vote used to occupy.
 *
 * Declaring is not the same as ending: the player finishes the turn as normal
 * and the game ends when *they* end it. Both facts a player needs before
 * committing — that it cannot be taken back, and that this turn still completes
 * — are stated in the confirmation, because the button is irreversible.
 */
export const EndGameDeclaration = ({
  gameState,
  myPlayerIndex,
  onDeclare,
}: EndGameDeclarationProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const isMyTurn = myPlayerIndex === gameState.currentPlayerIndex;
  const inDeclarablePhase = gameState.phase === 'place_tile' || gameState.phase === 'buy_stock';
  const reason = endConditionReason(gameState);

  // Already declared, wrong phase, not your turn, or no condition met — the
  // announcement is the current player's to make and nobody else's.
  if (gameState.endDeclaredBy !== null || !isMyTurn || !inDeclarablePhase || reason === null) {
    return null;
  }

  const endGameSize = gameState.boardRows === 6 ? 30 : 41;
  const reasonLine = reason === 'all_safe'
    ? 'Every chain on the board is safe.'
    : `A chain has reached ${endGameSize} tiles.`;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border-chain-merger text-chain-merger hover:bg-chain-merger/10"
        >
          <Flag className="h-4 w-4 mr-2" />
          End Game
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>You can end the game</DialogTitle>
          <DialogDescription>{reasonLine}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2 text-sm">
          <p>
            You'll <span className="font-semibold text-foreground">finish this turn as normal</span> —
            place your tile, resolve any merger, and buy or sell stock. The game ends when you end
            your turn.
          </p>
          <p className="text-muted-foreground">
            A declaration can't be taken back. If you'd rather grow a chain you hold, keep playing
            and decide on a later turn.
          </p>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Keep Playing
          </Button>
          <Button
            onClick={() => {
              onDeclare();
              setIsOpen(false);
            }}
          >
            <Flag className="h-4 w-4 mr-2" />
            End Game
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
