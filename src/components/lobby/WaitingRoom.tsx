import { ArrowLeft, Check, Copy, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { CustomRules } from '@/types/game';
import type { TurnOrderMode } from '@/utils/multiplayerService';
import { PlayerList, type LobbyPlayer } from './PlayerList';
import { RoomRulesPanel } from './RoomRulesPanel';

/** Matches MIN_PLAYERS_TO_START in server/lib/players.ts. */
const MIN_PLAYERS_TO_START = 2;

interface WaitingRoomProps {
  roomCode: string;
  players: LobbyPlayer[];
  myPlayerIndex: number | null;
  capacity: number;
  rules: CustomRules;
  turnOrderMode: TurnOrderMode;
  isHost?: boolean;
  isLoading?: boolean;
  onEditRules?: () => void;
  onSetTurnOrderMode?: (mode: TurnOrderMode) => void;
  onSetPlayerOrder?: (playerIds: string[]) => void;
  onAddBot?: (difficulty: 'easy' | 'medium' | 'hard') => void;
  onRemoveBot?: (playerIndex: number) => void;
  onLeaveRoom: () => void;
  onToggleReady: () => void;
}

/**
 * Seats on the left, rules on the right — the two things people are actually
 * waiting on, side by side instead of the rules being buried under six empty
 * slots. Everything stays editable until the game starts.
 */
export const WaitingRoom = ({
  roomCode,
  players,
  myPlayerIndex,
  capacity,
  rules,
  turnOrderMode,
  isHost,
  isLoading,
  onEditRules,
  onSetTurnOrderMode,
  onSetPlayerOrder,
  onAddBot,
  onRemoveBot,
  onLeaveRoom,
  onToggleReady,
}: WaitingRoomProps) => {
  const me = players.find((p) => p.player_index === myPlayerIndex);
  const isReady = me?.is_ready ?? false;
  const humans = players.filter((p) => !p.is_bot);
  const readyHumans = humans.filter((p) => p.is_ready).length;
  const enoughPlayers = players.length >= MIN_PLAYERS_TO_START;

  const status = !enoughPlayers
    ? `Waiting for at least ${MIN_PLAYERS_TO_START} players`
    : readyHumans === humans.length
      ? 'Everyone is ready — starting game…'
      : `${readyHumans}/${humans.length} players ready`;

  const copyCode = () => {
    navigator.clipboard.writeText(roomCode);
    toast({ title: 'Copied!', description: 'Room code copied to clipboard' });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center justify-center gap-3">
          <Badge variant="outline" className="text-2xl font-mono px-4 py-2">{roomCode}</Badge>
          <Button variant="ghost" size="icon" onClick={copyCode} aria-label="Copy room code">
            <Copy className="h-4 w-4" />
          </Button>
          <p className="text-sm text-muted-foreground">Share this code with friends to join</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 items-start">
        <PlayerList
          players={players}
          myPlayerIndex={myPlayerIndex}
          capacity={capacity}
          isHost={isHost}
          isLoading={isLoading}
          turnOrderMode={turnOrderMode}
          onSetTurnOrderMode={onSetTurnOrderMode}
          onSetPlayerOrder={onSetPlayerOrder}
          onAddBot={onAddBot}
          onRemoveBot={onRemoveBot}
        />
        <RoomRulesPanel rules={rules} isHost={isHost} onEdit={onEditRules} />
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onLeaveRoom} className="flex-1" disabled={isReady}>
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
          <p className="text-center text-sm text-muted-foreground">{status}</p>
        </CardContent>
      </Card>
    </div>
  );
};
