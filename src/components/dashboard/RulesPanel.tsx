import type { RuleDistribution } from '@/types/stats';
import { DEFAULT_RULES } from '@/types/game';
import { BarRow } from './BarRow';
import { RULE_LABELS, RULE_ORDER, formatNumber, formatPercent, formatRuleValue } from './format';

interface RulesPanelProps {
  rules: RuleDistribution;
  totalGames: number;
}

/**
 * Which house rules rooms actually play with.
 *
 * The point of this panel is the comparison against DEFAULT_RULES: Epic 15
 * changed the defaults (Aggressive chain safety, visible cash) on judgment
 * alone, with nothing to check it against. The default value of each rule is
 * marked with a tag rather than a colour, so the "did they keep it?" reading
 * survives greyscale, and so colour is never asked to carry two meanings at
 * once.
 */
export const RulesPanel = ({ rules, totalGames }: RulesPanelProps) => {
  const orderedKeys = [
    ...RULE_ORDER.filter((key) => rules[key]),
    ...Object.keys(rules).filter((key) => !RULE_ORDER.includes(key)),
  ];

  return (
    <div className="space-y-5">
      {orderedKeys.map((rule) => {
        const values = Object.entries(rules[rule]).sort((a, b) => b[1] - a[1]);
        const defaultValue = String((DEFAULT_RULES as unknown as Record<string, unknown>)[rule]);
        const max = Math.max(...values.map(([, count]) => count), 1);

        return (
          <div key={rule} className="space-y-2">
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
              {RULE_LABELS[rule] ?? rule}
            </h4>
            <div className="space-y-2">
              {values.map(([value, count]) => (
                <BarRow
                  key={value}
                  label={formatRuleValue(rule, value)}
                  fraction={count / max}
                  value={formatPercent(count / Math.max(totalGames, 1))}
                  title={`${formatNumber(count)} of ${formatNumber(totalGames)} games`}
                  tag={value === defaultValue ? (
                    <span className="text-[10px] px-1.5 py-px rounded border border-white/15 text-muted-foreground/80 shrink-0">
                      default
                    </span>
                  ) : undefined}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
