import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface BarRowProps {
  label: string;
  /** Fraction of the row's width to fill, 0-1. */
  fraction: number;
  /** Right-aligned value, always rendered — these bars are directly labeled. */
  value: string;
  /** Optional identity swatch (e.g. a hotel chain's own colour) before the label. */
  swatchColor?: string;
  /** Small tag after the label, e.g. "default". */
  tag?: ReactNode;
  /** Use the alternate data hue instead of the primary one. */
  alt?: boolean;
  title?: string;
}

/**
 * One labelled horizontal bar.
 *
 * Deliberately plain markup rather than a charting library: these are ranked
 * magnitude comparisons where every bar carries its own label and value, so
 * there is no axis to draw and nothing a tooltip would reveal that is not
 * already on screen.
 *
 * The fill is a single hue. Colour never encodes which row this is — the label
 * does — which is why a `swatchColor` can safely carry brand identity that
 * would fail as a data palette.
 */
export const BarRow = ({
  label, fraction, value, swatchColor, tag, alt, title,
}: BarRowProps) => (
  <div className="space-y-1" title={title}>
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="flex items-center gap-1.5 min-w-0">
        {swatchColor && (
          <span
            aria-hidden
            className="w-2.5 h-2.5 rounded-[3px] shrink-0 ring-1 ring-inset ring-white/20"
            style={{ backgroundColor: swatchColor }}
          />
        )}
        <span className="truncate text-foreground/90">{label}</span>
        {tag}
      </span>
      <span className="tabular-nums text-muted-foreground shrink-0">{value}</span>
    </div>
    {/* 6px track, 4px rounded data-end, anchored left to a common baseline. */}
    <div className="h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500',
          alt ? 'bg-[hsl(var(--chart-2))]' : 'bg-[hsl(var(--chart-1))]',
        )}
        style={{ width: `${Math.max(fraction * 100, fraction > 0 ? 1.5 : 0)}%` }}
      />
    </div>
  </div>
);
