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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Users, Copy, Loader2, ArrowLeft, Check, RefreshCw, Settings, AlertTriangle, Timer, Shield, Eye, Trophy, Grid3X3, Link, DollarSign, Info } from 'lucide-react';
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
  turnTimerEnabled: boolean;
  turnTimer: string;
  disableTimerFirstRounds: boolean;
  chainSafetyEnabled: boolean;
  chainSafetyThreshold: string;
  cashVisibilityEnabled: boolean;
  cashVisibility: string;
  bonusTierEnabled: boolean;
  bonusTier: string;
  boardSizeEnabled: boolean;
  boardSize: string;
  chainFoundingEnabled: boolean;
  maxChains: string;
  founderFreeStock: boolean;
  startingConditionsEnabled: boolean;
  startingCash: string;
  startingTiles: string;
}

const DEFAULT_RULES: CustomRules = {
  startWithTileOnBoard: true,
  turnTimerEnabled: false,
  turnTimer: '60',
  disableTimerFirstRounds: true,
  chainSafetyEnabled: false,
  chainSafetyThreshold: '11',
  cashVisibilityEnabled: false,
  cashVisibility: 'hidden',
  bonusTierEnabled: false,
  bonusTier: 'standard',
  boardSizeEnabled: false,
  boardSize: '9x12',
  chainFoundingEnabled: false,
  maxChains: '7',
  founderFreeStock: true,
  startingConditionsEnabled: false,
  startingCash: '6000',
  startingTiles: '6',
};

const hasCustomRulesChanged = (rules: CustomRules): boolean => {
  return JSON.stringify(rules) !== JSON.stringify(DEFAULT_RULES);
};

const getActiveRulesSummary = (rules: CustomRules): string[] => {
  const summary: string[] = [];
  if (rules.turnTimerEnabled) summary.push(`⏱ Turn timer: ${rules.turnTimer}s`);
  summary.push(`🛡 Safe at ${rules.chainSafetyEnabled ? (rules.chainSafetyThreshold === 'none' ? '—' : rules.chainSafetyThreshold + '+') : '11+'}`);
  summary.push(`👁 Cash ${rules.cashVisibilityEnabled ? (rules.cashVisibility === 'visible' ? 'visible' : rules.cashVisibility === 'aggregate' ? 'aggregate' : 'hidden') : 'hidden'}`);
  summary.push(`🏆 Bonus: ${rules.bonusTierEnabled ? (rules.bonusTier === 'flat' ? 'Flat' : rules.bonusTier === 'aggressive' ? '15x/5x' : '10x/5x') : '10x/5x'}`);
  summary.push(`📐 Board: ${rules.boardSizeEnabled ? rules.boardSize.replace('x', '×') : '9×12'}`);
  summary.push(`🔗 Max ${rules.chainFoundingEnabled ? rules.maxChains : '7'} chains`);
  return summary;
};

