import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { CustomRules, DEFAULT_RULES } from '@/types/game';
import type { TurnOrderMode } from '@/utils/multiplayerService';
import { LobbyShell } from '@/components/lobby/LobbyShell';
import { LobbyMenu } from '@/components/lobby/LobbyMenu';
import { CreateRoomScreen } from '@/components/lobby/CreateRoomScreen';
import { JoinRoomScreen } from '@/components/lobby/JoinRoomScreen';
import { RulesForm } from '@/components/lobby/RulesForm';
import { WaitingRoom } from '@/components/lobby/WaitingRoom';
import type { LobbyPlayer } from '@/components/lobby/PlayerList';
import type { ActiveGameInfo } from '@/components/lobby/ActiveGameBanner';

interface OnlineLobbyProps {
  roomCode: string | null;
  roomId: string | null;
  players: LobbyPlayer[];
  myPlayerIndex: number | null;
  maxPlayers: number;
  roomRules: CustomRules;
  turnOrderMode: TurnOrderMode;
  isLoading: boolean;
  isCheckingActiveGame?: boolean;
  activeGameInfo?: ActiveGameInfo | null;
  onCreateRoom: (playerName: string, rules: CustomRules) => void;
  onJoinRoom: (code: string, playerName: string) => void;
  onLeaveRoom: () => void;
  onToggleReady: () => void;
  isHost?: boolean;
  onAddBot?: (difficulty: 'easy' | 'medium' | 'hard') => void;
  onRemoveBot?: (playerIndex: number) => void;
  onUpdateRules?: (rules: CustomRules) => void;
  onSetPlayerOrder?: (playerIds: string[]) => void;
  onSetTurnOrderMode?: (mode: TurnOrderMode) => void;
  onRejoinGame?: () => void;
  onDismissActiveGame?: () => void;
}

/**
 * Router for the five lobby screens. Each screen lives in
 * src/components/lobby/; this file only decides which one is showing and holds
 * the handful of values that survive a screen change (the typed name, the
 * pending room code, whether the rules form is open).
 */
export const OnlineLobby = ({
  roomCode,
  players,
  myPlayerIndex,
  maxPlayers,
  roomRules,
  turnOrderMode,
  isLoading,
  isCheckingActiveGame,
  activeGameInfo,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onToggleReady,
  isHost,
  onAddBot,
  onRemoveBot,
  onUpdateRules,
  onSetPlayerOrder,
  onSetTurnOrderMode,
  onRejoinGame,
  onDismissActiveGame,
}: OnlineLobbyProps) => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'menu' | 'create' | 'rules' | 'join'>('menu');
  const [playerName, setPlayerName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [editingRules, setEditingRules] = useState(false);

  const banner = activeGameInfo ?? null;

  // ---- In a room ------------------------------------------------------------
  if (roomCode) {
    if (editingRules) {
      return (
        <LobbyShell onBack={() => setEditingRules(false)} backLabel="Back to room">
          <RulesForm
            mode="edit"
            initialRules={roomRules}
            isLoading={isLoading}
            onCancel={() => setEditingRules(false)}
            onConfirm={(rules) => {
              onUpdateRules?.(rules);
              setEditingRules(false);
            }}
          />
        </LobbyShell>
      );
    }

    return (
      <LobbyShell width="lg">
        <WaitingRoom
          roomCode={roomCode}
          players={players}
          myPlayerIndex={myPlayerIndex}
          capacity={maxPlayers}
          rules={roomRules}
          turnOrderMode={turnOrderMode}
          isHost={isHost}
          isLoading={isLoading}
          onEditRules={onUpdateRules ? () => setEditingRules(true) : undefined}
          onSetTurnOrderMode={onSetTurnOrderMode}
          onSetPlayerOrder={onSetPlayerOrder}
          onAddBot={onAddBot}
          onRemoveBot={onRemoveBot}
          onLeaveRoom={onLeaveRoom}
          onToggleReady={onToggleReady}
        />
      </LobbyShell>
    );
  }

  // ---- Looking for a game we already have ----------------------------------
  if (isCheckingActiveGame) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-cover bg-center bg-no-repeat bg-[linear-gradient(rgba(0,0,0,0.6),rgba(0,0,0,0.6)),url(/Background-image.jpeg)]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Checking for active games...</p>
        </div>
      </div>
    );
  }

  if (mode === 'menu') {
    return (
      <LobbyMenu
        activeGameInfo={banner}
        isLoading={isLoading}
        onCreate={() => setMode('create')}
        onJoin={() => setMode('join')}
        onRejoinGame={onRejoinGame}
        onDismissActiveGame={onDismissActiveGame}
      />
    );
  }

  if (mode === 'create') {
    return (
      <LobbyShell onBack={() => setMode('menu')}>
        <CreateRoomScreen
          playerName={playerName}
          onPlayerNameChange={setPlayerName}
          onContinue={() => {
            if (!playerName.trim()) {
              toast({ title: 'Enter your name', variant: 'destructive' });
              return;
            }
            setMode('rules');
          }}
          activeGameInfo={banner}
          isLoading={isLoading}
          onRejoinGame={onRejoinGame}
          onDismissActiveGame={onDismissActiveGame}
        />
      </LobbyShell>
    );
  }

  if (mode === 'rules') {
    // Confirming here creates the room — the name is already known and there is
    // no player count, so this is the only commit point. Backing out abandons
    // room creation entirely, which is why nothing warns about lost changes.
    return (
      <LobbyShell onBack={() => setMode('create')}>
        <RulesForm
          mode="create"
          initialRules={DEFAULT_RULES}
          isLoading={isLoading}
          onCancel={() => setMode('create')}
          onConfirm={(rules) => onCreateRoom(playerName.trim(), rules)}
        />
      </LobbyShell>
    );
  }

  return (
    <LobbyShell onBack={() => setMode('menu')}>
      <JoinRoomScreen
        playerName={playerName}
        onPlayerNameChange={setPlayerName}
        joinCode={joinCode}
        onJoinCodeChange={setJoinCode}
        onJoin={() => {
          if (!playerName.trim()) {
            toast({ title: 'Enter your name', variant: 'destructive' });
            return;
          }
          if (joinCode.trim().length < 6) {
            toast({ title: 'Enter a valid room code', variant: 'destructive' });
            return;
          }
          onJoinRoom(joinCode.trim(), playerName.trim());
        }}
        isLoading={isLoading}
        activeGameInfo={banner}
        onRejoinGame={onRejoinGame}
        onDismissActiveGame={onDismissActiveGame}
      />
    </LobbyShell>
  );
};
