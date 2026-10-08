import { PowerCardId } from '@/types/game';
import { POWER_CARD_INFO } from '@/types/power-cards';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Info, Sparkles } from 'lucide-react';
import { POWER_CARD_ICONS } from './powerCardIcons';

export type PowerCardStatus =
  /** Yours, legal right now, your turn. */
  | 'playable'
  /** Yours, but not legal at this moment — `reason` says why. */
  | 'blocked'
  /** Already spent, by you or by the player it is attributed to. */
  | 'spent';

interface PowerCardDialogProps {
  card: PowerCardId | null;
  status: PowerCardStatus;
  /** Why the card can't be played right now, straight from canPlayPowerCard. */
  reason?: string;
  /** Set for another player's card, so the dialog can attribute it. */
  ownerName?: string;
  onPlay?: () => void;
  onClose: () => void;
}

/**
 * Epic 17. Five cards across a 320px rail is roughly 52px each — enough for an
 * icon and a state dot, not a name. So the bar carries the icons and a click
 * carries the words.
 *
 * A click therefore *always* explains and never dead-ends: a spent card, a
 * blocked card and an opponent's card all open the same text, read-only, headed
 * by why it can't be played. That is what lets the feature ship without a
 * tutorial chapter — this dialog is how a player learns what the cards do.
 */
export const PowerCardDialog = ({
  card,
  status,
  reason,
  ownerName,
  onPlay,
  onClose,
}: PowerCardDialogProps) => {
  if (!card) return null;

  const info = POWER_CARD_INFO[card];
  const Icon = POWER_CARD_ICONS[card];
  const canPlay = status === 'playable' && onPlay !== undefined;

  const statusLine = ownerName
    ? status === 'spent'
      ? `${ownerName} has already spent this card.`
      : `${ownerName} still holds this card.`
    : status === 'spent'
      ? 'You have already spent this card.'
      : status === 'blocked'
        ? reason || 'Not available right now.'
        : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-primary" />
            {info.name}
          </DialogTitle>
          <DialogDescription>{info.summary}</DialogDescription>
        </DialogHeader>

        {statusLine && (
          <div className="flex items-start gap-2 rounded-lg border border-border/50 bg-secondary/50 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{statusLine}</span>
          </div>
        )}

        <ul className="space-y-2 pt-1 text-sm text-muted-foreground">
          {info.rulings.map((ruling) => (
            <li key={ruling} className="flex gap-2">
              <span aria-hidden className="text-primary">•</span>
              <span>{ruling}</span>
            </li>
          ))}
        </ul>

        {canPlay && (
          <p className="text-sm font-medium text-foreground">
            This card is spent as soon as you play it, even if you change your mind.
          </p>
        )}

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onClose}>
            {canPlay ? 'Cancel' : 'Close'}
          </Button>
          {canPlay && (
            <Button onClick={onPlay}>
              <Sparkles className="mr-2 h-4 w-4" />
              Play card
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
