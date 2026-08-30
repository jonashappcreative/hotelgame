import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LobbyShell } from './LobbyShell';
import { ActiveGameBanner, type ActiveGameInfo } from './ActiveGameBanner';

interface LobbyMenuProps {
  activeGameInfo: ActiveGameInfo | null;
  isLoading?: boolean;
  onCreate: () => void;
  onJoin: () => void;
  onRejoinGame?: () => void;
  onDismissActiveGame?: () => void;
}

export const LobbyMenu = ({
  activeGameInfo,
  isLoading,
  onCreate,
  onJoin,
  onRejoinGame,
  onDismissActiveGame,
}: LobbyMenuProps) => {
  const navigate = useNavigate();

  return (
    <LobbyShell onBack={() => navigate('/')}>
      <ActiveGameBanner
        variant="card"
        info={activeGameInfo}
        isLoading={isLoading}
        onRejoin={onRejoinGame}
        onDismiss={onDismissActiveGame}
      />

      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center">
            <Users className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold">Hotel Game</CardTitle>
          <p className="text-muted-foreground">Online Multiplayer</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button className="w-full h-14 text-lg" onClick={onCreate}>
            Create Room
          </Button>
          <Button variant="outline" className="w-full h-14 text-lg" onClick={onJoin}>
            Join Room
          </Button>
        </CardContent>
      </Card>
    </LobbyShell>
  );
};
