import { DollarSign, Eye, Grid3X3, Link, PlayCircle, Timer, Trophy } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { CustomRules } from '@/types/game';
import { Row, SelectRow } from './rule-controls';

interface AdvancedRulesProps {
  rules: CustomRules;
  onPatch: (updates: Partial<CustomRules>) => void;
}

/**
 * The eight rules behind the Advanced disclosure — the knobs that matter to a
 * group that already knows how the game plays. Kept out of RulesForm so the
 * Basic three stay the first thing anyone reads.
 */
export const AdvancedRules = ({ rules, onPatch: patch }: AdvancedRulesProps) => {
  const sellingOn = rules.stockSelling !== 'off';
  const timerOn = rules.turnTimer !== 'off';

  return (
    <div className="pt-1">
      <SelectRow
        icon={<Timer className="h-4 w-4 text-primary" />}
        label="Turn timer"
        tooltip="Add time pressure to each turn. When the timer expires the turn auto-ends."
        value={rules.turnTimer}
        onChange={(value) => patch({ turnTimer: value as CustomRules['turnTimer'] })}
        options={[
          { value: 'off', label: 'Off (Default)' },
          { value: '30', label: '30 seconds' },
          { value: '60', label: '60 seconds' },
          { value: '90', label: '90 seconds' },
        ]}
      />

      {timerOn && (
        <div className="flex items-center justify-between pl-6 pb-3">
          <span className="text-sm text-muted-foreground">Disable for the first 2 rounds</span>
          <Switch
            aria-label="Disable timer for the first 2 rounds"
            checked={rules.disableTimerFirstRounds}
            onCheckedChange={(on) => patch({ disableTimerFirstRounds: on })}
          />
        </div>
      )}

      <Separator />

      {/* Only meaningful once selling is on; the Basic switch sets 75%. */}
      {sellingOn && (
        <>
          <SelectRow
            icon={<DollarSign className="h-4 w-4 text-primary" />}
            label="Sell price"
            tooltip="What the bank pays for a share, as a percentage of its market price. Anything below 100% is the spread players pay to get out early."
            value={rules.stockSelling}
            onChange={(value) => patch({ stockSelling: value as CustomRules['stockSelling'] })}
            options={[
              { value: '100', label: 'Full value — 100% of market price' },
              { value: '90', label: 'Broker — 90%' },
              { value: '75', label: 'Standard — 75% (Default)' },
              { value: '50', label: 'Fire sale — 50%' },
            ]}
          />
          <Separator />
        </>
      )}

      <SelectRow
        icon={<Eye className="h-4 w-4 text-primary" />}
        label="Cash visibility"
        tooltip="Whether players can see each other's cash. Visible increases negotiation; hidden adds mystery; aggregate shows the total money in the game but not who holds it."
        value={rules.cashVisibility}
        onChange={(value) => patch({ cashVisibility: value as CustomRules['cashVisibility'] })}
        options={[
          { value: 'visible', label: 'Visible to all players (Default)' },
          { value: 'hidden', label: 'Hidden from opponents' },
          { value: 'aggregate', label: 'Show aggregate total only' },
        ]}
      />

      <Separator />

      <SelectRow
        icon={<Trophy className="h-4 w-4 text-primary" />}
        label="Bonus tier"
        tooltip="How merger bonuses pay out. Standard: 10x majority / 5x minority. Flat: the combined pool split equally between all stockholders. Aggressive: 15x / 5x, which makes the majority position decisive."
        value={rules.bonusTier}
        onChange={(value) => patch({ bonusTier: value as CustomRules['bonusTier'] })}
        options={[
          { value: 'standard', label: 'Standard — 10x / 5x (Default)' },
          { value: 'flat', label: 'Flat — equal payout' },
          { value: 'aggressive', label: 'Aggressive — 15x / 5x' },
        ]}
      />

      <Separator />

      <SelectRow
        icon={<Link className="h-4 w-4 text-primary" />}
        label="Max chains"
        tooltip="How many hotel chains can exist on the board. Fewer chains forces earlier mergers. Choosing the small board drops this to 5."
        value={rules.maxChains}
        onChange={(value) => patch({ maxChains: value as CustomRules['maxChains'] })}
        options={[
          { value: '7', label: 'Standard — 7 chains (Default)' },
          { value: '6', label: 'Extended — 6 chains' },
          { value: '5', label: 'Limited — 5 chains' },
        ]}
      />
      {rules.boardSize === 'small' && (
        <p className="text-xs text-muted-foreground pl-6 pb-3">
          The small board is best with 5 chains.
        </p>
      )}

      <Separator />

      <SelectRow
        icon={<DollarSign className="h-4 w-4 text-primary" />}
        label="Starting cash"
        tooltip="How much cash each player begins with. Less cash means a tighter economy and harder choices early."
        value={rules.startingCash}
        onChange={(value) => patch({ startingCash: value as CustomRules['startingCash'] })}
        options={[
          { value: '4000', label: '$4,000 — tight' },
          { value: '6000', label: '$6,000 — standard (Default)' },
          { value: '8000', label: '$8,000 — loose' },
        ]}
      />

      <Separator />

      <SelectRow
        icon={<Grid3X3 className="h-4 w-4 text-primary" />}
        label="Starting tiles"
        tooltip="How many tiles each player holds. More tiles means more options every turn."
        value={rules.startingTiles}
        onChange={(value) => patch({ startingTiles: value as CustomRules['startingTiles'] })}
        options={[
          { value: '5', label: '5 tiles' },
          { value: '6', label: '6 tiles (Default)' },
          { value: '7', label: '7 tiles' },
        ]}
      />

      <Separator />

      {/* Its own top-level setting, not nested under "starting conditions" — the
          old grouping hid it behind a switch that did nothing to the engine. */}
      <Row
        icon={<PlayCircle className="h-4 w-4 text-primary" />}
        label="Place starting tile"
        tooltip="Put one random tile on the board before the first turn, so the opening move always has something to build from."
        control={
          <Switch
            aria-label="Place starting tile"
            checked={rules.startWithTileOnBoard}
            onCheckedChange={(on) => patch({ startWithTileOnBoard: on })}
          />
        }
      />
    </div>
  );
};
