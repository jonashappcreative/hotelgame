// =============================================================================
// Shared truth table for the Epic 18 end-game conditions.
// =============================================================================
// canDeclareGameEnd exists twice — once in the engine (server/lib/rules.ts) and
// once in the browser (src/utils/gameLogic.ts), because the server enforces it
// and the client has to decide whether to show the button. Two implementations
// of one rule drift, so both test suites run this same table:
//   server/lib/rules.test.ts   and   src/utils/gameLogic.test.ts
// =============================================================================

export type ChainKey =
  | 'sackson' | 'tower' | 'worldwide' | 'american' | 'festival' | 'continental' | 'imperial';

export const ALL_CHAIN_KEYS: ChainKey[] = [
  'sackson', 'tower', 'worldwide', 'american', 'festival', 'continental', 'imperial',
];

export interface EndConditionCase {
  name: string;
  /** Tiles per chain. A chain absent from this map is inactive. */
  sizes: Partial<Record<ChainKey, number>>;
  /** Chains flagged safe. Ignored by the rule when safeChainSize is null. */
  safe?: ChainKey[];
  boardRows: number;
  /** null when chainSafety is 'none' — the default, which makes no chain safe. */
  safeChainSize: number | null;
  canDeclare: boolean;
  reason: 'threshold' | 'all_safe' | null;
}

/** Build the `chains` record both engines read, from a case's sizes/safe lists. */
export const chainsForCase = (c: EndConditionCase) =>
  Object.fromEntries(ALL_CHAIN_KEYS.map((name) => {
    const size = c.sizes[name] ?? 0;
    return [name, {
      name,
      tiles: Array.from({ length: size }, (_, i) => `${name}-${i}`),
      isActive: size > 0,
      isSafe: size > 0 && (c.safe ?? []).includes(name),
    }];
  })) as Record<ChainKey, { name: string; tiles: string[]; isActive: boolean; isSafe: boolean }>;

export const END_CONDITION_CASES: EndConditionCase[] = [
  // The vacuous case. "Every active chain is safe" is trivially true of an
  // empty set, which without an explicit guard would let any player end the
  // game on turn one, before a single chain exists.
  {
    name: 'empty board — no chain has been founded',
    sizes: {}, boardRows: 9, safeChainSize: 11,
    canDeclare: false, reason: null,
  },
  {
    name: 'empty board with safety off',
    sizes: {}, boardRows: 9, safeChainSize: null,
    canDeclare: false, reason: null,
  },

  // Condition 1 — one chain at the end-game size.
  {
    name: 'a chain has reached 41 tiles',
    sizes: { tower: 41, american: 6 }, boardRows: 9, safeChainSize: null,
    canDeclare: true, reason: 'threshold',
  },
  {
    name: 'the biggest chain is one tile short of 41',
    sizes: { tower: 40, american: 6 }, boardRows: 9, safeChainSize: null,
    canDeclare: false, reason: null,
  },
  {
    name: 'a small board ends at 30, not 41',
    sizes: { tower: 30 }, boardRows: 6, safeChainSize: null,
    canDeclare: true, reason: 'threshold',
  },
  {
    name: '29 tiles on a small board is not enough',
    sizes: { tower: 29 }, boardRows: 6, safeChainSize: null,
    canDeclare: false, reason: null,
  },
  {
    name: '30 tiles on a standard board is not enough',
    sizes: { tower: 30 }, boardRows: 9, safeChainSize: null,
    canDeclare: false, reason: null,
  },

  // Condition 2 — every active chain safe.
  {
    name: 'every active chain is safe',
    sizes: { tower: 11, american: 14 }, safe: ['tower', 'american'],
    boardRows: 9, safeChainSize: 11,
    canDeclare: true, reason: 'all_safe',
  },
  {
    name: 'one active chain is still unsafe',
    sizes: { tower: 11, american: 14, festival: 5 }, safe: ['tower', 'american'],
    boardRows: 9, safeChainSize: 11,
    canDeclare: false, reason: null,
  },
  {
    name: 'a single safe chain is enough — there is nothing else on the board',
    sizes: { tower: 11 }, safe: ['tower'],
    boardRows: 9, safeChainSize: 11,
    canDeclare: true, reason: 'all_safe',
  },
  // The default room. chainSafety 'none' makes getSafeChainSize return null and
  // isSafe permanently false, so this route never opens — 41 tiles stays the
  // only way to end a game with today's defaults.
  {
    name: 'all-safe never fires when chain safety is off',
    sizes: { tower: 11, american: 14 }, safe: ['tower', 'american'],
    boardRows: 9, safeChainSize: null,
    canDeclare: false, reason: null,
  },

  // Both at once — the size threshold is the reason players will recognise.
  {
    name: 'both conditions met at once reports the threshold',
    sizes: { tower: 41, american: 14 }, safe: ['tower', 'american'],
    boardRows: 9, safeChainSize: 11,
    canDeclare: true, reason: 'threshold',
  },
];
