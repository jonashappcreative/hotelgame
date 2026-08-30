// =============================================================================
// /dashboard — public, view-only statistics for the game (Epic 16)
// =============================================================================
// Read-only by construction: nothing on this page mutates anything, there is no
// room to join and no game to affect. It needs no account, and the API behind
// it (server/api/stats.ts) returns aggregates only.
//
// Two data sources, switched by the control in the header:
//   Sample — a simulated month from src/data/sampleStats.ts, labelled on screen
//   Live   — the real aggregates, which start empty and fill forward
// =============================================================================

import { useNavigate } from 'react-router-dom';
import {
  Activity, ArrowLeft, Bot, Building2, Coins, Loader2, Radio, Settings2, Trophy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SiteFooter } from '@/components/SiteFooter';
import { PANEL_MINIMUMS } from '@/types/stats';
import { useLiveStats, useStatsOverview, useStatsSource, type StatsSource } from '@/hooks/useStats';
import { PanelCard } from '@/components/dashboard/PanelCard';
import { StatTile } from '@/components/dashboard/StatTile';
import { ActivityChart } from '@/components/dashboard/ActivityChart';
import { RulesPanel } from '@/components/dashboard/RulesPanel';
import { ChainsPanel } from '@/components/dashboard/ChainsPanel';
import { BotsPanel } from '@/components/dashboard/BotsPanel';
import { EconomyPanel } from '@/components/dashboard/EconomyPanel';
import { RecordsPanel } from '@/components/dashboard/RecordsPanel';
import {
  formatDate, formatDuration, formatMoneyShort, formatNumber,
} from '@/components/dashboard/format';
import { cn } from '@/lib/utils';

