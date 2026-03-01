import { GameLogEntry } from '@/types/game';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Clock } from 'lucide-react';

interface GameLogProps {
  entries: GameLogEntry[];
}

export const GameLog = ({ entries }: GameLogProps) => {
  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const recentEntries = entries.slice(-20).reverse();

  return (
    <div className="bg-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-muted-foreground">Game Log</h3>
      </div>

      <ScrollArea className="h-[180px] custom-scrollbar">
        <div className="space-y-2 pr-2">
          {recentEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 italic text-center py-4">
              No actions yet
            </p>
          ) : (
            recentEntries.map((entry, index) => (
              <div
                key={`${entry.timestamp}-${index}`}
                className={cn(
                  "game-log-entry animate-fade-in",
                  index === 0 && "game-log-entry-recent"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-medium text-foreground">
                      {entry.playerName}
                    </span>
                    <span className="text-muted-foreground"> • {entry.action}</span>
                    {entry.details && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {entry.details}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground/60 shrink-0">
                    {formatTime(entry.timestamp)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
