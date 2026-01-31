import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Users, Play, UserPlus, ArrowLeft } from 'lucide-react';

interface LobbyProps {
  onStartGame: (playerNames: string[]) => void;
  onBack?: () => void;
}

export const Lobby = ({ onStartGame, onBack }: LobbyProps) => {
  const [selectedPlayerCount, setSelectedPlayerCount] = useState(4);
  const [playerNames, setPlayerNames] = useState<string[]>(['', '', '', '']);
  const [focusedInput, setFocusedInput] = useState<number | null>(null);

  // Update player names array when count changes
  useEffect(() => {
    setPlayerNames(prev => {
      const newNames = [...prev];
      if (newNames.length < selectedPlayerCount) {
        // Add empty slots
        while (newNames.length < selectedPlayerCount) {
          newNames.push('');
        }
      } else if (newNames.length > selectedPlayerCount) {
        // Remove extra slots
        newNames.length = selectedPlayerCount;
      }
      return newNames;
    });
  }, [selectedPlayerCount]);

  const updatePlayerName = (index: number, name: string) => {
    const newNames = [...playerNames];
    newNames[index] = name;
    setPlayerNames(newNames);
  };

  const filledPlayers = playerNames.filter(name => name.trim().length > 0);
  const canStart = filledPlayers.length === selectedPlayerCount;

  const handleStart = () => {
    if (canStart) {
      onStartGame(playerNames.map(name => name.trim()));
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Back Button */}
        {onBack && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="mb-4"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        )}

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <Users className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Local Play</h1>
          <p className="text-muted-foreground">
            Set up your game
          </p>
        </div>

        {/* Player Setup */}
        <div className="bg-card rounded-2xl p-6 shadow-lg border border-border">
          {/* Player Count Selection */}
          <div className="mb-6">
            <label className="text-sm font-medium mb-3 block">Number of Players</label>
            <RadioGroup 
              value={selectedPlayerCount.toString()} 
              onValueChange={(v) => setSelectedPlayerCount(parseInt(v))}
              className="flex flex-wrap gap-2"
            >
              {[2, 3, 4, 5, 6].map((count) => (
                <div key={count} className="flex items-center">
                  <RadioGroupItem 
                    value={count.toString()} 
                    id={`local-player-count-${count}`} 
                    className="peer sr-only"
                  />
                  <Label
                    htmlFor={`local-player-count-${count}`}
                    className="flex items-center justify-center w-12 h-10 rounded-lg border-2 cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 hover:bg-muted/50 transition-colors"
                  >
                    {count}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-muted-foreground" />
            <h2 className="font-semibold">Players</h2>
            <span className="ml-auto text-sm text-muted-foreground">
              {filledPlayers.length} / {selectedPlayerCount}
            </span>
          </div>

          <div className="space-y-3 mb-6">
            {playerNames.map((name, index) => (
              <div key={index} className="relative">
                <div className={cn(
                  "absolute left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                  name.trim() 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-muted text-muted-foreground"
                )}>
                  {index + 1}
                </div>
                <Input
                  placeholder={`Player ${index + 1} name`}
                  value={name}
                  onChange={(e) => updatePlayerName(index, e.target.value)}
                  onFocus={() => setFocusedInput(index)}
                  onBlur={() => setFocusedInput(null)}
                  className={cn(
                    "pl-12 h-12 text-base",
                    focusedInput === index && "ring-2 ring-primary"
                  )}
                  maxLength={20}
                />
                {name.trim() && (
                  <UserPlus className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-cash-positive" />
                )}
              </div>
            ))}
          </div>

          <Button
            className="w-full h-12 text-base"
            size="lg"
            disabled={!canStart}
            onClick={handleStart}
          >
            <Play className="w-5 h-5 mr-2" />
            Start Game
          </Button>

          {!canStart && (
            <p className="text-center text-sm text-muted-foreground mt-3">
              Enter names for all {selectedPlayerCount} players to start
            </p>
          )}
        </div>

        {/* Game Info */}
        <div className="mt-6 p-4 rounded-xl bg-muted/30 border border-border/50">
          <h3 className="font-medium mb-2 text-sm">How to Play</h3>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Place tiles to form hotel chains</li>
            <li>• Buy stocks in chains you believe will grow</li>
            <li>• Merge chains to earn bonuses</li>
            <li>• End with the most cash to win!</li>
          </ul>
        </div>
      </div>
    </div>
  );
};
