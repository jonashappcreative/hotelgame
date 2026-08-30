import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from './Dashboard';
import { apiFetch } from '@/integrations/api/client';

// ResponsiveContainer measures its parent, which is 0x0 in jsdom, so recharts
// renders nothing at all. Pinning a size lets the charts mount for real instead
// of being mocked away.
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) => (
      <actual.ResponsiveContainer width={640} height={200}>{children}</actual.ResponsiveContainer>
    ),
  };
});

vi.mock('@/integrations/api/client', () => ({ apiFetch: vi.fn() }));

const renderDashboard = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Dashboard /></MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  localStorage.clear();
  vi.mocked(apiFetch).mockReset();
});

afterEach(() => vi.useRealTimers());

describe('Dashboard', () => {
  it('opens on sample data and says so unmissably', async () => {
    renderDashboard();
    expect(await screen.findByText(/Showing sample data/i)).toBeInTheDocument();
    expect(screen.getByText(/None of these games happened/i)).toBeInTheDocument();
    // Sample mode must never touch the network.
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('renders every panel from the sample month', async () => {
    renderDashboard();
    for (const title of [
      'Games per day', 'House rules', 'Hotel chains',
      'Humans vs bots', 'What it takes to win', 'Records',
    ]) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText('Games played')).toBeInTheDocument();
    expect(screen.getByText('Games in progress')).toBeInTheDocument();
  });

  it('marks the current default of each rule', async () => {
    renderDashboard();
    await screen.findByText('House rules');
    // chainSafety defaults to 'none' since Epic 15 — the panel has to show that
    // it is the default, which is the whole reason the panel exists.
    const aggressive = screen.getByText(/Aggressive \(none safe\)/);
    expect(within(aggressive.closest('div')!).getByText('default')).toBeInTheDocument();
  });

  it('switches to live data and calls the public endpoint', async () => {
    vi.mocked(apiFetch).mockImplementation(async (_path, body: any) => {
      if (body?.op === 'live') {
        return { ok: true, error: null, data: { gamesInProgress: 2, roomsWaiting: 1, playersInGame: 7, longestRunningMinutes: 12 } };
      }
      return {
        ok: true, error: null,
        data: {
          totals: { gamesCompleted: 0, gamesToday: 0, games7d: 0, games30d: 0, avgDurationSeconds: null, avgRounds: null, avgPlayerCount: null, avgMergers: null },
          rules: {}, chains: [], bots: [], activity: [],
          economy: { avgWinningTotal: null, maxWinningTotal: null, minWinningTotal: null, avgSpread: null, buckets: [] },
          records: { highestScore: null, longestGame: null, mostRounds: null, largestChain: null, biggestBlowout: null },
          meta: { countingSince: null, generatedAt: '2026-08-31T12:00:00Z' },
        },
      };
    });

    renderDashboard();
    await screen.findByText(/Showing sample data/i);
    fireEvent.click(screen.getByRole('radio', { name: /live/i }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/stats', { op: 'overview' }));
    expect(screen.queryByText(/Showing sample data/i)).not.toBeInTheDocument();
  });

  it('explains an empty live dashboard instead of showing zeroes everywhere', async () => {
    localStorage.setItem('hotelgame_stats_source', 'live');
    vi.mocked(apiFetch).mockImplementation(async (_path, body: any) => ({
      ok: true, error: null,
      data: body?.op === 'live'
        ? { gamesInProgress: 0, roomsWaiting: 0, playersInGame: 0, longestRunningMinutes: null }
        : {
            totals: { gamesCompleted: 0, gamesToday: 0, games7d: 0, games30d: 0, avgDurationSeconds: null, avgRounds: null, avgPlayerCount: null, avgMergers: null },
            rules: {}, chains: [], bots: [], activity: [],
            economy: { avgWinningTotal: null, maxWinningTotal: null, minWinningTotal: null, avgSpread: null, buckets: [] },
            records: { highestScore: null, longestGame: null, mostRounds: null, largestChain: null, biggestBlowout: null },
            meta: { countingSince: null, generatedAt: '2026-08-31T12:00:00Z' },
          },
    }));

    renderDashboard();
    expect(await screen.findByText(/Nothing recorded yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no history to fill in/i)).toBeInTheDocument();
    // The live strip still works — it reads game_rooms, not the results tables.
    expect(screen.getByText('Games in progress')).toBeInTheDocument();
  });

  it('remembers the chosen source across visits', async () => {
    const { unmount } = renderDashboard();
    await screen.findByText(/Showing sample data/i);
    fireEvent.click(screen.getByRole('radio', { name: /live/i }));
    await waitFor(() => expect(localStorage.getItem('hotelgame_stats_source')).toBe('live'));
    unmount();

    vi.mocked(apiFetch).mockResolvedValue({ ok: false, error: 'Network error', data: null });
    renderDashboard();
    await waitFor(() =>
      expect(screen.queryByText(/Showing sample data/i)).not.toBeInTheDocument());
  });

  it('offers a retry when the live endpoint fails', async () => {
    localStorage.setItem('hotelgame_stats_source', 'live');
    vi.mocked(apiFetch).mockResolvedValue({ ok: false, error: 'Network error', data: null });
    renderDashboard();
    expect(await screen.findByText(/Could not load statistics/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('is view-only — nothing on the page mutates a game', async () => {
    renderDashboard();
    await screen.findByText('House rules');
    const labels = screen.getAllByRole('button').map((b) => b.textContent?.toLowerCase() ?? '');
    for (const label of labels) {
      expect(label).not.toMatch(/join|start|create|delete|end game|kick/);
    }
  });
});
