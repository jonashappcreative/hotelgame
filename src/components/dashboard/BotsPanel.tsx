import type { SeatTypeStat } from '@/types/stats';
import { BarRow } from './BarRow';
import { formatMoneyShort, formatNumber, formatPercent, SEAT_TYPE_LABELS } from './format';

interface BotsPanelProps {
  bots: SeatTypeStat[];
}

/**
 * Win rate by seat type — the first look at whether the three bot difficulties
 * actually differ. bot_difficulty has been written to the database since bots
 * shipped and has never once been read back.
 *
 * Two hues only, and they encode a real distinction (a person played this seat
 * or a program did), not a series index. Every bar is directly labelled, so the
 * colours are reinforcement rather than the sole channel. Validated against the
 * card surface: deltaE 29.8 normal, 15.2 deutan.
 */
export const BotsPanel = ({ bots }: BotsPanelProps) => {
  const max = Math.max(...bots.map((b) => b.winRate), 0.01);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="w-2.5 h-2.5 rounded-[3px] bg-[hsl(var(--chart-1))]" />
          Human
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="w-2.5 h-2.5 rounded-[3px] bg-[hsl(var(--chart-2))]" />
          Bot
        </span>
      </div>

      <div className="space-y-2.5">
        {bots.map((seat) => (
          <BarRow
            key={seat.seatType}
            label={SEAT_TYPE_LABELS[seat.seatType] ?? seat.seatType}
            fraction={seat.winRate / max}
            value={formatPercent(seat.winRate)}
            alt={seat.seatType !== 'human'}
            title={
              `${formatNumber(seat.wins)} wins from ${formatNumber(seat.seats)} seats · ` +
              `average finish ${seat.avgPlacement ?? '—'} · ` +
              `average net worth ${formatMoneyShort(seat.avgTotal)}`
            }
          />
        ))}
      </div>

      <div className="pt-2 border-t border-white/10 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {bots.map((seat) => (
          <div key={seat.seatType} className="flex justify-between gap-2 min-w-0">
            <span className="text-muted-foreground truncate">
              {SEAT_TYPE_LABELS[seat.seatType] ?? seat.seatType}
            </span>
            <span className="tabular-nums text-foreground/80 shrink-0">
              avg #{seat.avgPlacement ?? '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
