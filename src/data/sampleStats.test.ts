import { describe, it, expect } from 'vitest';
import { generateSampleGames, sampleOverview, sampleLive } from './sampleStats';
import { CHAINS } from '@/types/game';
import { DEFAULT_RULES } from '@/types/game';

// The sample month exists so the dashboard can be read before real games
// accumulate. Its only real obligation is internal consistency: if the activity
// chart and the games total disagree, a reviewer looking at the page learns the
// wrong thing about the layout. These tests hold the aggregation to the games
// it was derived from.
const NOW = new Date('2026-08-31T14:30:00');

describe('sampleStats', () => {
  it('generates roughly a month of games', () => {
    const games = generateSampleGames(NOW);
    expect(games.length).toBeGreaterThan(600);
    expect(games.length).toBeLessThan(2500);
  });

  it('is deterministic for a given moment', () => {
    expect(sampleOverview(NOW)).toEqual(sampleOverview(NOW));
  });

  it('the activity chart sums to the games total', () => {
    const overview = sampleOverview(NOW);
    const charted = overview.activity.reduce((sum, day) => sum + day.games, 0);
    expect(charted).toBe(overview.totals.gamesCompleted);
  });

  it('covers exactly 30 days ending today, in local time', () => {
    const overview = sampleOverview(NOW);
    expect(overview.activity).toHaveLength(30);
    // Local date, not toISOString(): west of UTC the ISO date is tomorrow's, and
    // east of it every evening game lands on the wrong day.
    expect(overview.activity.at(-1)!.day).toBe('2026-08-31');
    expect(overview.activity[0].day).toBe('2026-08-02');
  });

  it('rule distributions sum to the games total, and every default is represented', () => {
    const overview = sampleOverview(NOW);
    for (const [rule, values] of Object.entries(overview.rules)) {
      const total = Object.values(values).reduce((sum, n) => sum + n, 0);
      expect(total, `${rule} distribution`).toBe(overview.totals.gamesCompleted);

      const defaultValue = String((DEFAULT_RULES as unknown as Record<string, unknown>)[rule]);
      expect(Object.keys(values), `${rule} is missing its default`).toContain(defaultValue);
    }
  });

  it('covers every rule in DEFAULT_RULES, so the panel has no blank sections', () => {
    const overview = sampleOverview(NOW);
    expect(Object.keys(overview.rules).sort()).toEqual(Object.keys(DEFAULT_RULES).sort());
  });

  it('reports one entry per hotel chain', () => {
    const overview = sampleOverview(NOW);
    expect(overview.chains.map((c) => c.chain).sort())
      .toEqual(Object.keys(CHAINS).sort());
  });

  it('no chain is wildly over-represented as the largest', () => {
    // A biased shuffle (sort with a random comparator) made Sackson the largest
    // chain two and a half times as often as Tower. With a real Fisher-Yates the
    // seven chains land within a reasonable band of each other.
    const overview = sampleOverview(NOW);
    const shares = overview.chains.map((c) => c.timesLargest);
    expect(Math.max(...shares) / Math.min(...shares)).toBeLessThan(1.8);
  });

  it('economy buckets account for every game', () => {
    const overview = sampleOverview(NOW);
    const bucketed = overview.economy.buckets.reduce((sum, b) => sum + b.count, 0);
    expect(bucketed).toBe(overview.totals.gamesCompleted);
  });

  it('seat counts add up and bot difficulty tracks win rate', () => {
    const overview = sampleOverview(NOW);
    const seats = overview.bots.reduce((sum, s) => sum + s.seats, 0);
    const games = generateSampleGames(NOW);
    expect(seats).toBe(games.reduce((sum, g) => sum + g.seats.length, 0));

    const rate = (type: string) => overview.bots.find((b) => b.seatType === type)?.winRate ?? 0;
    expect(rate('hard')).toBeGreaterThan(rate('medium'));
    expect(rate('medium')).toBeGreaterThan(rate('easy'));
  });

  it('produces plausible game lengths rather than marathons', () => {
    const overview = sampleOverview(NOW);
    const minutes = (overview.totals.avgDurationSeconds ?? 0) / 60;
    expect(minutes).toBeGreaterThan(20);
    expect(minutes).toBeLessThan(90);
  });

  it('records are the real extremes of the generated month', () => {
    const games = generateSampleGames(NOW);
    const overview = sampleOverview(NOW);
    const best = Math.max(...games.flatMap((g) => g.seats.map((s) => s.finalTotal)));
    expect(overview.records.highestScore?.value).toBe(best);
    expect(overview.records.mostRounds?.value).toBe(Math.max(...games.map((g) => g.rounds)));
  });

  it('live numbers stay internally coherent as they re-roll', () => {
    for (const offset of [0, 15_000, 30_000, 45_000]) {
      const live = sampleLive(new Date(NOW.getTime() + offset));
      expect(live.gamesInProgress).toBeGreaterThanOrEqual(0);
      if (live.gamesInProgress > 0) {
        expect(live.playersInGame).toBeGreaterThanOrEqual(live.gamesInProgress * 2);
      }
    }
  });
});
