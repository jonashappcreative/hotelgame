// =============================================================================
// rules-normalize — the only place a rules blob is turned into CustomRules
// =============================================================================
// game_rooms.custom_rules and game_states.rules_snapshot are schemaless JSONB,
// so the database still holds v1 blobs written before Epic 15. Rather than
// migrating them, every read goes through normalizeRules().
//
// The translation maps by *observed v1 behaviour*, not by the new v2 defaults,
// so a game started before the deploy keeps playing exactly as it did. Two
// asymmetries are deliberate:
//   * legacy chain-safety-off maps to 'none' — v1 returned null (no safe
//     chains) whether the flag was off or the threshold was 'none';
//   * legacy cash-visibility-off maps to 'hidden' — v1's default, not v2's.
//
// This module is imported by the browser (src/) and by the backend
// (server/lib/rules.ts re-exports it), so it must stay dependency-free.
// =============================================================================

import {
  CustomRules,
  DEFAULT_RULES,
  ChainName,
  ELIGIBLE_CHAINS_5,
  ELIGIBLE_CHAINS_6,
  ELIGIBLE_CHAINS_7,
} from './game';

// -----------------------------------------------------------------------------
// Allowlists — one per field, and the only definition of "a legal value"
// -----------------------------------------------------------------------------
export const RULE_VALUES = {
  boardSize: ['large', 'small'],
  stockSelling: ['off', '100', '90', '75', '50'],
  chainSafety: ['none', '9', '11', '13', '15'],
  turnTimer: ['off', '30', '60', '90'],
  cashVisibility: ['visible', 'hidden', 'aggregate'],
  bonusTier: ['standard', 'flat', 'aggressive'],
  maxChains: ['5', '6', '7'],
  startingCash: ['4000', '6000', '8000'],
  startingTiles: ['5', '6', '7'],
} as const;

export const BOOLEAN_RULES = ['disableTimerFirstRounds', 'startWithTileOnBoard'] as const;

type EnumRuleKey = keyof typeof RULE_VALUES;

/** v1 blobs are identified by the boolean layer v2 deleted. */
const V1_FLAGS = [
  'turnTimerEnabled', 'chainSafetyEnabled', 'cashVisibilityEnabled', 'bonusTierEnabled',
  'boardSizeEnabled', 'chainFoundingEnabled', 'startingConditionsEnabled', 'stockSellingEnabled',
] as const;

function pick<K extends EnumRuleKey>(key: K, value: unknown): CustomRules[K] | null {
  const allowed = RULE_VALUES[key] as readonly string[];
  return typeof value === 'string' && allowed.includes(value)
    ? (value as CustomRules[K])
    : null;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

export function isLegacyRules(raw: unknown): boolean {
  return isRecord(raw) && V1_FLAGS.some((flag) => flag in raw);
}

// -----------------------------------------------------------------------------
// normalizeRules — lenient: anything unrecognised falls back to DEFAULT_RULES
// -----------------------------------------------------------------------------
export function normalizeRules(raw: unknown): CustomRules {
  if (!isRecord(raw)) return { ...DEFAULT_RULES };
  return isLegacyRules(raw) ? fromV1(raw) : fromV2(raw);
}

function fromV2(raw: Record<string, unknown>): CustomRules {
  const out = { ...DEFAULT_RULES };
  for (const key of Object.keys(RULE_VALUES) as EnumRuleKey[]) {
    const value = pick(key, raw[key]);
    if (value !== null) (out as Record<string, unknown>)[key] = value;
  }
  for (const key of BOOLEAN_RULES) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key] as boolean;
  }
  return out;
}

function fromV1(raw: Record<string, unknown>): CustomRules {
  const on = (flag: (typeof V1_FLAGS)[number]) => raw[flag] === true;

  return {
    // '9x12' | '6x10' → 'large' | 'small'; the flag off always meant 9x12.
    boardSize: on('boardSizeEnabled') && raw.boardSize === '6x10' ? 'small' : 'large',
    // Two v1 fields collapse into one: the factor is the value, 'off' the switch.
    stockSelling: on('stockSellingEnabled')
      ? (pick('stockSelling', raw.sellPriceFactor) ?? '75')
      : 'off',
    // v1 returned null (no safe chains) both when the flag was off and when the
    // threshold was 'none' — 'none' reproduces both.
    chainSafety: on('chainSafetyEnabled')
      ? (pick('chainSafety', raw.chainSafetyThreshold) ?? 'none')
      : 'none',
    turnTimer: on('turnTimerEnabled') ? (pick('turnTimer', raw.turnTimer) ?? '60') : 'off',
    disableTimerFirstRounds:
      typeof raw.disableTimerFirstRounds === 'boolean' ? raw.disableTimerFirstRounds : true,
    // NOT the new 'visible' default — v1 with the flag off played hidden.
    cashVisibility: on('cashVisibilityEnabled')
      ? (pick('cashVisibility', raw.cashVisibility) ?? 'hidden')
      : 'hidden',
    bonusTier: on('bonusTierEnabled') ? (pick('bonusTier', raw.bonusTier) ?? 'standard') : 'standard',
    maxChains: on('chainFoundingEnabled') ? (pick('maxChains', raw.maxChains) ?? '7') : '7',
    // Starting conditions were read unconditionally in v1 — the flag only ever
    // gated the UI — so these copy across verbatim.
    startingCash: pick('startingCash', raw.startingCash) ?? DEFAULT_RULES.startingCash,
    startingTiles: pick('startingTiles', raw.startingTiles) ?? DEFAULT_RULES.startingTiles,
    startWithTileOnBoard:
      typeof raw.startWithTileOnBoard === 'boolean'
        ? raw.startWithTileOnBoard
        : DEFAULT_RULES.startWithTileOnBoard,
  };
}

