import { Banknote, Gift, Layers, Repeat2, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PowerCardId } from '@/types/game';

/**
 * One icon per card, in its own module so the bar, the dialog and the opponent
 * pips can't drift apart — a card that looks different in two places reads as
 * two different cards.
 */
export const POWER_CARD_ICONS: Record<PowerCardId, LucideIcon> = {
  extra_buy: Banknote,
  extra_tiles: Layers,
  free_stock: Gift,
  stock_trade: Repeat2,
  multi_tile: Sparkles,
};
