import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { ActivityPoint } from '@/types/stats';
import { formatDayShort } from './format';

interface ActivityChartProps {
  data: ActivityPoint[];
}

const TooltipBody = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as ActivityPoint;
  return (
    <div className="rounded-lg border border-white/15 bg-popover/95 backdrop-blur px-3 py-2 shadow-xl">
      <div className="text-xs text-muted-foreground">{formatDayShort(point.day)}</div>
      <div className="text-sm font-semibold tabular-nums">
        {point.games} {point.games === 1 ? 'game' : 'games'}
      </div>
    </div>
  );
};

/**
 * Games finished per day over the last 30 days.
 *
 * One series, so no legend — the panel title names it. Gap-filled upstream (by
 * SQL in the live path, by the generator in the sample path) so a quiet day is
 * drawn as a zero rather than silently closing the gap and implying activity
 * that did not happen.
 */
export const ActivityChart = ({ data }: ActivityChartProps) => (
  <div className="h-[180px] w-full">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
        <defs>
          <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.45} />
            <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {/* Recessive grid: horizontal only, so it reads as a scale not a cage. */}
        <CartesianGrid
          vertical={false}
          stroke="hsl(var(--chart-grid))"
          strokeOpacity={0.5}
        />
        <XAxis
          dataKey="day"
          tickFormatter={formatDayShort}
          interval="preserveStartEnd"
          minTickGap={38}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          width={44}
          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          content={<TooltipBody />}
          cursor={{ stroke: 'hsl(var(--chart-1))', strokeOpacity: 0.5, strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="games"
          stroke="hsl(var(--chart-1))"
          strokeWidth={2}
          fill="url(#activityFill)"
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);
