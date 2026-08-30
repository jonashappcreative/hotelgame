import { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// The row shapes every rule uses, shared by the Basic section in RulesForm and
// the Advanced section in AdvancedRules. Both must sit inside a TooltipProvider.

export const InfoTooltip = ({ text }: { text: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
    </TooltipTrigger>
    <TooltipContent side="top" className="max-w-[220px] text-xs">
      {text}
    </TooltipContent>
  </Tooltip>
);

/** A rule whose control fits beside its label — a Switch, in practice. */
export const Row = ({
  icon,
  label,
  tooltip,
  control,
}: {
  icon: ReactNode;
  label: string;
  tooltip: string;
  control: ReactNode;
}) => (
  <div className="py-3">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <span className="text-sm font-medium">{label}</span>
        <InfoTooltip text={tooltip} />
      </div>
      <div className="flex-shrink-0">{control}</div>
    </div>
  </div>
);

/** A rule with several named settings; the Select gets its own line. */
export const SelectRow = ({
  icon,
  label,
  tooltip,
  value,
  onChange,
  options,
}: {
  icon: ReactNode;
  label: string;
  tooltip: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) => (
  <div className="py-3 space-y-2">
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-sm font-medium">{label}</span>
      <InfoTooltip text={tooltip} />
    </div>
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);
