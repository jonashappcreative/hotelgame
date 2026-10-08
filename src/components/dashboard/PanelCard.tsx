import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface PanelCardProps {
  title: string;
  /** One line under the title saying what the panel measures. */
  subtitle?: string;
  icon?: ReactNode;
  /** Games recorded so far. Compared against `minimum` to gate the panel. */
  sample: number;
  /** Below this many recorded games the panel shows a "needs N games" state. */
  minimum: number;
  className?: string;
  children: ReactNode;
}

/**
 * A dashboard panel that refuses to draw itself on too little data.
 *
 * game_results starts empty and fills forward (nothing was recorded before
 * Epic 16), so on a fresh deployment every panel here is either empty or
 * working from a handful of games. A rules chart reading "100% Aggressive" off
 * three games is not a finding, it is noise wearing a finding's clothes — so
 * below its threshold a panel says how many games it still needs instead.
 */
export const PanelCard = ({
  title, subtitle, icon, sample, minimum, className, children,
}: PanelCardProps) => {
  const belowMinimum = sample < minimum;

  return (
    <Card className={cn('bg-card/40 backdrop-blur-xl border-white/10', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardHeader>
      <CardContent>
        {belowMinimum ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              {sample === 0
                ? 'No games recorded yet.'
                : `Needs ${minimum} games — ${sample} recorded so far.`}
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Too few games to say anything meaningful.
            </p>
          </div>
        ) : children}
      </CardContent>
    </Card>
  );
};