// -----------------------------------------------------------------------------
// validateRules — strict: called at the two write boundaries (create / update)
// -----------------------------------------------------------------------------
// Missing fields take their default; a *present* field with an illegal value is
// an error, so a typo becomes a 400 rather than a NaN deep in the engine.
// A flat shape rather than a discriminated union: the backend compiles with
// `strictNullChecks: false`, which switches off narrowing on boolean
// discriminants, so `if (!result.ok)` would not reveal `errors` there.
export interface ValidationResult {
  ok: boolean;
  /** Defaults with every valid field applied. Only meaningful when ok. */
  rules: CustomRules;
  /** One message per rejected field; empty when ok. */
  errors: string[];
}

export function validateRules(raw: unknown): ValidationResult {
  if (raw === null || raw === undefined) {
    return { ok: true, rules: { ...DEFAULT_RULES }, errors: [] };
  }
  if (!isRecord(raw)) {
    return { ok: false, rules: { ...DEFAULT_RULES }, errors: ['customRules must be an object'] };
  }

  const errors: string[] = [];
  const rules = { ...DEFAULT_RULES };

  for (const key of Object.keys(RULE_VALUES) as EnumRuleKey[]) {
    if (!(key in raw) || raw[key] === undefined) continue;
    const value = pick(key, raw[key]);
    if (value === null) {
      errors.push(`${key}: expected one of ${RULE_VALUES[key].join(', ')}`);
      continue;
    }
    (rules as Record<string, unknown>)[key] = value;
  }

  for (const key of BOOLEAN_RULES) {
    if (!(key in raw) || raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') {
      errors.push(`${key}: expected a boolean`);
      continue;
    }
    rules[key] = raw[key] as boolean;
  }

  return { ok: errors.length === 0, rules, errors };
}

// -----------------------------------------------------------------------------
// Rule getters — the derived values both engines read
// -----------------------------------------------------------------------------

/** Tiles at which a chain becomes safe, or null when no chain is ever safe. */
export function getSafeChainSize(rules: CustomRules): number | null {
  return rules.chainSafety === 'none' ? null : parseInt(rules.chainSafety, 10);
}

export function getBoardDimensions(rules: CustomRules): { boardRows: number; boardColsCount: number } {
  return rules.boardSize === 'small'
    ? { boardRows: 6, boardColsCount: 10 }
    : { boardRows: 9, boardColsCount: 12 };
}

export function getMaxChains(rules: CustomRules): number {
  return parseInt(rules.maxChains, 10);
}

export function getEligibleChains(rules: CustomRules): ChainName[] {
  const max = getMaxChains(rules);
  return max === 5 ? ELIGIBLE_CHAINS_5 : max === 6 ? ELIGIBLE_CHAINS_6 : ELIGIBLE_CHAINS_7;
}

export function getBonusTier(rules: CustomRules): 'standard' | 'flat' | 'aggressive' {
  return rules.bonusTier;
}

/**
 * Fraction of market price the bank pays for a share back. 0 means the Stock
 * Selling rule is off — the only value that disables selling. A factor of 1
 * ("Full Value") is a legitimate, spread-free setting.
 */
export function getSellPriceFactor(rules: CustomRules): number {
  return rules.stockSelling === 'off' ? 0 : parseInt(rules.stockSelling, 10) / 100;
}

/** Seconds allowed per turn, or null when the turn timer is off. */
export function getTurnTimerSeconds(rules: CustomRules): number | null {
  return rules.turnTimer === 'off' ? null : parseInt(rules.turnTimer, 10);
}

/**
 * The small board has no room for the full seven chains, so choosing it drops
 * Max Chains from the default 7 to 5. A host who deliberately picked 6 keeps
 * it. Applied in exactly two places: the rules form on change, and game start.
 */
export function coerceBoardSizeCoupling(rules: CustomRules): CustomRules {
  if (rules.boardSize === 'small' && rules.maxChains === '7') {
    return { ...rules, maxChains: '5' };
  }
  return rules;
}
