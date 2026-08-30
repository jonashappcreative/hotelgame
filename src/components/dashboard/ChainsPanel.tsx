import type { ChainStat } from '@/types/stats';
import { CHAINS } from '@/types/game';
import { BarRow } from './BarRow';
import { formatNumber, formatPercent } from './format';

interface ChainsPanelProps {
  chains: ChainStat[];
  totalGames: number;
}

/**
 * How each hotel chain finishes: how often it ends the game as the biggest
 * chain on the board, how often it gets founded at all, and how large it
 * typically gets.
 *
 * The chain's own colour appears as a swatch beside its name, never as the bar.
 * Those seven colours are the board's identity palette, not a data palette —
 * Imperial and Continental separate by only deltaE 11.6 to normal colour vision
 * and 5.4 under deuteranopia, so as adjacent bars they would be genuinely
 * ambiguous. Attached to a text label they are recognisable branding with
 * nothing riding on telling them apart.
 */
export const ChainsPanel = ({ chains, totalGames }: ChainsPanelProps) => {
  const ranked = [...chains].sort((a, b) => b.timesLargest - a.timesLargest);
  const max = Math.max(...ranked.map((c) => c.timesLargest), 1);

  // A chain that was never founded in any recorded game has no average size at
  // all (SQL returns NULL, not 0). Counting it as a zero would drag the
  // cross-chain average down by a chain that never played.
  const sizes = ranked.map((c) => c.avgSize).filter((s): s is number => s !== null);
  const averageSize = sizes.length
    ? sizes.reduce((sum, size) => sum + size, 0) / sizes.length
    : null;

  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        {ranked.map((chain) => (
          <BarRow
            key={chain.chain}
            label={CHAINS[chain.chain]?.displayName ?? chain.chain}
            swatchColor={CHAINS[chain.chain]?.color}
            fraction={chain.timesLargest / max}
            value={formatPercent(chain.timesLargest / Math.max(totalGames, 1))}
            title={
              `Biggest chain in ${formatNumber(chain.timesLargest)} games · ` +
              `founded in ${formatNumber(chain.timesFounded)} · ` +
              `average final size ${chain.avgSize ?? '—'} tiles`
            }
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground pt-1 border-t border-white/10">
        Share of games this chain ended as the largest on the board. Average final
        size across all chains:{' '}
        <span className="text-foreground/90 tabular-nums">
          {averageSize === null ? '—' : averageSize.toFixed(1)} tiles
        </span>.
      </p>
    </div>
  );
};
