import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CustomRules } from '@/types/game';
import { describeRules } from '@/types/rules-describe';

interface RoomRulesPanelProps {
  rules: CustomRules;
  isHost?: boolean;
  onEdit?: () => void;
}

/**
 * The room's rules, read-only, for everyone in the waiting room.
 *
 * Every line comes from describeRules() — the one summary renderer — so the
 * panel cannot drift from what the game will actually play. Rules left at their
 * default are dimmed, which makes the host's actual choices the thing you see.
 */
export const RoomRulesPanel = ({ rules, isHost, onEdit }: RoomRulesPanelProps) => (
  <Card className="h-full">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
      <CardTitle className="text-base">Room Rules</CardTitle>
      {isHost && onEdit && (
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5 mr-1.5" />
          Edit Rules
        </Button>
      )}
    </CardHeader>
    <CardContent>
      <dl className="space-y-1.5">
        {describeRules(rules).map((item) => (
          <div key={item.key} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-muted-foreground flex items-center gap-1.5 flex-shrink-0">
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </dt>
            <dd className={`text-right ${item.isCustom ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
      {!isHost && (
        <p className="text-xs text-muted-foreground mt-4">
          Only the host can change the rules, and only before the game starts.
        </p>
      )}
    </CardContent>
  </Card>
);
