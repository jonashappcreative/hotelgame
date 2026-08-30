import { useState } from 'react';
import { ChevronDown, Grid3X3, Loader2, Repeat2, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CustomRules } from '@/types/game';
import { coerceBoardSizeCoupling } from '@/types/rules-normalize';
import { AdvancedRules } from './AdvancedRules';
import { Row, SelectRow } from './rule-controls';

interface RulesFormProps {
  /** 'create' confirms into a new room; 'edit' saves to an existing one. */
  mode: 'create' | 'edit';
  initialRules: CustomRules;
  onConfirm: (rules: CustomRules) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

/**
 * The only rules form in the codebase — used both when creating a room and when
 * the host edits a waiting room's rules.
 *
 * Basic is the three rules that change how a game feels; everything else is
 * behind the Advanced disclosure, because eleven equal-weight switches made
 * none of them read as important.
 */
export const RulesForm = ({ mode, initialRules, onConfirm, onCancel, isLoading }: RulesFormProps) => {
  const [rules, setRules] = useState<CustomRules>({ ...initialRules });
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Every write goes through the board-size coupling, so picking the small
  // board drops Max Chains to 5 whichever control the host touched. The server
  // applies the same rule again at game start.
  const patch = (updates: Partial<CustomRules>) =>
    setRules((prev) => coerceBoardSizeCoupling({ ...prev, ...updates }));

  return (
    <TooltipProvider delayDuration={300}>
      <Card className="flex flex-col overflow-hidden max-h-[80vh]">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Game Rules</CardTitle>
          <p className="text-sm text-muted-foreground">
            {mode === 'create'
              ? 'Confirm these to create your room. You can change them any time before the game starts.'
              : 'Changes apply immediately for everyone in the room.'}
          </p>
        </CardHeader>

        <CardContent className="flex flex-col overflow-hidden flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 min-h-0 scrollbar-thin pr-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">
              Basic
            </h3>

            <Row
              icon={<Grid3X3 className="h-4 w-4 text-primary" />}
              label="Small board"
              tooltip="The standard 9×12 board is balanced for most games. The smaller 6×10 board makes for faster, more intense games with quicker mergers — and drops the chain limit to 5."
              control={
                <Switch
                  aria-label="Small board"
                  checked={rules.boardSize === 'small'}
                  onCheckedChange={(on) => patch({ boardSize: on ? 'small' : 'large' })}
                />
              }
            />

            <Separator />

            {/* One field, two levels of detail: this switch flips between 'off'
                and the standard 75%; Advanced exposes the full rate. */}
            <Row
              icon={<Repeat2 className="h-4 w-4 text-primary" />}
              label="Allow selling"
              tooltip="Lets players sell shares back to the bank during their buy phase, up to 3 per turn on top of what they buy. The bank pays less than it charges — that spread is the price of getting out early. Set the exact rate under Advanced."
              control={
                <Switch
                  aria-label="Allow selling"
                  checked={rules.stockSelling !== 'off'}
                  onCheckedChange={(on) => patch({ stockSelling: on ? '75' : 'off' })}
                />
              }
            />

            <Separator />

            <SelectRow
              icon={<Shield className="h-4 w-4 text-primary" />}
              label="Chain safety"
              tooltip="Chains that reach this size become 'safe' and can never be acquired in a merger. Aggressive means no chain is ever safe — any chain can be swallowed at any size."
              value={rules.chainSafety}
              onChange={(value) => patch({ chainSafety: value as CustomRules['chainSafety'] })}
              options={[
                { value: 'none', label: 'Aggressive — no safe chains (Default)' },
                { value: '9', label: 'Safe at 9+ tiles' },
                { value: '11', label: 'Safe at 11+ tiles' },
                { value: '13', label: 'Fortress — safe at 13+ tiles' },
                { value: '15', label: 'Safe at 15+ tiles' },
              ]}
            />

            <Separator className="my-2" />

            <Button
              type="button"
              variant="ghost"
              className="w-full justify-between text-muted-foreground"
              onClick={() => setShowAdvanced((open) => !open)}
              aria-expanded={showAdvanced}
            >
              Advanced Rules
              <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            </Button>

            {showAdvanced && <AdvancedRules rules={rules} onPatch={patch} />}
          </div>

          <div className="flex gap-2 pt-3 flex-shrink-0">
            <Button variant="outline" className="flex-1" onClick={onCancel} disabled={isLoading}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={() => onConfirm(rules)} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {mode === 'create' ? 'Confirm Rules' : 'Save Rules'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};
