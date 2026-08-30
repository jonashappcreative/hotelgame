import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES, type CustomRules } from './game';
import {
  normalizeRules,
  validateRules,
  isLegacyRules,
  coerceBoardSizeCoupling,
  getSafeChainSize,
  getBoardDimensions,
  getEligibleChains,
  getBonusTier,
  getSellPriceFactor,
  getTurnTimerSeconds,
} from './rules-normalize';

/** A complete v1 blob, exactly as DEFAULT_RULES looked before Epic 15. */
const v1Defaults = () => ({
  startWithTileOnBoard: true,
  turnTimerEnabled: false,
  turnTimer: '60',
  disableTimerFirstRounds: true,
  chainSafetyEnabled: false,
  chainSafetyThreshold: 'none',
  cashVisibilityEnabled: false,
  cashVisibility: 'hidden',
  bonusTierEnabled: false,
  bonusTier: 'standard',
  boardSizeEnabled: false,
  boardSize: '9x12',
  chainFoundingEnabled: false,
  maxChains: '7',
  startingConditionsEnabled: false,
  startingCash: '6000',
  startingTiles: '6',
  stockSellingEnabled: false,
  sellPriceFactor: '75',
});

describe('isLegacyRules', () => {
  it('recognises a v1 blob by its *Enabled flags', () => {
    expect(isLegacyRules(v1Defaults())).toBe(true);
    expect(isLegacyRules({ chainSafetyEnabled: false })).toBe(true);
  });

  it('does not mistake a v2 blob for a legacy one', () => {
    expect(isLegacyRules(DEFAULT_RULES)).toBe(false);
    expect(isLegacyRules({})).toBe(false);
    expect(isLegacyRules(null)).toBe(false);
  });
});

describe('normalizeRules — v2 blobs', () => {
  it('passes a valid v2 blob through unchanged', () => {
    const rules: CustomRules = {
      ...DEFAULT_RULES,
      boardSize: 'small',
      stockSelling: '50',
      chainSafety: '13',
      turnTimer: '30',
      cashVisibility: 'aggregate',
      bonusTier: 'flat',
      maxChains: '5',
    };
    expect(normalizeRules(rules)).toEqual(rules);
  });

  it('falls back to the default for any unrecognised value', () => {
    const result = normalizeRules({ ...DEFAULT_RULES, chainSafety: '12', maxChains: '9' });
    expect(result.chainSafety).toBe(DEFAULT_RULES.chainSafety);
    expect(result.maxChains).toBe(DEFAULT_RULES.maxChains);
  });

  it('returns the defaults for null, a string, or an array', () => {
    for (const raw of [null, undefined, 'nope', 42, ['a']]) {
      expect(normalizeRules(raw)).toEqual(DEFAULT_RULES);
    }
  });
});

describe('normalizeRules — legacy v1 blobs map by behaviour, not by new defaults', () => {
  it('maps chain-safety-off to Aggressive, which is what v1 actually played', () => {
    // v1's getSafeChainSize returned null when the flag was off, even though
    // the lobby printed "Safe at 11+". 'none' reproduces the real behaviour.
    expect(normalizeRules(v1Defaults()).chainSafety).toBe('none');
    expect(getSafeChainSize(normalizeRules(v1Defaults()))).toBeNull();
  });

  it('maps chain-safety-on to its threshold', () => {
    const raw = { ...v1Defaults(), chainSafetyEnabled: true, chainSafetyThreshold: '13' };
    expect(normalizeRules(raw).chainSafety).toBe('13');
  });

  it("maps cash-visibility-off to 'hidden', NOT the new 'visible' default", () => {
    expect(normalizeRules(v1Defaults()).cashVisibility).toBe('hidden');
    expect(DEFAULT_RULES.cashVisibility).toBe('visible');
  });

  it('maps cash-visibility-on to its stored value', () => {
    const raw = { ...v1Defaults(), cashVisibilityEnabled: true, cashVisibility: 'aggregate' };
    expect(normalizeRules(raw).cashVisibility).toBe('aggregate');
  });

  it('collapses the stock-selling pair into one value', () => {
    expect(normalizeRules(v1Defaults()).stockSelling).toBe('off');
    expect(normalizeRules({
      ...v1Defaults(), stockSellingEnabled: true, sellPriceFactor: '50',
    }).stockSelling).toBe('50');
    // The factor is ignored entirely while the rule is off.
    expect(normalizeRules({
      ...v1Defaults(), stockSellingEnabled: false, sellPriceFactor: '100',
    }).stockSelling).toBe('off');
  });

  it('translates the board size and its coupled chain limit', () => {
    expect(normalizeRules(v1Defaults()).boardSize).toBe('large');
    expect(normalizeRules({
      ...v1Defaults(), boardSizeEnabled: true, boardSize: '6x10',
    }).boardSize).toBe('small');
    // boardSizeEnabled off always meant the standard board, whatever the value.
    expect(normalizeRules({
      ...v1Defaults(), boardSizeEnabled: false, boardSize: '6x10',
    }).boardSize).toBe('large');
  });

  it('maps chain-founding-off to 7 chains', () => {
    expect(normalizeRules(v1Defaults()).maxChains).toBe('7');
    expect(normalizeRules({
      ...v1Defaults(), chainFoundingEnabled: true, maxChains: '5',
    }).maxChains).toBe('5');
  });

  it("maps turn-timer-off to 'off' and keeps the seconds when on", () => {
    expect(normalizeRules(v1Defaults()).turnTimer).toBe('off');
    expect(normalizeRules({
      ...v1Defaults(), turnTimerEnabled: true, turnTimer: '30',
    }).turnTimer).toBe('30');
  });

  it('copies starting conditions verbatim — v1 read them unconditionally', () => {
    // startingConditionsEnabled only ever gated the UI; the engine always read
    // the values, so an off flag must not reset them to the defaults.
    const raw = {
      ...v1Defaults(),
      startingConditionsEnabled: false,
      startingCash: '8000',
      startingTiles: '5',
      startWithTileOnBoard: false,
    };
    const rules = normalizeRules(raw);
    expect(rules.startingCash).toBe('8000');
    expect(rules.startingTiles).toBe('5');
    expect(rules.startWithTileOnBoard).toBe(false);
  });

  it('produces a blob that plays identically to the v1 defaults', () => {
    const rules = normalizeRules(v1Defaults());
    expect(getSafeChainSize(rules)).toBeNull();
    expect(getSellPriceFactor(rules)).toBe(0);
    expect(getTurnTimerSeconds(rules)).toBeNull();
    expect(getBoardDimensions(rules)).toEqual({ boardRows: 9, boardColsCount: 12 });
    expect(getEligibleChains(rules)).toHaveLength(7);
    expect(getBonusTier(rules)).toBe('standard');
    expect(rules.cashVisibility).toBe('hidden');
  });
});

