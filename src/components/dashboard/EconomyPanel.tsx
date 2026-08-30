import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { EconomyStats } from '@/types/stats';
import { formatMoney, formatMoneyShort } from './format';

interface EconomyPanelProps {
  economy: EconomyStats;
}

const TooltipBody = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const bucket = payload[0].payload;
  return (
    <div className="rounded-lg border border-white/15 bg-popover/95 backdrop-blur px-3 py-2 shadow-xl">
      <div className="text-xs text-muted-foreground">
        {formatMoneyShort(bucket.from)} – {formatMoneyShort(bucket.from + 10000)}
      </div>
      <div className="text-sm font-semibold tabular-nums">
        {bucket.count} {bucket.count === 1 ? 'game' : 'games'}
      </div>
    </div>
  );
};

/**
 * What it takes to win: the distribution of the winner's final net worth,
 * bucketed in $10,000 bands.
 *
 * A histogram, not a ranked bar chart — the x axis is a continuous quantity, so
 * the bars are ordered by value and touch conceptually. They keep a 2px surface
 * gap so adjacent bands stay countable.
 */
export const EconomyPanel = ({ economy }: EconomyPanelProps) => (
  <div className="space-y-4">
    <div className="h-[150px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={economy.buckets} margin={{ top: 4, right: 4, bottom: 0, left: -26 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="hsl(var(--chart-grid))" strokeOpacity={0.5} />
          <XAxis
            dataKey="from"
            tickFormatter={(v) => formatMoneyShort(Number(v))}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            allowDecimals={false}
            width={44}
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<TooltipBody />} cursor={{ fill: 'hsl(var(--chart-1))', fillOpacity: 0.08 }} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {economy.buckets.map((bucket) => (
              <Cell key={bucket.from} fill="hsl(var(--chart-1))" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>

    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs pt-1 border-t border-white/10">
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">Typical win</dt>
        <dd className="tabular-nums">{formatMoney(economy.avgWinningTotal)}</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">Best ever</dt>
        <dd className="tabular-nums">{formatMoney(economy.maxWinningTotal)}</dd>
      </div>
      <div className="flex justify-between gap-2">
        {/* The smallest winning net worth — not the narrowest margin, which is
            a different number and lives in the first-to-last gap below. */}
        <dt className="text-muted-foreground" title="Lowest net worth that still won a game">
          Leanest win
        </dt>
        <dd className="tabular-nums">{formatMoney(economy.minWinningTotal)}</dd>
      </div>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground" title="Average gap between first and last place">
          First-to-last gap
        </dt>
        <dd className="tabular-nums">{formatMoney(economy.avgSpread)}</dd>
      </div>
    </dl>
  </div>
);
