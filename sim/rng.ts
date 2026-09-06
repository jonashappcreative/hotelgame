// =============================================================================
// rng — one seeded PRNG installed over Math.random for the whole sim process
// =============================================================================
// The engine (shuffle, discard reinsertion, auto_end_turn) and the bot (rnd,
// rndInt, the medium-difficulty coin flips) both reach for Math.random. Rather
// than threading a generator through two modules we do not want to modify, the
// simulator owns the global: install() replaces Math.random with a mulberry32
// stream, and reseed() restarts that stream from a known point.
//
// That makes a whole game a pure function of its seed, which is what common
// random numbers (see equity.ts) need: two arms of a counterfactual replay the
// identical luck, so the difference between them is the effect and nothing else.
// =============================================================================

let state = 0;
let installed = false;
const nativeRandom = Math.random;

/** mulberry32 — 32-bit state, fast, good enough for Monte-Carlo rollouts. */
function next(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Take over Math.random. Idempotent. */
export function install(): void {
  if (installed) return;
  Math.random = next;
  installed = true;
}

/** Hand Math.random back — only used by tests that need real entropy. */
export function uninstall(): void {
  if (!installed) return;
  Math.random = nativeRandom;
  installed = false;
}

/** Restart the stream. Every draw after this is a deterministic function of `seed`. */
export function reseed(seed: number): void {
  install();
  // Spread neighbouring seeds apart: raw mulberry32 states 1 and 2 produce
  // correlated first draws, which would defeat the point of a seed *sequence*.
  state = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) | 0;
  // Burn a few draws so the stream is well mixed before anything observes it.
  for (let i = 0; i < 8; i++) next();
}

/** A float in [0,1) from the installed stream. */
export function random(): number {
  return next();
}

/** An integer in [0, n). */
export function randInt(n: number): number {
  return Math.floor(next() * n);
}

/** Uniform pick. */
export function pick<T>(items: T[]): T {
  return items[randInt(items.length)];
}
