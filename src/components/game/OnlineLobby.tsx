import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Copy, Loader2, ArrowLeft, Check, RefreshCw, Settings, AlertTriangle } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface CustomRules {
  startWithTileOnBoard: boolean;
  turnTimer: string;
  chainSafetyThreshold: string;
  cashVisibility: string;
}

const DEFAULT_RULES: CustomRules = {
  startWithTileOnBoard: true,
  turnTimer: 'none',
  chainSafetyThreshold: '11',
  cashVisibility: 'hidden',
};

const hasCustomRulesChanged = (rules: CustomRules): boolean => {
  return (
    rules.startWithTileOnBoard !== DEFAULT_RULES.startWithTileOnBoard ||
    rules.turnTimer !== DEFAULT_RULES.turnTimer ||
    rules.chainSafetyThreshold !== DEFAULT_RULES.chainSafetyThreshold ||
    rules.cashVisibility !== DEFAULT_RULES.cashVisibility
  );
};

const getActiveRulesSummary = (rules: CustomRules): string[] => {
  const summary: string[] = [];
  if (!rules.startWithTileOnBoard) summary.push('🎲 No starting tile on board');
  if (rules.startWithTileOnBoard) summary.push('🎲 Start with tile on board');
  if (rules.turnTimer !== 'none') summary.push(`⏱️ Turn timer: ${rules.turnTimer}s`);
  if (rules.chainSafetyThreshold !== '11') summary.push(`🛡️ Chain safety: ${rules.chainSafetyThreshold === 'none' ? 'None' : rules.chainSafetyThreshold}`);
  if (rules.cashVisibility !== 'hidden') summary.push(`💰 Cash: ${rules.cashVisibility === 'visible' ? 'Visible' : 'Aggregate'}`);
  return summary;
};

interface OnlineLobbyProps {
  roomCode: string | null;
  players: { id: string; player_name: string; player_index: number; is_ready: boolean }[];
  myPlayerIndex: number | null;
  maxPlayers: number;
  isLoading: boolean;
  isCheckingActiveGame?: boolean;
  activeGameInfo?: {
    roomCode: string;
    roomId: string;
    playerName: string;
    roomStatus: string;
  } | null;
  onCreateRoom: (playerName: string, maxPlayers: number) => void;
  onJoinRoom: (code: string, playerName: string) => void;
  onLeaveRoom: () => void;
  onToggleReady: () => void;
  onRejoinGame?: () => void;
  onDismissActiveGame?: () => void;
}