describe('validateRules', () => {
  it('accepts a full valid blob', () => {
    const result = validateRules({ ...DEFAULT_RULES, chainSafety: '11' });
    expect(result.ok).toBe(true);
    expect(result.rules.chainSafety).toBe('11');
  });

  it('fills missing fields from the defaults', () => {
    const result = validateRules({ boardSize: 'small' });
    expect(result.ok).toBe(true);
    expect(result.rules).toEqual({ ...DEFAULT_RULES, boardSize: 'small' });
  });

  it('treats null and undefined as "use the defaults"', () => {
    expect(validateRules(null)).toEqual({ ok: true, rules: DEFAULT_RULES, errors: [] });
    expect(validateRules(undefined).ok).toBe(true);
  });

  it('rejects an out-of-range value rather than letting it become NaN', () => {
    const result = validateRules({ ...DEFAULT_RULES, startingCash: '999999' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('startingCash');
  });

  it('rejects a value of the wrong type', () => {
    expect(validateRules({ maxChains: 7 }).ok).toBe(false);
    expect(validateRules({ startWithTileOnBoard: 'yes' }).ok).toBe(false);
    expect(validateRules('not an object').ok).toBe(false);
  });

  it('reports every bad field at once', () => {
    const result = validateRules({ chainSafety: '12', bonusTier: 'brutal', turnTimer: '45' });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it('ignores unknown keys instead of failing on them', () => {
    const result = validateRules({ ...DEFAULT_RULES, chainSafetyEnabled: true, nonsense: 1 });
    expect(result.ok).toBe(true);
    expect(result.rules).toEqual(DEFAULT_RULES);
  });
});

describe('rule getters', () => {
  it('getSafeChainSize returns null only for Aggressive', () => {
    expect(getSafeChainSize({ ...DEFAULT_RULES, chainSafety: 'none' })).toBeNull();
    for (const threshold of ['9', '11', '13', '15'] as const) {
      expect(getSafeChainSize({ ...DEFAULT_RULES, chainSafety: threshold })).toBe(Number(threshold));
    }
  });

  it("getSellPriceFactor returns 0 only for 'off'", () => {
    expect(getSellPriceFactor({ ...DEFAULT_RULES, stockSelling: 'off' })).toBe(0);
    expect(getSellPriceFactor({ ...DEFAULT_RULES, stockSelling: '100' })).toBe(1);
    expect(getSellPriceFactor({ ...DEFAULT_RULES, stockSelling: '75' })).toBe(0.75);
  });

  it('getBoardDimensions maps the two board sizes', () => {
    expect(getBoardDimensions({ ...DEFAULT_RULES, boardSize: 'large' }))
      .toEqual({ boardRows: 9, boardColsCount: 12 });
    expect(getBoardDimensions({ ...DEFAULT_RULES, boardSize: 'small' }))
      .toEqual({ boardRows: 6, boardColsCount: 10 });
  });

  it('getEligibleChains follows maxChains', () => {
    expect(getEligibleChains({ ...DEFAULT_RULES, maxChains: '5' })).toHaveLength(5);
    expect(getEligibleChains({ ...DEFAULT_RULES, maxChains: '6' })).toHaveLength(6);
    expect(getEligibleChains({ ...DEFAULT_RULES, maxChains: '7' })).toHaveLength(7);
  });
});

describe('coerceBoardSizeCoupling', () => {
  it('drops the default 7 chains to 5 on the small board', () => {
    const result = coerceBoardSizeCoupling({ ...DEFAULT_RULES, boardSize: 'small' });
    expect(result.maxChains).toBe('5');
  });

  it('leaves a deliberate 6 alone', () => {
    const rules: CustomRules = { ...DEFAULT_RULES, boardSize: 'small', maxChains: '6' };
    expect(coerceBoardSizeCoupling(rules).maxChains).toBe('6');
  });

  it('does nothing on the large board', () => {
    const rules: CustomRules = { ...DEFAULT_RULES, boardSize: 'large', maxChains: '7' };
    expect(coerceBoardSizeCoupling(rules)).toEqual(rules);
  });
});
