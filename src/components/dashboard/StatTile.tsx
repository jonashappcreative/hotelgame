import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StatTileProps {
  value: ReactNode;
  label: string;
  /** Smaller line under the label, e.g. a comparison or unit note. */
  hint?: string;
  /** Live tiles get the accent treatment so the "right now" strip reads apart. */
  accent?: boolean;
  className?: string;
}

/**
 * A single number that is the whole point. Per the dataviz form heuristic a
 * lone headline figure is not a chart — a chart would add axes and gridlines
 * around one value and make it harder to read, not easier.
 */
export const StatTile = ({ value, label, hint, accent, className }: StatTileProps) => (
  <div
    className={cn(
      'rounded-xl border px-4 py-3 min-w-0',
      accent
        ? 'border-[hsl(var(--chart-1))]/35 bg-[hsl(var(--chart-1))]/10'
        : 'border-white/10 bg-card/40',
      className,
    )}
  >
    <div className={cn(
      'text-2xl font-semibold tabular-nums truncate',
      accent ? 'text-[hsl(var(--primary))]' : 'text-foreground',
    )}>
      {value}
    </div>
    <div className="text-xs text-muted-foreground mt-0.5 truncate">{label}</div>
    {hint && <div className="text-[11px] text-muted-foreground/70 truncate">{hint}</div>}
  </div>
);