export const OnlineLobby = ({
  roomCode,
  players,
  myPlayerIndex,
  maxPlayers,
  isLoading,
  isCheckingActiveGame,
  activeGameInfo,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onToggleReady,
  onRejoinGame,
  onDismissActiveGame,
}: OnlineLobbyProps) => {
  const navigate = useNavigate();
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [selectedPlayerCount, setSelectedPlayerCount] = useState('4');
  const [mode, setMode] = useState<'menu' | 'create' | 'join' | 'customRules'>('menu');
  const [confirmedRules, setConfirmedRules] = useState<CustomRules | null>(null);
  const [draftRules, setDraftRules] = useState<CustomRules>({ ...DEFAULT_RULES });
  const [showBackWarning, setShowBackWarning] = useState(false);

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
    onCreateRoom(playerName.trim(), parseInt(selectedPlayerCount));
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
              {Array.from({ length: maxPlayers }, (_, index) => {
                const player = players.find(p => p.player_index === index);
                return (
                  <div
                    key={index}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      player
                        ? player.is_ready
                          ? 'bg-green-500/10 border-green-500/40'
                          : 'bg-primary/10 border-primary/30'
                        : 'bg-muted/30 border-dashed'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${
                        player
                          ? player.is_ready
                            ? 'bg-green-500 text-white'
                            : 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}>
                        {player?.is_ready ? <Check className="h-4 w-4" /> : index + 1}
                      </div>
                      <span className={player ? 'font-medium' : 'text-muted-foreground'}>
                        {player ? player.player_name : 'Waiting...'}
                      </span>
                      {player && index === myPlayerIndex && (
                        <Badge variant="secondary">You</Badge>
                      )}
                    </div>
                    {player && (
                      <Badge
                        variant="outline"
                        className={`flex-shrink-0 ${player.is_ready
                          ? 'border-green-500/50 text-green-600'
                          : 'border-yellow-500/50 text-yellow-600'}`}
                      >
                        {player.is_ready ? 'Ready' : 'Not Ready'}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>

            <Separator />

            {(() => {
              const myPlayer = players.find(p => p.player_index === myPlayerIndex);
              const isReady = myPlayer?.is_ready ?? false;
              const readyCount = players.filter(p => p.is_ready).length;
              return (
                <>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={onLeaveRoom}
                      className="flex-1"
                      disabled={isReady}
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Leave
                    </Button>
                    <Button
                      onClick={onToggleReady}
                      disabled={isLoading}
                      variant={isReady ? 'outline' : 'default'}
                      className="flex-1"
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : isReady ? null : (
                        <Check className="h-4 w-4 mr-2" />
                      )}
                      {isReady ? 'Cancel Ready' : 'Click to Ready Up'}
                    </Button>
                  </div>

                  <p className="text-center text-sm text-muted-foreground">
                    {players.length < maxPlayers
                      ? `Need ${maxPlayers - players.length} more player${maxPlayers - players.length > 1 ? 's' : ''} to start`
                      : readyCount === maxPlayers
                        ? 'All players ready — starting game...'
                        : `${readyCount}/${maxPlayers} players ready`}
                  </p>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show loading state while checking for active game
  if (isCheckingActiveGame) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Checking for active games...</p>
        </div>
      </div>
    );
  }

  // Main menu
  if (mode === 'menu') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Button
            variant="ghost"
            size="sm"
            className="mb-4"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>

          {/* Active Game Reconnection Banner */}
          {activeGameInfo && (
            <Card className="mb-4 border-primary/50 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <RefreshCw className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm">Active Game Found</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      You have an {activeGameInfo.roomStatus === 'playing' ? 'ongoing' : 'active'} game in room{' '}
                      <span className="font-mono font-medium">{activeGameInfo.roomCode}</span>
                    </p>
                    <div className="flex gap-2 mt-3">
                      <Button
                        size="sm"
                        onClick={onRejoinGame}
                        disabled={isLoading}
                        className="flex-1"
                      >
                        {isLoading ? (
                          <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3 mr-1.5" />
                        )}
                        Rejoin Game
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onDismissActiveGame}
                        disabled={isLoading}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
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
            {/* Active Game Reconnection Banner */}
            {activeGameInfo && (
              <div className="p-3 rounded-lg border border-primary/50 bg-primary/5 mb-2">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <RefreshCw className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm">Active Game Found</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Room <span className="font-mono font-medium">{activeGameInfo.roomCode}</span>
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        onClick={onRejoinGame}
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3 mr-1.5" />
                        )}
                        Rejoin
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onDismissActiveGame}
                        disabled={isLoading}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Your Name</label>
              <Input
                placeholder="Enter your name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                maxLength={20}
              />
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium">Number of Players</label>
              <RadioGroup 
                value={selectedPlayerCount} 
                onValueChange={setSelectedPlayerCount}
                className="flex flex-wrap gap-2"
              >
                {[2, 3, 4, 5, 6].map((count) => (
                  <div key={count} className="flex items-center">
                    <RadioGroupItem 
                      value={count.toString()} 
                      id={`player-count-${count}`} 
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor={`player-count-${count}`}
                      className="flex items-center justify-center w-12 h-10 rounded-lg border-2 cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 hover:bg-muted/50 transition-colors"
                    >
                      {count}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
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
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                setDraftRules(confirmedRules ? { ...confirmedRules } : { ...DEFAULT_RULES });
                setMode('customRules');
              }}
            >
              <Settings className="h-4 w-4 mr-2" />
              Set Custom Rules
            </Button>

            {/* Custom Rules Summary */}
            {confirmedRules && (
              <div className="p-3 rounded-lg border border-accent bg-accent/10 space-y-2">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Custom Rules
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {getActiveRulesSummary(confirmedRules).map((rule, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {rule}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Custom Rules form
  if (mode === 'customRules') {
    const handleBackFromRules = () => {
      if (hasCustomRulesChanged(draftRules)) {
        setShowBackWarning(true);
      } else {
        setMode('create');
      }
    };

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <Button 
              variant="ghost" 
              size="sm" 
              className="w-fit mb-2"
              onClick={handleBackFromRules}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <CardTitle>Set Custom Rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Starting Tile */}
            <div className="flex items-center justify-between">
              <Label htmlFor="start-tile" className="text-sm font-medium">
                Start with tile on board
              </Label>
              <Switch
                id="start-tile"
                checked={draftRules.startWithTileOnBoard}
                onCheckedChange={(val) => setDraftRules(prev => ({ ...prev, startWithTileOnBoard: val }))}
              />
            </div>

            <Separator />

            {/* Turn Timer */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Turn Timer</Label>
              <Select
                value={draftRules.turnTimer}
                onValueChange={(val) => setDraftRules(prev => ({ ...prev, turnTimer: val }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No timer</SelectItem>
                  <SelectItem value="30">30 seconds</SelectItem>
                  <SelectItem value="60">60 seconds</SelectItem>
                  <SelectItem value="90">90 seconds</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Chain Safety Threshold */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Chain Safety Threshold</Label>
              <Select
                value={draftRules.chainSafetyThreshold}
                onValueChange={(val) => setDraftRules(prev => ({ ...prev, chainSafetyThreshold: val }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="9">9 tiles</SelectItem>
                  <SelectItem value="11">11 tiles (default)</SelectItem>
                  <SelectItem value="13">13 tiles</SelectItem>
                  <SelectItem value="15">15 tiles</SelectItem>
                  <SelectItem value="none">No safety</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Cash Visibility */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Cash Visibility</Label>
              <Select
                value={draftRules.cashVisibility}
                onValueChange={(val) => setDraftRules(prev => ({ ...prev, cashVisibility: val }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hidden">Hidden (default)</SelectItem>
                  <SelectItem value="visible">Visible</SelectItem>
                  <SelectItem value="aggregate">Aggregate only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button 
              className="w-full"
              onClick={() => {
                setConfirmedRules({ ...draftRules });
                setMode('create');
                toast({ title: 'Custom rules confirmed!' });
              }}
            >
              Confirm Rules
            </Button>
          </CardContent>
        </Card>

        {/* Back Warning Dialog */}
        <AlertDialog open={showBackWarning} onOpenChange={setShowBackWarning}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Discard Custom Rules?
              </AlertDialogTitle>
              <AlertDialogDescription>
                You have unsaved custom rules. Going back will discard your changes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setShowBackWarning(false);
                  setMode('create');
                }}
              >
                Discard & Go Back
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }
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
          {/* Active Game Reconnection Banner */}
          {activeGameInfo && (
            <div className="p-3 rounded-lg border border-primary/50 bg-primary/5 mb-2">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <RefreshCw className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm">Active Game Found</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Room <span className="font-mono font-medium">{activeGameInfo.roomCode}</span>
                  </p>
                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      onClick={onRejoinGame}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3 mr-1.5" />
                      )}
                      Rejoin
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={onDismissActiveGame}
                      disabled={isLoading}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
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
