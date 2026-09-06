import { MAX_STOCKS_PER_TURN } from '@/types/game';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowRight, Banknote, Flag, ShoppingCart } from 'lucide-react';

interface EndTurnConfirmModalProps {
  /** Shares already bought this turn (0 when the player hasn't bought at all). */
  purchasedThisTurn: number;
  /** Shares sitting in the buy panel that were never confirmed. */
  pendingShares: number;
  /** Cost of those unconfirmed shares. */
  pendingCost: number;
  /** Shares sitting in the sell panel that were never confirmed. */
  pendingSellShares?: number;
  /** Proceeds those unconfirmed sales would have raised. */
  pendingProceeds?: number;
  /** False when the turn is only still open because the player can sell. */
  canStillBuy?: boolean;
  /**
   * Which end-game condition is met, or null when none is (Epic 18). Non-null
   * turns this into the declaration decision point — the reminder that the game
   * can be finished, at the only moment it matters.
   */
  endCondition?: 'threshold' | 'all_safe' | null;
  /** End-game chain size for this board — 41, or 30 on a small board. */
  endGameSize?: number;
  /** True once this player has already announced the end this turn. */
  alreadyDeclared?: boolean;
  /** Declare and end the turn in one gesture. */
  onDeclareAndEnd?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export const EndTurnConfirmModal = ({
  purchasedThisTurn,
  pendingShares,
  pendingCost,
  pendingSellShares = 0,
  pendingProceeds = 0,
  canStillBuy = true,
  endCondition = null,
  endGameSize = 41,
  alreadyDeclared = false,
  onDeclareAndEnd,
  onConfirm,
  onCancel,
}: EndTurnConfirmModalProps) => {
  const boughtNothing = purchasedThisTurn === 0;

  // Epic 18. Once the game can be ended the turn no longer ends itself, so this
  // modal is the only way out of the buy phase — which makes it both the
  // reminder and the decision. It outranks the buy/sell variants because
  // "the game can be finished" is the larger fact on the table.
  const endGameChoice = endCondition !== null && !alreadyDeclared && onDeclareAndEnd !== undefined;
  const reasonLine = endCondition === 'all_safe'
    ? 'Every chain on the board is safe.'
    : `A chain has reached ${endGameSize} tiles.`;

  const headline = alreadyDeclared
    ? 'Ending this turn ends the game'
    : endGameChoice
      ? 'The game can be ended'
      : !canStillBuy
        ? 'You can still sell stock'
        : boughtNothing
          ? "You haven't bought any stock"
          : 'You can still buy stock';

  const subline = alreadyDeclared
    ? 'You declared the game over on this turn. Final scores are calculated as soon as your turn ends.'
    : endGameChoice
      ? `${reasonLine} Declare now and the game ends when this turn does — or keep playing and decide on a later turn.`
      : !canStillBuy
        ? 'You hold shares the bank would buy back this turn. End your turn anyway?'
        : boughtNothing
          ? 'You can still afford shares this turn. End your turn without buying?'
          : `You've bought ${purchasedThisTurn} of ${MAX_STOCKS_PER_TURN} shares and can still afford another. End your turn anyway?`;

  return (
    <div className="bg-card rounded-xl p-6 shadow-lg border border-primary/50 animate-slide-up max-w-md w-full mx-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
          {endCondition !== null
            ? <Flag className="w-5 h-5 text-primary" />
            : <AlertTriangle className="w-5 h-5 text-primary" />}
        </div>
        <div>
          <h3 className="text-lg font-semibold">{headline}</h3>
          <p className="text-sm text-muted-foreground">{subline}</p>
        </div>
      </div>

      {/* Unconfirmed selections are the real footgun — call them out explicitly. */}
      {pendingShares > 0 && (
        <div className="flex items-center gap-3 p-3 mb-4 rounded-lg bg-secondary/50 border border-border/50">
          <ShoppingCart className="w-4 h-4 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            You have{' '}
            <span className="font-semibold text-foreground">
              {pendingShares} share{pendingShares !== 1 ? 's' : ''}
            </span>{' '}
            selected for{' '}
            <span className="font-mono font-semibold text-foreground">
              ${pendingCost.toLocaleString()}
            </span>{' '}
            that you never confirmed. Ending your turn discards the selection.
          </p>
        </div>
      )}

      {/* Same footgun on the sell side of the panel. */}
      {pendingSellShares > 0 && (
        <div className="flex items-center gap-3 p-3 mb-4 rounded-lg bg-secondary/50 border border-border/50">
          <Banknote className="w-4 h-4 text-muted-foreground shrink-0" />
          <p className="text-sm text-muted-foreground">
            You have{' '}
            <span className="font-semibold text-foreground">
              {pendingSellShares} share{pendingSellShares !== 1 ? 's' : ''}
            </span>{' '}
            marked to sell for{' '}
            <span className="font-mono font-semibold text-foreground">
              ${pendingProceeds.toLocaleString()}
            </span>{' '}
            that you never confirmed. Ending your turn discards the sale.
          </p>
        </div>
      )}

      {endGameChoice ? (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button onClick={onDeclareAndEnd} className="flex-1">
              <Flag className="w-4 h-4 mr-2" />
              Declare &amp; End Game
            </Button>
            <Button variant="outline" onClick={onConfirm} className="flex-1">
              <ArrowRight className="w-4 h-4 mr-2" />
              End Turn — Keep Playing
            </Button>
          </div>
          {/* Kept so a mis-click can't cost an unconfirmed selection. */}
          <Button variant="ghost" size="sm" onClick={onCancel} className="w-full">
            Review purchases
          </Button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            <ShoppingCart className="w-4 h-4 mr-2" />
            Review purchases
          </Button>
          <Button onClick={onConfirm} className="flex-1">
            <ArrowRight className="w-4 h-4 mr-2" />
            {alreadyDeclared ? 'End Turn & Finish Game' : 'End turn anyway'}
          </Button>
        </div>
      )}
    </div>
  );
};
