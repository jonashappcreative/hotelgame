import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES, type CustomRules } from './game';
import { describeRules, hasCustomRules } from './rules-describe';

const valueFor = (rules: CustomRules, key: keyof CustomRules) =>
  describeRules(rules).find((item) => item.key === key)?.value;

describe('describeRules', () => {
  it('describes every rule exactly once', () => {
    const items = describeRules(DEFAULT_RULES);
    const keys = items.map((item) => item.key);
    expect(keys).toHaveLength(Object.keys(DEFAULT_RULES).length - 1); // timer detail folds in
    expect(new Set(keys).size).toBe(keys.length);
  });

  // The bug this renderer exists to kill: three hardcoded copies all printed
  // "Safe at 11+" for a room where no chain was ever safe.
  it('describes the default room as Aggressive, never "Safe at 11+"', () => {
    const summary = describeRules(DEFAULT_RULES).map((item) => item.value).join(' | ');
    expect(summary).toContain('Aggressive — no safe chains');
    expect(summary).not.toContain('11+');
  });

  it('marks nothing as custom for a default room', () => {
    expect(describeRules(DEFAULT_RULES).every((item) => !item.isCustom)).toBe(true);
    expect(hasCustomRules(DEFAULT_RULES)).toBe(false);
  });

  it('marks only the changed rules as custom', () => {
    const rules: CustomRules = { ...DEFAULT_RULES, boardSize: 'small', chainSafety: '11' };
    const custom = describeRules(rules).filter((item) => item.isCustom).map((item) => item.key);
    expect(custom.sort()).toEqual(['boardSize', 'chainSafety']);
    expect(hasCustomRules(rules)).toBe(true);
  });

  it('reads selling as a single value', () => {
    expect(valueFor({ ...DEFAULT_RULES, stockSelling: 'off' }, 'stockSelling')).toBe('Off');
    expect(valueFor({ ...DEFAULT_RULES, stockSelling: '75' }, 'stockSelling'))
      .toBe('On — bank pays 75%');
  });

  it('folds the first-rounds exemption into the timer line', () => {
    expect(valueFor({ ...DEFAULT_RULES, turnTimer: 'off' }, 'turnTimer')).toBe('Off');
    expect(valueFor({ ...DEFAULT_RULES, turnTimer: '60' }, 'turnTimer'))
      .toBe('60s (not for 2 rounds)');
    expect(
      valueFor({ ...DEFAULT_RULES, turnTimer: '60', disableTimerFirstRounds: false }, 'turnTimer'),
    ).toBe('60s');
  });

  it('formats starting cash as money', () => {
    expect(valueFor({ ...DEFAULT_RULES, startingCash: '8000' }, 'startingCash')).toBe('$8,000');
  });

  it('names both board sizes', () => {
    expect(valueFor({ ...DEFAULT_RULES, boardSize: 'large' }, 'boardSize')).toBe('Standard 9×12');
    expect(valueFor({ ...DEFAULT_RULES, boardSize: 'small' }, 'boardSize')).toBe('Small 6×10');
  });
});