/** Segmented Sample / Live switch. */
const SourceToggle = ({
  source, onChange,
}: { source: StatsSource; onChange: (next: StatsSource) => void }) => (
  <div
    role="radiogroup"
    aria-label="Statistics data source"
    className="inline-flex rounded-lg border border-white/15 bg-card/50 p-0.5"
  >
    {(['sample', 'live'] as const).map((option) => (
      <button
        key={option}
        role="radio"
        aria-checked={source === option}
        onClick={() => onChange(option)}
        className={cn(
          'px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize',
          source === option
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {option}
      </button>
    ))}
  </div>
);

const Dashboard = () => {
  const navigate = useNavigate();
  const [source, setSource] = useStatsSource();

  const live = useLiveStats(source);
  const overview = useStatsOverview(source);

  const totals = overview.data?.totals;
  const recorded = totals?.gamesCompleted ?? 0;
  const isSample = source === 'sample';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 p-4">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="Back to start">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="mr-auto">
              <h1 className="text-2xl font-bold">Statistics</h1>
              <p className="text-sm text-muted-foreground">
                How the game is being played
              </p>
            </div>
            <SourceToggle source={source} onChange={setSource} />
          </div>

          {/* Sample data is always labelled. A dashboard that quietly shows made-up
              numbers is worse than one that shows none. */}
          {isSample && (
            <div className="rounded-xl border border-[hsl(var(--chart-2))]/40 bg-[hsl(var(--chart-2))]/10 px-4 py-3">
              <p className="text-sm font-medium">Showing sample data</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                A simulated month of play, generated in your browser so the dashboard can be
                read and reviewed before real games accumulate. None of these games happened.
                Switch to <span className="text-foreground/90">Live</span> for real numbers.
              </p>
            </div>
          )}

          {/* ---- Right now -------------------------------------------------- */}
          <section className="space-y-2">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Radio className={cn('w-3.5 h-3.5', live.isFetching && 'animate-pulse text-primary')} />
              Right now
              <span className="text-muted-foreground/60 normal-case tracking-normal font-normal">
                · refreshes every 15s
              </span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatTile accent value={live.data?.gamesInProgress ?? '—'} label="Games in progress" />
              <StatTile accent value={live.data?.playersInGame ?? '—'} label="Players at the board" />
              <StatTile accent value={live.data?.roomsWaiting ?? '—'} label="Rooms in the lobby" />
              <StatTile
                accent
                value={live.data?.longestRunningMinutes != null ? `${live.data.longestRunningMinutes}m` : '—'}
                label="Longest running"
              />
            </div>
          </section>

          {/* ---- Loading / error / empty ------------------------------------ */}
          {overview.isLoading && (
            <div className="py-16 flex justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          )}

          {overview.isError && (
            <Card className="bg-card/40 border-white/10">
              <CardContent className="py-10 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  Could not load statistics.
                </p>
                <Button variant="outline" size="sm" onClick={() => overview.refetch()}>
                  Try again
                </Button>
              </CardContent>
            </Card>
          )}

          {overview.data && recorded === 0 && (
            <Card className="bg-card/40 border-white/10">
              <CardHeader>
                <CardTitle className="text-base">Nothing recorded yet</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>
                  Completed games appear here within seconds of the final score. No games
                  were recorded before this dashboard existed, so there is no history to
                  fill in — it starts counting from the day it went live.
                </p>
                <Button variant="outline" size="sm" onClick={() => setSource('sample')}>
                  Preview with sample data
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ---- All time --------------------------------------------------- */}
          {overview.data && recorded > 0 && (
            <>
              <section className="space-y-2">
                <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  All time
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <StatTile value={formatNumber(totals!.gamesCompleted)} label="Games played" />
                  <StatTile value={formatNumber(totals!.gamesToday)} label="Finished today" />
                  <StatTile value={formatDuration(totals!.avgDurationSeconds)} label="Average length" />
                  <StatTile value={totals!.avgRounds ?? '—'} label="Average rounds" />
                  <StatTile
                    value={totals!.avgPlayerCount ?? '—'}
                    label="Average players"
                    hint={`${totals!.avgMergers ?? '—'} mergers per game`}
                  />
                </div>
              </section>

              <PanelCard
                title="Games per day"
                subtitle="Completed games over the last 30 days"
                icon={<Activity className="w-4 h-4 text-muted-foreground" />}
                sample={recorded}
                minimum={PANEL_MINIMUMS.activity}
              >
                <ActivityChart data={overview.data.activity} />
              </PanelCard>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <PanelCard
                  title="House rules"
                  subtitle="What rooms are actually configured with"
                  icon={<Settings2 className="w-4 h-4 text-muted-foreground" />}
                  sample={recorded}
                  minimum={PANEL_MINIMUMS.rules}
                >
                  <RulesPanel rules={overview.data.rules} totalGames={recorded} />
                </PanelCard>

                <div className="space-y-4">
                  <PanelCard
                    title="Hotel chains"
                    subtitle="How often each chain ends the game as the largest"
                    icon={<Building2 className="w-4 h-4 text-muted-foreground" />}
                    sample={recorded}
                    minimum={PANEL_MINIMUMS.chains}
                  >
                    <ChainsPanel chains={overview.data.chains} totalGames={recorded} />
                  </PanelCard>

                  <PanelCard
                    title="Humans vs bots"
                    subtitle="Win rate by who is sitting in the seat"
                    icon={<Bot className="w-4 h-4 text-muted-foreground" />}
                    sample={recorded}
                    minimum={PANEL_MINIMUMS.bots}
                  >
                    <BotsPanel bots={overview.data.bots} />
                  </PanelCard>

                  <PanelCard
                    title="What it takes to win"
                    subtitle="Final net worth of the winner, in $10k bands"
                    icon={<Coins className="w-4 h-4 text-muted-foreground" />}
                    sample={recorded}
                    minimum={PANEL_MINIMUMS.economy}
                  >
                    <EconomyPanel economy={overview.data.economy} />
                  </PanelCard>

                  <PanelCard
                    title="Records"
                    subtitle="The extremes of every game recorded"
                    icon={<Trophy className="w-4 h-4 text-muted-foreground" />}
                    sample={recorded}
                    minimum={PANEL_MINIMUMS.records}
                  >
                    <RecordsPanel records={overview.data.records} />
                  </PanelCard>
                </div>
              </div>

              <p className="text-xs text-muted-foreground/70 text-center pb-2">
                {isSample ? 'Sample data' : 'Counting since'}{' '}
                {!isSample && formatDate(overview.data.meta.countingSince)}
                {isSample && '— not real games'}
                {' · '}
                {formatNumber(recorded)} games ·{' '}
                {formatMoneyShort(overview.data.economy.avgWinningTotal)} average win
              </p>
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
};

export default Dashboard;
