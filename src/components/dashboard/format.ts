// Shared formatters for the statistics dashboard (Epic 16).

/** 1234567 -> "1,234,567". */
export const formatNumber = (n: number): string => n.toLocaleString('en-US');

/** 39284 -> "$39,284". Net worth is always whole dollars in this game. */
export const formatMoney = (n: number | null): string =>
  n === null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`;

/** Compact money for tight tiles: 39284 -> "$39.3k". */
export const formatMoneyShort = (n: number | null): string => {
  if (n === null) return '—';
  if (Math.abs(n) < 1000) return `$${Math.round(n)}`;
  return `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
};

/** 3599 -> "1h 00m", 2705 -> "45m". */
export const formatDuration = (seconds: number | null): string => {
  if (seconds === null) return '—';
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
};

/** 0.3042 -> "30%". */
export const formatPercent = (fraction: number, digits = 0): string =>
  `${(fraction * 100).toFixed(digits)}%`;

/** "2026-08-14" -> "14 Aug". */
export const formatDayShort = (isoDay: string): string => {
  const [y, m, d] = isoDay.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/** Full timestamp -> "14 Aug 2026". */
export const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * Human labels for raw rule values. The rules JSONB stores the wire value
 * ('none', 'true', '6000'), which is not what a player calls it.
 */
const RULE_VALUE_LABELS: Record<string, Record<string, string>> = {
  boardSize:               { large: 'Large (9×12)', small: 'Small (6×10)' },
  stockSelling:            { off: 'Off', '100': 'Full price', '90': '90% of price', '75': '75% of price', '50': '50% of price' },
  chainSafety:             { none: 'Aggressive (none safe)', '9': 'Safe at 9+', '11': 'Safe at 11+', '13': 'Safe at 13+', '15': 'Safe at 15+' },
  turnTimer:               { off: 'Off', '30': '30 seconds', '60': '60 seconds', '90': '90 seconds' },
  disableTimerFirstRounds: { true: 'Timer off early', false: 'Timer from turn 1' },
  cashVisibility:          { visible: 'Visible', hidden: 'Hidden', aggregate: 'Total only' },
  bonusTier:               { standard: 'Standard', flat: 'Flat split', aggressive: 'Aggressive' },
  maxChains:               { '5': '5 chains', '6': '6 chains', '7': '7 chains' },
  startingCash:            { '4000': '$4,000', '6000': '$6,000', '8000': '$8,000' },
  startingTiles:           { '5': '5 tiles', '6': '6 tiles', '7': '7 tiles' },
  startWithTileOnBoard:    { true: 'One tile pre-placed', false: 'Empty board' },
};

export const RULE_LABELS: Record<string, string> = {
  boardSize: 'Board size',
  stockSelling: 'Selling shares',
  chainSafety: 'Chain safety',
  turnTimer: 'Turn timer',
  disableTimerFirstRounds: 'Timer grace period',
  cashVisibility: 'Cash visibility',
  bonusTier: 'Bonus payouts',
  maxChains: 'Chains in play',
  startingCash: 'Starting cash',
  startingTiles: 'Starting tiles',
  startWithTileOnBoard: 'Opening tile',
};

/** Order the rules panel Basic-first, matching the lobby's own split. */
export const RULE_ORDER = [
  'boardSize', 'chainSafety', 'stockSelling',
  'bonusTier', 'cashVisibility', 'turnTimer', 'disableTimerFirstRounds',
  'maxChains', 'startingCash', 'startingTiles', 'startWithTileOnBoard',
];

export const formatRuleValue = (rule: string, value: string): string =>
  RULE_VALUE_LABELS[rule]?.[value] ?? value;

export const SEAT_TYPE_LABELS: Record<string, string> = {
  human: 'Human', hard: 'Bot — Hard', medium: 'Bot — Medium', easy: 'Bot — Easy',
};
