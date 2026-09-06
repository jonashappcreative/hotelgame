// =============================================================================
// stats — the inference layer
// =============================================================================
// Nothing exotic. Wilson intervals for rates, bootstrap percentile intervals for
// continuous metrics, a paired t-style interval wherever common random numbers
// were used, and Benjamini–Hochberg to keep the false-discovery rate honest
// across a grid of hundreds of cells.
//
// The important discipline is not in this file: it is pre-registering the effect
// size that matters *before* running the sweep. Sweeping hundreds of cells with
// no such threshold is how twenty exciting results turn out to all be noise. The
// thresholds this study committed to are in sim/thresholds.ts.
// =============================================================================

export interface Interval { lo: number; hi: number }

export interface RateEstimate extends Interval {
  rate: number;
  successes: number;
  n: number;
}

export interface MeanEstimate extends Interval {
  mean: number;
  sd: number;
  n: number;
}

const Z_95 = 1.959963985;

/**
 * Wilson score interval. Preferred over the normal approximation because it
 * behaves at the extremes — a 0/200 win rate gets a real upper bound instead of
 * a zero-width interval that would claim certainty.
 */
export function wilson(successes: number, n: number, z = Z_95): RateEstimate {
  if (n === 0) return { rate: 0, successes, n, lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { rate: p, successes, n, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function sd(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) * (v - m);
  return Math.sqrt(acc / (n - 1));
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function percentile(values: number[], q: number): number {
  return quantile([...values].sort((a, b) => a - b), q);
}

/** Normal-theory interval on the mean. Used where n is comfortably large. */
export function meanInterval(values: number[], z = Z_95): MeanEstimate {
  const n = values.length;
  const m = mean(values);
  const s = sd(values);
  const half = n > 0 ? (z * s) / Math.sqrt(n) : 0;
  return { mean: m, sd: s, n, lo: m - half, hi: m + half };
}

/**
 * Bootstrap percentile interval. Used for metrics whose sampling distribution is
 * visibly skewed — game length, merger counts, the value ceiling of a card —
 * where the normal interval would understate the tail.
 */
export function bootstrapCI(
  values: number[],
  statistic: (sample: number[]) => number = mean,
  resamples = 2000,
  rand: () => number = Math.random,
): Interval & { point: number } {
  const n = values.length;
  const point = statistic(values);
  if (n < 2) return { point, lo: point, hi: point };

  const stats: number[] = new Array(resamples);
  const sample: number[] = new Array(n);
  for (let r = 0; r < resamples; r++) {
    for (let i = 0; i < n; i++) sample[i] = values[Math.floor(rand() * n)];
    stats[r] = statistic(sample);
  }
  stats.sort((a, b) => a - b);
  return { point, lo: quantile(stats, 0.025), hi: quantile(stats, 0.975) };
}

export interface PairedResult extends MeanEstimate {
  /** Two-sided p-value from the normal approximation to the paired t statistic. */
  p: number;
}

/**
 * Paired difference with its interval. `a` and `b` must be aligned: element i of
 * each is the same seed replayed under the two arms. That pairing is the whole
 * point — it cancels the tile-bag luck that otherwise swamps a $500 effect in a
 * $15k standard deviation.
 */
export function paired(a: number[], b: number[]): PairedResult {
  if (a.length !== b.length) throw new Error('paired(): arms are not aligned');
  const diffs = a.map((v, i) => v - b[i]);
  const est = meanInterval(diffs);
  const se = est.n > 0 ? est.sd / Math.sqrt(est.n) : 0;
  const t = se > 0 ? est.mean / se : 0;
  return { ...est, p: twoSidedNormalP(t) };
}

/** Abramowitz & Stegun 26.2.17 — plenty accurate for a screening p-value. */
export function twoSidedNormalP(z: number): number {
  const x = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989422804014327 * Math.exp(-(x * x) / 2);
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return Math.min(1, 2 * d * poly);
}

export interface FdrRow<T> { item: T; p: number }

/**
 * Benjamini–Hochberg. Returns each row with the threshold decision attached, so
 * a caller can report "significant at FDR q" rather than counting raw p < 0.05
 * across a grid where a twentieth of the cells fire by construction.
 */
export function benjaminiHochberg<T>(rows: FdrRow<T>[], q = 0.05): (FdrRow<T> & { significant: boolean; critical: number })[] {
  const m = rows.length;
  const indexed = rows.map((row, i) => ({ ...row, i })).sort((a, b) => a.p - b.p);
  let maxK = -1;
  for (let k = 0; k < m; k++) {
    if (indexed[k].p <= ((k + 1) / m) * q) maxK = k;
  }
  const out = indexed.map((row, k) => ({
    item: row.item,
    p: row.p,
    critical: ((k + 1) / m) * q,
    significant: k <= maxK,
    i: row.i,
  }));
  return out.sort((a, b) => a.i - b.i).map(({ i, ...rest }) => rest);
}

/** Do two intervals fail to overlap? The readable form of "these tiers separate". */
export function disjoint(a: Interval, b: Interval): boolean {
  return a.hi < b.lo || b.hi < a.lo;
}

export function fmtMoney(v: number): string {
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(v)).toLocaleString('en-US')}`;
}

export function fmtPct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}
