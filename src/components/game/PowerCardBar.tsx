import { useState } from 'react';
import { GameState, PowerCardId, POWER_CARDS } from '@/types/game';
import { canPlayPowerCard, POWER_CARD_INFO, remainingPowerTrades } from '@/types/power-cards';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PowerCardDialog, type PowerCardStatus } from './PowerCardDialog';
import { POWER_CARD_ICONS } from './powerCardIcons';

interface PowerCardBarProps {
  gameState: GameState;
  /** The seat whose cards these are — always this browser's own player. */
  myPlayerIndex: number;
  /** Play a card. Omitted in local hot-seat play, where the rule is never on. */
  onPlayPowerCard?: (card: PowerCardId) => void;
}

/**
 * Epic 17. The five cards, in fixed order, in the right rail between your tiles
 * and End Turn.
 *
 * The rail is already read top-to-bottom as *what I have → what I can do → end
 * my turn*, and the cards slot in as the last "what I have". They also have to
 * be reachable in **both** place_tile and buy_stock — Building Spree and Extra
 * Tiles are placement-time, the other three buy-time — and the left column's
 * action panel swaps by phase, so anything placed there would be hidden for
 * half of every turn.
 *
 * Deliberately a single row of icons: a four-row hand plus this bar must still
 * leave End Turn above the fold on a laptop.
 */
export const PowerCardBar = ({
  gameState,
  myPlayerIndex,
  onPlayPowerCard,
}: PowerCardBarProps) => {
  const [openCard, setOpenCard] = useState<PowerCardId | null>(null);

  // Hidden entirely when the rule is off, which is every local game and every
  // room that didn't turn it on.
  if (gameState.rulesSnapshot?.powerCards !== 'on') return null;

  const me = gameState.players[myPlayerIndex];
  if (!me) return null;

  const held = me.powerCards ?? [];
  const active = gameState.activePowerCard ?? null;
  const isMyTurn = myPlayerIndex === gameState.currentPlayerIndex;

  // The same legality function the server gates play_power_card on, so a card
  // the bar offers is a card the engine accepts.
  const legalityOf = (card: PowerCardId) =>
    canPlayPowerCard(card, {
      enabled: true,
      phase: gameState.phase,
      held,
      active,
      stocksPurchasedThisTurn: gameState.stocksPurchasedThisTurn ?? 0,
      tilesPlacedThisTurn: gameState.tilesPlacedThisTurn ?? 0,
      tileBagCount: gameState.tileBagCount,
    });

  const statusOf = (card: PowerCardId): { status: PowerCardStatus; reason: string } => {
    if (!held.includes(card)) return { status: 'spent', reason: '' };
    if (!isMyTurn) return { status: 'blocked', reason: 'Only on your own turn' };
    const legality = legalityOf(card);
    return legality.ok
      ? { status: 'playable', reason: '' }
      : { status: 'blocked', reason: legality.reason };
  };

  const openStatus = openCard ? statusOf(openCard) : null;
  const tradesLeft = remainingPowerTrades(active);

  return (
    <div className="bg-card rounded-xl p-3 shadow-md">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground">Your Cards</h3>
        {active && (
          <span className="text-[10px] font-semibold text-primary">
            {POWER_CARD_INFO[active.card].name} active
            {active.card === 'stock_trade' && ` · ${tradesLeft} trade${tradesLeft === 1 ? '' : 's'} left`}
          </span>
        )}
      </div>

      <TooltipProvider delayDuration={200}>
        <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Your power cards">
          {POWER_CARDS.map((card) => {
            const { status, reason } = statusOf(card);
            const Icon = POWER_CARD_ICONS[card];
            const info = POWER_CARD_INFO[card];
            const isActive = active?.card === card;

            return (
              <Tooltip key={card}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    // Every state is clickable — a spent or blocked card opens
                    // the same explanation read-only, so a click never dead-ends.
                    onClick={() => setOpenCard(card)}
                    aria-label={`${info.name} — ${status}`}
                    className={cn(
                      'relative aspect-square rounded-md border-2 flex items-center justify-center',
                      'transition-all duration-200',
                      status === 'playable'
                        ? 'bg-primary/20 border-primary text-primary hover:bg-primary/30 hover:scale-105'
                        : status === 'blocked'
                          ? 'bg-muted/40 border-border/60 text-muted-foreground'
                          : 'bg-muted/30 border-border/30 text-muted-foreground/40',
                      isActive && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {status === 'playable' && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full" />
                    )}
                    {status === 'spent' && (
                      <span className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-muted-foreground/50" />
                    )}
                  </button>
                </TooltipTrigger>
                {/* On desktop the hover answers the common case, so the dialog
                    is only needed when a player wants the full rulings. */}
                <TooltipContent side="top" className="max-w-56">
                  <p className="font-semibold">{info.name}</p>
                  <p className="text-xs">
                    {status === 'spent' ? 'Already spent.' : status === 'blocked' ? reason : info.summary}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>

      <PowerCardDialog
        card={openCard}
        status={openStatus?.status ?? 'spent'}
        reason={openStatus?.reason}
        onPlay={
          openCard && openStatus?.status === 'playable' && onPlayPowerCard
            ? () => {
                onPlayPowerCard(openCard);
                setOpenCard(null);
              }
            : undefined
        }
        onClose={() => setOpenCard(null)}
      />
    </div>
  );
};
