import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ActiveGameBanner, type ActiveGameInfo } from './ActiveGameBanner';

interface CreateRoomScreenProps {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  onContinue: () => void;
  activeGameInfo: ActiveGameInfo | null;
  isLoading?: boolean;
  onRejoinGame?: () => void;
  onDismissActiveGame?: () => void;
}

/**
 * Step one of creating a room: a name, and nothing else.
 *
 * The player-count picker used to live here and asked a question the host
 * cannot answer yet — how many people will show up. Rooms now hold up to six
 * and start whenever everyone present is ready, so the only thing left to
 * decide is the rules, and confirming those is what creates the room.
 */
export const CreateRoomScreen = ({
  playerName,
  onPlayerNameChange,
  onContinue,
  activeGameInfo,
  isLoading,
  onRejoinGame,
  onDismissActiveGame,
}: CreateRoomScreenProps) => (
  <Card>
    <CardHeader>
      <CardTitle>Create a Room</CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      <ActiveGameBanner
        info={activeGameInfo}
        isLoading={isLoading}
        onRejoin={onRejoinGame}
        onDismiss={onDismissActiveGame}
      />

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="create-player-name">Your Name</label>
        <Input
          id="create-player-name"
          placeholder="Enter your name"
          value={playerName}
          onChange={(e) => onPlayerNameChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && playerName.trim()) onContinue(); }}
          maxLength={20}
        />
      </div>

      <Button className="w-full" onClick={onContinue} disabled={!playerName.trim()}>
        <Settings className="h-4 w-4 mr-2" />
        Set Rules
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        Your room is created once you confirm the rules.
      </p>
    </CardContent>
  </Card>
);
