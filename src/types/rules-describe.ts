// =============================================================================
// rules-describe — the one renderer for "what rules is this room playing?"
// =============================================================================
// Before Epic 15 three screens each hardcoded their own summary, and all three
// printed "Safe at 11+" for a room that had no safe chains at all. Everything
// here is derived from the rules blob, so a default room describes itself
// honestly and a new rule only has to be described once.
// =============================================================================

import { CustomRules, DEFAULT_RULES } from './game';

export interface RuleSummaryItem {
  /** Stable key for React lists. */
  key: keyof CustomRules;
  icon: string;
  label: string;
  value: string;
  /** False when the rule sits at its default — lets callers dim the routine. */
  isCustom: boolean;
}

const BOARD_SIZE: Record<CustomRules['boardSize'], string> = {
  large: 'Standard 9×12',
  small: 'Small 6×10',
};

const CHAIN_SAFETY: Record<CustomRules['chainSafety'], string> = {
  none: 'Aggressive — no safe chains',
  '9': 'Safe at 9+',
  '11': 'Safe at 11+',
  '13': 'Fortress — safe at 13+',
  '15': 'Safe at 15+',
};

const CASH_VISIBILITY: Record<CustomRules['cashVisibility'], string> = {
  visible: 'Visible to all',
  hidden: 'Hidden',
  aggregate: 'Aggregate total only',
};

const BONUS_TIER: Record<CustomRules['bonusTier'], string> = {
  standard: 'Standard 10x / 5x',
  flat: 'Flat — equal payout',
  aggressive: 'Aggressive 15x / 5x',
};

export function describeRules(rules: CustomRules): RuleSummaryItem[] {
  const item = (
    key: keyof CustomRules,
    icon: string,
    label: string,
    value: string,
  ): RuleSummaryItem => ({ key, icon, label, value, isCustom: rules[key] !== DEFAULT_RULES[key] });

  const items: RuleSummaryItem[] = [
    item('boardSize', '📐', 'Board', BOARD_SIZE[rules.boardSize]),
    item(
      'stockSelling',
      '💱',
      'Selling',
      rules.stockSelling === 'off' ? 'Off' : `On — bank pays ${rules.stockSelling}%`,
    ),
    item('chainSafety', '🛡', 'Chain safety', CHAIN_SAFETY[rules.chainSafety]),
    item(
      'turnTimer',
      '⏱',
      'Turn timer',
      rules.turnTimer === 'off'
        ? 'Off'
        : `${rules.turnTimer}s${rules.disableTimerFirstRounds ? ' (not for 2 rounds)' : ''}`,
    ),
    item('cashVisibility', '👁', 'Cash', CASH_VISIBILITY[rules.cashVisibility]),
    item('bonusTier', '🏆', 'Bonuses', BONUS_TIER[rules.bonusTier]),
    item('maxChains', '🔗', 'Max chains', rules.maxChains),
    item(
      'startingCash',
      '💵',
      'Starting cash',
      `$${Number(rules.startingCash).toLocaleString('en-US')}`,
    ),
    item('startingTiles', '🀫', 'Starting tiles', rules.startingTiles),
    item(
      'startWithTileOnBoard',
      '🎬',
      'Opening tile',
      rules.startWithTileOnBoard ? 'One tile pre-placed' : 'Board starts empty',
    ),
  ];

  return items;
}

/** True when anything differs from the shipped defaults. */
export function hasCustomRules(rules: CustomRules): boolean {
  return (Object.keys(DEFAULT_RULES) as (keyof CustomRules)[]).some(
    (key) => rules[key] !== DEFAULT_RULES[key],
  );
}
