import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Users, Copy, Loader2, ArrowLeft, Play } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface OnlineLobbyProps {
  roomCode: string | null;
  players: { id: string; player_name: string; player_index: number }[];
  myPlayerIndex: number | null;
  isLoading: boolean;
  onCreateRoom: (playerName: string) => void;
  onJoinRoom: (code: string, playerName: string) => void;
  onLeaveRoom: () => void;
  onStartGame: () => void;
}

export const OnlineLobby = ({
  roomCode,
  players,
  myPlayerIndex,
  isLoading,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onStartGame,
}: OnlineLobbyProps) => {
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');

  const handleCopyCode = () => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode);
      toast({ title: 'Copied!', description: 'Room code copied to clipboard' });
    }
  };

  const handleCreate = () => {
    if (!playerName.trim()) {
      toast({ title: 'Enter your name', variant: 'destructive' });
      return;
    }
    onCreateRoom(playerName.trim());
  };

  const handleJoin = () => {
    if (!playerName.trim()) {
      toast({ title: 'Enter your name', variant: 'destructive' });
      return;
    }
    if (!joinCode.trim() || joinCode.length < 6) {
      toast({ title: 'Enter a valid room code', variant: 'destructive' });
      return;
    }
    onJoinRoom(joinCode.trim(), playerName.trim());
  };

  // In a room waiting for players
  if (roomCode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Waiting for Players</CardTitle>
            <div className="flex items-center justify-center gap-2 mt-4">
              <Badge variant="outline" className="text-2xl font-mono px-4 py-2">
                {roomCode}
              </Badge>
              <Button variant="ghost" size="icon" onClick={handleCopyCode}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Share this code with friends to join
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Player slots */}
            <div className="space-y-2">
              {[0, 1, 2, 3].map(index => {
                const player = players.find(p => p.player_index === index);
                return (
                  <div
                    key={index}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      player 
                        ? 'bg-primary/10 border-primary/30' 
                        : 'bg-muted/30 border-dashed'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        player ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}>
                        {index + 1}
                      </div>
                      <span className={player ? 'font-medium' : 'text-muted-foreground'}>
                        {player ? player.player_name : 'Waiting...'}
                      </span>
                    </div>
                    {player && index === myPlayerIndex && (
                      <Badge variant="secondary">You</Badge>
                    )}
                  </div>
                );
              })}
            </div>

            <Separator />

            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={onLeaveRoom}
                className="flex-1"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Leave
              </Button>
              <Button 
                onClick={onStartGame}
                disabled={players.length !== 4 || isLoading}
                className="flex-1"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Start Game
              </Button>
            </div>

            {players.length !== 4 && (
              <p className="text-center text-sm text-muted-foreground">
                Need {4 - players.length} more player{4 - players.length > 1 ? 's' : ''} to start
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Main menu
  if (mode === 'menu') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center">
              <Users className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-3xl font-bold">Acquire</CardTitle>
            <p className="text-muted-foreground">Online Multiplayer</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              className="w-full h-14 text-lg"
              onClick={() => setMode('create')}
            >
              Create Room
            </Button>
            <Button 
              variant="outline"
              className="w-full h-14 text-lg"
              onClick={() => setMode('join')}
            >
              Join Room
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Create room form
  if (mode === 'create') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <Button 
              variant="ghost" 
              size="sm" 
              className="w-fit mb-2"
              onClick={() => setMode('menu')}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <CardTitle>Create a Room</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Your Name</label>
              <Input
                placeholder="Enter your name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                maxLength={20}
              />
            </div>
            <Button 
              className="w-full"
              onClick={handleCreate}
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Create Room
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Join room form
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-fit mb-2"
            onClick={() => setMode('menu')}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <CardTitle>Join a Room</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Your Name</label>
            <Input
              placeholder="Enter your name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={20}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Room Code</label>
            <Input
              placeholder="Enter 6-character code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              className="font-mono text-center text-lg tracking-widest"
            />
          </div>
          <Button 
            className="w-full"
            onClick={handleJoin}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Join Room
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
