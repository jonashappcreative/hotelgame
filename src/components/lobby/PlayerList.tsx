import { useEffect, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { Bot, Check, GripVertical, Plus, Shuffle, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { TurnOrderMode } from '@/utils/multiplayerService';

export interface LobbyPlayer {
  id: string;
  player_name: string;
  player_index: number;
  is_ready: boolean;
  is_bot?: boolean;
  bot_difficulty?: string | null;
}

interface PlayerListProps {
  players: LobbyPlayer[];
  myPlayerIndex: number | null;
  capacity: number;
  isHost?: boolean;
  isLoading?: boolean;
  turnOrderMode: TurnOrderMode;
  onSetTurnOrderMode?: (mode: TurnOrderMode) => void;
  onSetPlayerOrder?: (playerIds: string[]) => void;
  onAddBot?: (difficulty: 'easy' | 'medium' | 'hard') => void;
  onRemoveBot?: (playerIndex: number) => void;
}

const shuffled = <T,>(items: T[]): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** One row, extracted so each can own its drag controls (handle-only dragging). */
const PlayerRow = ({
  player,
  seatLabel,
  isYou,
  draggable,
  isHost,
  onRemoveBot,
}: {
  player: LobbyPlayer;
  seatLabel: string;
  isYou: boolean;
  draggable: boolean;
  isHost?: boolean;
  onRemoveBot?: (playerIndex: number) => void;
}) => {
  const controls = useDragControls();

  const content = (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border ${
        player.is_ready
          ? 'bg-green-500/10 border-green-500/40'
          : 'bg-primary/10 border-primary/30'
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        {draggable && (
          <GripVertical
            className="h-4 w-4 text-muted-foreground cursor-grab active:cursor-grabbing flex-shrink-0 touch-none"
            onPointerDown={(e) => controls.start(e)}
            aria-label={`Drag ${player.player_name}`}
          />
        )}
        <div
          className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm ${
            player.is_bot
              ? 'bg-violet-500 text-white'
              : player.is_ready
                ? 'bg-green-500 text-white'
                : 'bg-primary text-primary-foreground'
          }`}
        >
          {player.is_bot ? <Bot className="h-4 w-4" /> : player.is_ready ? <Check className="h-4 w-4" /> : seatLabel}
        </div>
        <span className="font-medium truncate">{player.player_name}</span>
        {isYou && <Badge variant="secondary">You</Badge>}
      </div>

      {player.is_bot ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant="outline" className="border-violet-500/50 text-violet-600 capitalize">
            Bot · {player.bot_difficulty ?? 'medium'}
          </Badge>
          {isHost && onRemoveBot && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onRemoveBot(player.player_index)}
              aria-label={`Remove ${player.player_name}`}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ) : (
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

  if (!draggable) return <div>{content}</div>;

  return (
    <Reorder.Item value={player} dragListener={false} dragControls={controls}>
      {content}
    </Reorder.Item>
  );
};

/**
 * The seats in a waiting room.
 *
 * The list no longer renders a fixed grid of empty slots — there is no player
 * count to fill — just the players who are here plus one "Waiting…" row while
 * there is still room.
 *
 * Turn order is either Random (seats shuffled by the server at game start, so
 * the numbers here would be a lie and are replaced by a dot) or Custom (the
 * host drags the rows and the numbers are real).
 */
export const PlayerList = ({
  players,
  myPlayerIndex,
  capacity,
  isHost,
  isLoading,
  turnOrderMode,
  onSetTurnOrderMode,
  onSetPlayerOrder,
  onAddBot,
  onRemoveBot,
}: PlayerListProps) => {
  const [botDifficulty, setBotDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  // Local copy so a drag reads smoothly; the server's order wins on every
  // broadcast (the effect below), which also reverts a rejected reorder.
  const [order, setOrder] = useState<LobbyPlayer[]>(players);

  useEffect(() => { setOrder(players); }, [players]);

  const canDrag = isHost === true && turnOrderMode === 'manual' && onSetPlayerOrder !== undefined;
  const hasRoom = players.length < capacity;

  const commit = (next: LobbyPlayer[]) => {
    setOrder(next);
    onSetPlayerOrder?.(next.map((p) => p.id));
  };

  const rows = order.map((player, index) => (
    <PlayerRow
      key={player.id}
      player={player}
      seatLabel={turnOrderMode === 'random' ? '•' : String(index + 1)}
      isYou={player.player_index === myPlayerIndex}
      draggable={canDrag}
      isHost={isHost}
      onRemoveBot={onRemoveBot}
    />
  ));

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">
            Players <span className="text-muted-foreground font-normal">{players.length}/{capacity}</span>
          </CardTitle>
          {isHost && onSetTurnOrderMode && (
            <div className="flex rounded-md border overflow-hidden text-xs" role="group" aria-label="Turn order">
              {(['random', 'manual'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onSetTurnOrderMode(mode)}
                  aria-pressed={turnOrderMode === mode}
                  className={`px-2.5 py-1 transition-colors ${
                    turnOrderMode === mode
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {mode === 'random' ? 'Random' : 'Custom'}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {canDrag ? (
          <Reorder.Group axis="y" values={order} onReorder={commit} className="space-y-2">
            {rows}
          </Reorder.Group>
        ) : (
          <div className="space-y-2">{rows}</div>
        )}

        {hasRoom && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-dashed bg-muted/30">
            <div className="w-8 h-8 rounded-full bg-muted flex-shrink-0" />
            <span className="text-muted-foreground text-sm">Waiting…</span>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {turnOrderMode === 'random'
            ? 'Turn order is randomised when the game starts.'
            : isHost
              ? 'Drag players to set the turn order.'
              : 'The host is arranging the turn order.'}
        </p>

        {isHost && turnOrderMode === 'manual' && onSetPlayerOrder && players.length > 1 && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => commit(shuffled(order))}>
            <Shuffle className="h-4 w-4 mr-2" />
            Shuffle
          </Button>
        )}

        {isHost && onAddBot && hasRoom && (
          <div className="flex items-center gap-2 pt-1">
            <Select value={botDifficulty} onValueChange={(v) => setBotDifficulty(v as 'easy' | 'medium' | 'hard')}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="easy">Easy — random moves</SelectItem>
                <SelectItem value="medium">Medium — basic strategy</SelectItem>
                <SelectItem value="hard">Hard — strong play</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="secondary" onClick={() => onAddBot(botDifficulty)} disabled={isLoading}>
              <Plus className="h-4 w-4 mr-1" />
              Add Bot
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
