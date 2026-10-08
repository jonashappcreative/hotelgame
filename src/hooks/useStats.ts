// =============================================================================
// useStats — dashboard data, from the live API or the sample month (Epic 16)
// =============================================================================
// The dashboard has two data sources and one switch between them:
//
//   'live'   — GET the real aggregates from /api/stats (public, unauthenticated)
//   'sample' — a simulated month from src/data/sampleStats.ts
//
// Sample is the default. game_results starts empty and fills forward, so a
// first-time visitor to a freshly deployed dashboard would otherwise see eight
// empty panels and have no idea what the page is for. The source is persisted
// per browser, and sample mode is labelled on screen at all times — see the
// banner in Dashboard.tsx. Nothing about the sample source touches the network
// or the database.
// =============================================================================

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/integrations/api/client';
import { sampleLive, sampleOverview } from '@/data/sampleStats';
import type { LiveStats, StatsOverview } from '@/types/stats';

export type StatsSource = 'live' | 'sample';

const STORAGE_KEY = 'hotelgame_stats_source';
const LIVE_REFRESH_MS = 15_000;
const OVERVIEW_REFRESH_MS = 60_000;

function readStoredSource(): StatsSource {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'live' || stored === 'sample') return stored;
  } catch {
    // Private windows and blocked site data throw on access; the default is fine.
  }
  return 'sample';
}

/** The Sample/Live switch, remembered per browser. */
export function useStatsSource(): [StatsSource, (next: StatsSource) => void] {
  const [source, setSourceState] = useState<StatsSource>(readStoredSource);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, source); } catch { /* not worth failing over */ }
  }, [source]);

  const setSource = useCallback((next: StatsSource) => setSourceState(next), []);
  return [source, setSource];
}

/**
 * The "right now" strip. Reads game_rooms, so it has real numbers from day one
 * even when no game has been recorded yet.
 */
export function useLiveStats(source: StatsSource) {
  return useQuery<LiveStats>({
    queryKey: ['stats', 'live', source],
    queryFn: async () => {
      if (source === 'sample') return sampleLive();
      const { ok, data, error } = await apiFetch<LiveStats>('/stats', { op: 'live' });
      if (!ok || !data) throw new Error(error ?? 'Failed to load live stats');
      return data;
    },
    refetchInterval: LIVE_REFRESH_MS,
    refetchOnWindowFocus: true,
    // Sample mode re-rolls each interval on purpose, so never serve it stale.
    staleTime: source === 'sample' ? 0 : LIVE_REFRESH_MS / 2,
  });
}

/** Everything else, on the slow interval. */
export function useStatsOverview(source: StatsSource) {
  return useQuery<StatsOverview>({
    queryKey: ['stats', 'overview', source],
    queryFn: async () => {
      if (source === 'sample') return sampleOverview();
      const { ok, data, error } = await apiFetch<StatsOverview>('/stats', { op: 'overview' });
      if (!ok || !data) throw new Error(error ?? 'Failed to load statistics');
      return data;
    },
    refetchInterval: OVERVIEW_REFRESH_MS,
    refetchOnWindowFocus: true,
    staleTime: OVERVIEW_REFRESH_MS / 2,
  });
}
