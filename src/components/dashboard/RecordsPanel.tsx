import type { RecordEntry, RecordsStats } from '@/types/stats';
import { CHAINS, type ChainName } from '@/types/game';
import { formatDate, formatDuration, formatMoney, formatNumber } from './format';

interface RecordsPanelProps {
  records: RecordsStats;
}

interface Row {
  label: string;
  entry: RecordEntry | null;
  format: (entry: RecordEntry) => string;
}

/**
 * The extremes of every recorded game.
 *
 * Deliberately records and not a leaderboard. player_name is free text typed
 * per room, and with account UI disabled there is no persistent identity behind
 * it — a "top players" table would rank strings that anyone could claim by
 * typing them. A name here captions a single event that did happen, which is a
 * claim the data can actually support.
 */
export const RecordsPanel = ({ records }: RecordsPanelProps) => {
  const rows: Row[] = [
    { label: 'Highest net worth', entry: records.highestScore, format: (e) => formatMoney(e.value) },
    { label: 'Longest game', entry: records.longestGame, format: (e) => formatDuration(e.value) },
    { label: 'Most rounds', entry: records.mostRounds, format: (e) => `${formatNumber(e.value)} rounds` },
    {
      label: 'Largest chain',
      entry: records.largestChain,
      format: (e) => `${e.value} tiles`,
    },
    { label: 'Biggest margin', entry: records.biggestBlowout, format: (e) => formatMoney(e.value) },
  ];

  return (
    <ul className="divide-y divide-white/10 -my-2">
      {rows.map(({ label, entry, format }) => (
        <li key={label} className="py-2.5 flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-xs text-foreground/70 truncate">
              {entry?.name ?? '—'}
              {entry?.detail && CHAINS[entry.detail as ChainName] && (
                <span className="text-muted-foreground">
                  {' · '}{CHAINS[entry.detail as ChainName].displayName}
                </span>
              )}
              {entry?.at && (
                <span className="text-muted-foreground/70">{' · '}{formatDate(entry.at)}</span>
              )}
            </div>
          </div>
          <div className="text-sm font-semibold tabular-nums shrink-0">
            {entry ? format(entry) : '—'}
          </div>
        </li>
      ))}
    </ul>
  );
};
