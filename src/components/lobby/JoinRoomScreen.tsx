import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ActiveGameBanner, type ActiveGameInfo } from './ActiveGameBanner';

interface JoinRoomScreenProps {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  joinCode: string;
  onJoinCodeChange: (code: string) => void;
  onJoin: () => void;
  isLoading?: boolean;
  activeGameInfo: ActiveGameInfo | null;
  onRejoinGame?: () => void;
  onDismissActiveGame?: () => void;
}

export const JoinRoomScreen = ({
  playerName,
  onPlayerNameChange,
  joinCode,
  onJoinCodeChange,
  onJoin,
  isLoading,
  activeGameInfo,
  onRejoinGame,
  onDismissActiveGame,
}: JoinRoomScreenProps) => {
  const canJoin = playerName.trim().length > 0 && joinCode.trim().length === 6;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join a Room</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ActiveGameBanner
          info={activeGameInfo}
          isLoading={isLoading}
          onRejoin={onRejoinGame}
          onDismiss={onDismissActiveGame}
        />

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="join-player-name">Your Name</label>
          <Input
            id="join-player-name"
            placeholder="Enter your name"
            value={playerName}
            onChange={(e) => onPlayerNameChange(e.target.value)}
            maxLength={20}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="join-room-code">Room Code</label>
          <Input
            id="join-room-code"
            placeholder="Enter 6-character code"
            value={joinCode}
            onChange={(e) => onJoinCodeChange(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter' && canJoin) onJoin(); }}
            maxLength={6}
            className="font-mono text-center text-lg tracking-widest"
          />
        </div>

        <Button className="w-full" onClick={onJoin} disabled={isLoading || !canJoin}>
          {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Join Room
        </Button>
      </CardContent>
    </Card>
  );
};