const InfoTooltip = ({ text }: { text: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
    </TooltipTrigger>
    <TooltipContent side="top" className="max-w-[220px] text-xs">
      {text}
    </TooltipContent>
  </Tooltip>
);

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
              {confirmedRules && hasCustomRulesChanged(confirmedRules) ? (
                <><Check className="h-4 w-4 mr-1" /> Edit Custom Rules</>
              ) : (
                'Set Custom Rules'
              )}
            </Button>

            {/* Custom Rules Summary */}
            {confirmedRules && (
              <div className="p-3 rounded-lg border border-muted bg-muted/30 space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Active Custom Rules
                </h4>
                <div className="space-y-1">
                  {getActiveRulesSummary(confirmedRules).map((rule, i) => (
                    <p key={i} className="text-sm text-foreground">{rule}</p>
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
      <TooltipProvider delayDuration={300}>
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
          <Card className="w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
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
              <CardTitle className="text-2xl font-bold">Set Custom Rules</CardTitle>
              <p className="text-sm text-muted-foreground">Configure game rules before creating your room</p>
            </CardHeader>
            <CardContent className="space-y-0 flex flex-col overflow-hidden flex-1 min-h-0">
              <div className="space-y-1 overflow-y-auto flex-1 min-h-0 scrollbar-thin">
              {/* Turn Timer */}
              <div className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Timer className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Turn Timer</span>
                    <InfoTooltip text="Add time pressure to each turn. When the timer expires, the turn auto-ends. You can disable it for the first 2 rounds to let players learn." />
                  </div>
                  <Switch
                    checked={draftRules.turnTimerEnabled}
                    onCheckedChange={(val) => setDraftRules(prev => ({ ...prev, turnTimerEnabled: val }))}
                  />
                </div>
                {draftRules.turnTimerEnabled && (
                  <div className="mt-3 space-y-3 pl-6">
                    <Select
                      value={draftRules.turnTimer}
                      onValueChange={(val) => setDraftRules(prev => ({ ...prev, turnTimer: val }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">30 Seconds</SelectItem>
                        <SelectItem value="60">60 Seconds</SelectItem>
                        <SelectItem value="90">90 Seconds</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Disable timer for first 2 rounds</span>
                      <Switch
                        checked={draftRules.disableTimerFirstRounds}
                        onCheckedChange={(val) => setDraftRules(prev => ({ ...prev, disableTimerFirstRounds: val }))}
                      />
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              {/* Chain Safety Threshold */}
              <div className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Chain Safety Threshold</span>
                    <InfoTooltip text="Chains that reach this size become 'safe' and cannot be acquired in mergers. Lower = easier to protect, higher = more aggressive mergers." />
                  </div>
                  <Switch
                    checked={draftRules.chainSafetyEnabled}
                    onCheckedChange={(val) => setDraftRules(prev => ({ ...prev, chainSafetyEnabled: val }))}
                  />
                </div>
                {draftRules.chainSafetyEnabled && (
                  <div className="mt-3 pl-6">
                    <Select
                      value={draftRules.chainSafetyThreshold}
                      onValueChange={(val) => setDraftRules(prev => ({ ...prev, chainSafetyThreshold: val }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Aggressive — No safe chains</SelectItem>
                        <SelectItem value="9">9 tiles</SelectItem>
                        <SelectItem value="11">Defensive — Safe at 11+ (Default)</SelectItem>
                        <SelectItem value="13">Fortress — Safe at 13+</SelectItem>
                        <SelectItem value="15">15 tiles</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <Separator />

              {/* Cash Visibility */}
              <div className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Cash Visibility</span>
                    <InfoTooltip text="Control whether players can see each other's cash. Hidden adds mystery; visible increases negotiation. Aggregate shows total cash in game but not individual amounts." />
                  </div>
                  <Switch
                    checked={draftRules.cashVisibilityEnabled}
                    onCheckedChange={(val) => setDraftRules(prev => ({ ...prev, cashVisibilityEnabled: val }))}
                  />
                </div>
                {draftRules.cashVisibilityEnabled && (
                  <div className="mt-3 pl-6">
                    <Select
                      value={draftRules.cashVisibility}
                      onValueChange={(val) => setDraftRules(prev => ({ ...prev, cashVisibility: val }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hidden">Cash hidden from opponents (Default)</SelectItem>
                        <SelectItem value="visible">Cash visible to all players</SelectItem>
                        <SelectItem value="aggregate">Show aggregate total only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <Separator />

              {/* Bonus Payment Tiers */}
              <div className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Bonus Payment Tiers</span>
                    <InfoTooltip text="Control merger bonus payouts. Standard: 10x majority / 5x minority. Flat: equal payout to all stockholders. Aggressive: 15x majority / 5x minority — makes majority position crucial." />
                  </div>
                  <Switch
                    checked={draftRules.bonusTierEnabled}
                    onCheckedChange={(val) => setDraftRules(prev => ({ ...prev, bonusTierEnabled: val }))}
                  />
                </div>
                {draftRules.bonusTierEnabled && (
                  <div className="mt-3 pl-6">
                    <Select
                      value={draftRules.bonusTier}
                      onValueChange={(val) => setDraftRules(prev => ({ ...prev, bonusTier: val }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="standard">Standard — 10x / 5x (Default)</SelectItem>
                        <SelectItem value="flat">Flat — Equal payout</SelectItem>
                        <SelectItem value="aggressive">Aggressive — 15x / 5x</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <Separator />

              {/* Board Size */}
              <div className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Grid3X3 className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Board Size</span>
                    <InfoTooltip text="The standard 9×12 board is balanced for most games. A smaller 6×10 board makes for faster, more intense games with quicker mergers." />
                  </div>
                  <Switch
                    checked={draftRules.boardSizeEnabled}
                    onCheckedChange={(val) => setDraftRules(prev => ({ ...prev, boardSizeEnabled: val }))}
                  />
                </div>
                {draftRules.boardSizeEnabled && (
                  <div className="mt-3 pl-6">
                    <Select
                      value={draftRules.boardSize}
                      onValueChange={(val) => setDraftRules(prev => ({ ...prev, boardSize: val }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="9x12">Standard — 9×12 (Default)</SelectItem>
                        <SelectItem value="6x10">Small — 6×10 (Fast)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <Separator />

              {/* Chain Founding Rules */}
              <div className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Link className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Chain Founding Rules</span>
                    <InfoTooltip text="Control how many hotel chains can exist on the board. Limiting to 5 forces earlier mergers. The founder free stock toggle determines if the player who founds a chain gets a free stock." />
                  </div>
                  <Switch
                    checked={draftRules.chainFoundingEnabled}
                    onCheckedChange={(val) => setDraftRules(prev => ({ ...prev, chainFoundingEnabled: val }))}
                  />
                </div>
                {draftRules.chainFoundingEnabled && (
                  <div className="mt-3 space-y-3 pl-6">
                    <Select
                      value={draftRules.maxChains}
                      onValueChange={(val) => setDraftRules(prev => ({ ...prev, maxChains: val }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="7">Standard — Max 7 chains (Default)</SelectItem>
                        <SelectItem value="5">Limited — Max 5 chains</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Founder receives free stock</span>
                      <Switch
                        checked={draftRules.founderFreeStock}
                        onCheckedChange={(val) => setDraftRules(prev => ({ ...prev, founderFreeStock: val }))}
                      />
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              {/* Starting Conditions */}
              <div className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Starting Conditions</span>
                    <InfoTooltip text="Adjust how much cash and how many tiles each player starts with. Lower cash = tighter economy, more tiles = more early options." />
                  </div>
                  <Switch
                    checked={draftRules.startingConditionsEnabled}
                    onCheckedChange={(val) => setDraftRules(prev => ({ ...prev, startingConditionsEnabled: val }))}
                  />
                </div>
                {draftRules.startingConditionsEnabled && (
                  <div className="mt-3 space-y-3 pl-6">
                    <div className="space-y-1.5">
                      <span className="text-sm text-muted-foreground">Starting Cash</span>
                      <Select
                        value={draftRules.startingCash}
                        onValueChange={(val) => setDraftRules(prev => ({ ...prev, startingCash: val }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="4000">$4,000 — Tight</SelectItem>
                          <SelectItem value="6000">$6,000 — Standard (Default)</SelectItem>
                          <SelectItem value="8000">$8,000 — Loose</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-sm text-muted-foreground">Starting Tiles</span>
                      <Select
                        value={draftRules.startingTiles}
                        onValueChange={(val) => setDraftRules(prev => ({ ...prev, startingTiles: val }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="5">5 Tiles</SelectItem>
                          <SelectItem value="6">6 Tiles (Default)</SelectItem>
                          <SelectItem value="7">7 Tiles</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Start with tile on board</span>
                      <Switch
                        checked={draftRules.startWithTileOnBoard}
                        onCheckedChange={(val) => setDraftRules(prev => ({ ...prev, startWithTileOnBoard: val }))}
                      />
                    </div>
                  </div>
                )}
              </div>

              </div>

              <Button 
                className="w-full mt-6 flex-shrink-0"
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
      </TooltipProvider>
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
