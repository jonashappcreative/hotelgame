import { useState, useEffect, useCallback } from 'react';
import {
  GameState,
  TileId,
  ChainName,
  MergerStockDecision,
  CustomRules,
  DEFAULT_RULES,
} from '@/types/game';
import {
  initializeGame,
  analyzeTilePlacement,
  getAvailableChainsForFoundation,
  checkGameEnd,
  calculateFinalScores,
} from '@/utils/gameLogic';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoomRoster,
  getSecurePlayerData,
  executeGameAction,
  addBot,
  removeBot,
  dbToGameState,
  subscribeToRoom,
  getOrCreateAuthSession,
  getCurrentUserId,
  toggleReady,
  checkActiveGame,
  sendHeartbeat,
  markDisconnected,
  clearActiveGameFromStorage,
  getPublicGameState,
  getRoomStatus,
  fetchRoomRules,
  updateRoomRules,
  setPlayerOrder,
  setTurnOrderMode,
  type TurnOrderMode,
} from '@/utils/multiplayerService';
import { toast } from '@/hooks/use-toast';

interface OnlinePlayer {
  id: string;
  player_name: string;
  player_index: number;
  is_ready: boolean;
  is_bot?: boolean;
  bot_difficulty?: string | null;
}

/** Rooms are always created at capacity; the host no longer picks a count. */
const ROOM_CAPACITY = 6;

export const useOnlineGame = () => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [players, setPlayers] = useState<OnlinePlayer[]>([]);
  const [myPlayerIndex, setMyPlayerIndex] = useState<number | null>(null);
  const [maxPlayers, setMaxPlayers] = useState<number>(ROOM_CAPACITY);
  const [roomStatus, setRoomStatus] = useState<'waiting' | 'playing' | 'finished'>('waiting');
  const [roomRules, setRoomRules] = useState<CustomRules>(DEFAULT_RULES);
  const [turnOrderMode, setTurnOrderModeState] = useState<TurnOrderMode>('random');
  // Told to us by the server (game_rooms.host_user_id), never inferred from a
  // seat — the host can sit anywhere in the turn order.
  const [isHost, setIsHost] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingActiveGame, setIsCheckingActiveGame] = useState(true);
  const [activeGameInfo, setActiveGameInfo] = useState<{
    roomCode: string;
    roomId: string;
    playerName: string;
    roomStatus: string;
  } | null>(null);

  // Check for active games on mount
  useEffect(() => {
    const checkForActiveGame = async () => {
      try {
        const result = await checkActiveGame();
        if (result?.hasActiveGame && result.roomCode && result.roomId) {
          setActiveGameInfo({
            roomCode: result.roomCode,
            roomId: result.roomId,
            playerName: result.playerName || 'Player',
            roomStatus: result.roomStatus || 'waiting',
          });
        }
      } catch (error) {
        console.error('[useOnlineGame] Error checking for active game:', error);
      } finally {
        setIsCheckingActiveGame(false);
      }
    };

    checkForActiveGame();
  }, []);

  // Heartbeat mechanism - send every 15 seconds while in a room
  useEffect(() => {
    if (!roomId) return;

    // Send initial heartbeat
    sendHeartbeat(roomId);

    const heartbeatInterval = setInterval(() => {
      sendHeartbeat(roomId);
    }, 15000); // Every 15 seconds

    // Mark as disconnected when leaving the page
    const handleBeforeUnload = () => {
      markDisconnected(roomId);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Page is being hidden - could be closing or switching tabs
        // We'll mark as potentially disconnected, but heartbeat will restore on return
        markDisconnected(roomId);
      } else if (document.visibilityState === 'visible') {
        // Page is visible again - send heartbeat to mark as connected
        sendHeartbeat(roomId);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(heartbeatInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // Mark disconnected when unmounting (leaving the game page)
      markDisconnected(roomId);
    };
  }, [roomId]);

  // Subscribe to room changes
  useEffect(() => {
    if (!roomId) return;

    const unsubscribe = subscribeToRoom(
      roomId,
      (roster) => {
        setPlayers(roster.players);
        // Seats move — a host reorder, or the shuffle at game start — so the
        // seat is re-derived here rather than trusted from the join response.
        if (roster.myPlayerIndex !== null) setMyPlayerIndex(roster.myPlayerIndex);
        // Rules and turn order ride along on the same signal, so an edit by the
        // host reaches every player without a manual refresh.
        void refreshRoomInfo(roomId);
      },
      async (dbState) => {
        // The relay only signals a change; subscribeToRoom fetches the
        // authoritative public state and passes it here.
        try {
          const { players: freshPlayers, myPlayerIndex: freshIndex } = await fetchFullPlayerData(roomId);
          if (freshIndex !== null) setMyPlayerIndex(freshIndex);
          if (dbState && roomCode) {
            const fullState = dbToGameState(dbState, freshPlayers, roomCode);
            setGameState(fullState);
          }
        } catch (error) {
          console.error('[useOnlineGame] Error refreshing game state:', error);
        }
      },
      (status) => {
        setRoomStatus(status as 'waiting' | 'playing' | 'finished');
        // Clear localStorage when game finishes
        if (status === 'finished') {
          clearActiveGameFromStorage();
        }
      }
    );

    return unsubscribe;
  }, [roomId, roomCode]);

  // Fetch player data securely - only own tiles visible, opponents' tiles
  // hidden. Also carries the caller's own seat, resolved server-side.
  const fetchFullPlayerData = async (rId: string) => {
    return await getSecurePlayerData(rId);
  };

  // Pull the room's rules, turn-order mode and host flag in one call. Host
  // status comes from the server (game_rooms.host_user_id) rather than being
  // inferred from a seat, so it survives any reseat.
  const refreshRoomInfo = useCallback(async (rId: string) => {
    const room = await getRoomStatus(rId);
    if (!room) return null;
    setMaxPlayers(room.max_players);
    setRoomRules(room.customRules);
    setTurnOrderModeState(room.turnOrderMode);
    setIsHost(room.isHost);
    return room;
  }, []);

  const handleCreateRoom = useCallback(async (playerName: string, rules: CustomRules = DEFAULT_RULES) => {
    setIsLoading(true);
    try {
      // Confirming the rules *is* room creation since Epic 15 — there is no
      // separate "Create Room" step and no player count to answer for.
      const result = await createRoom(rules);
      if (!result) {
        toast({ title: 'Error', description: 'Failed to create room', variant: 'destructive' });
        return;
      }

      const joinResult = await joinRoom(result.roomCode, playerName);
      if (!joinResult.success) {
        toast({ title: 'Error', description: joinResult.error, variant: 'destructive' });
        return;
      }

      setRoomId(result.roomId);
      setRoomCode(result.roomCode);
      setMyPlayerIndex(joinResult.playerIndex!);

      const roster = await getRoomRoster(result.roomId);
      setPlayers(roster.players);
      if (roster.myPlayerIndex !== null) setMyPlayerIndex(roster.myPlayerIndex);
      await refreshRoomInfo(result.roomId);

      toast({ title: 'Room Created', description: `Share code: ${result.roomCode}` });
    } finally {
      setIsLoading(false);
    }
  }, [refreshRoomInfo]);

  const handleJoinRoom = useCallback(async (code: string, playerName: string) => {
    setIsLoading(true);
    try {
      const result = await joinRoom(code.toUpperCase(), playerName);
      if (!result.success) {
        toast({ title: 'Error', description: result.error, variant: 'destructive' });
        return;
      }

      setRoomId(result.roomId!);
      setRoomCode(code.toUpperCase());
      setMyPlayerIndex(result.playerIndex!);

      const roster = await getRoomRoster(result.roomId!);
      setPlayers(roster.players);
      if (roster.myPlayerIndex !== null) setMyPlayerIndex(roster.myPlayerIndex);

      const room = await refreshRoomInfo(result.roomId!);
      if (room?.status === 'playing') {
        setRoomStatus('playing');
        const dbState = await getPublicGameState(result.roomId!);
        if (dbState) {
          const { players: fullPlayers, myPlayerIndex: seat } = await fetchFullPlayerData(result.roomId!);
          if (seat !== null) setMyPlayerIndex(seat);
          setGameState(dbToGameState(dbState, fullPlayers, code.toUpperCase()));
        }
      }

      toast({ title: 'Joined Room', description: `Welcome, ${playerName}!` });
    } finally {
      setIsLoading(false);
    }
  }, [refreshRoomInfo]);

  const handleLeaveRoom = useCallback(async () => {
    if (!roomId) return;
    await leaveRoom(roomId);
    setRoomId(null);
    setRoomCode(null);
    setPlayers([]);
    setMyPlayerIndex(null);
    setGameState(null);
    setRoomStatus('waiting');
    setRoomRules(DEFAULT_RULES);
    setTurnOrderModeState('random');
    setIsHost(false);
  }, [roomId]);

  const handleToggleReady = useCallback(async () => {
    if (!roomId) return;

    setIsLoading(true);
    try {
      const result = await toggleReady(roomId);

      if (!result.success) {
        toast({ title: 'Error', description: result.error || 'Failed to toggle ready', variant: 'destructive' });
        return;
      }

      if (result.gameStarted) {
        // Game auto-started because all players were ready
        // The subscription will handle state transition, but fetch immediately too
        const dbState = await getPublicGameState(roomId);

        if (dbState && roomCode) {
          const { players: fullPlayers, myPlayerIndex: seat } = await fetchFullPlayerData(roomId);
          if (seat !== null) setMyPlayerIndex(seat);
          setGameState(dbToGameState(dbState, fullPlayers, roomCode));
        }

        setRoomStatus('playing');
        // Seats may have just been shuffled, so name whoever now holds seat 0.
        const firstUp = (await getRoomRoster(roomId)).players.find(p => p.player_index === 0);
        toast({ title: 'Game Started!', description: `${firstUp?.player_name ?? 'First player'}'s turn` });
      }
    } finally {
      setIsLoading(false);
    }
  }, [roomId, roomCode]);

  const handleAddBot = useCallback(async (difficulty: 'easy' | 'medium' | 'hard') => {
    if (!roomId) return;
    const result = await addBot(roomId, difficulty);
    if (!result.success) {
      toast({ title: 'Error', description: result.error || 'Failed to add bot', variant: 'destructive' });
      return;
    }
    // The relay broadcasts players_changed, but refresh immediately too.
    setPlayers((await getRoomRoster(roomId)).players);
  }, [roomId]);

  const handleRemoveBot = useCallback(async (playerIndex: number) => {
    if (!roomId) return;
    const result = await removeBot(roomId, playerIndex);
    if (!result.success) {
      toast({ title: 'Error', description: result.error || 'Failed to remove bot', variant: 'destructive' });
      return;
    }
    setPlayers((await getRoomRoster(roomId)).players);
  }, [roomId]);

  // Resume bot turns paused by the server's per-invocation budget. Server-side
  // driveBots plays bots inline after each human action, but a long all-bot
  // stretch can exceed the function time limit and pause with a bot still to
  // act. Exactly one human (the lowest-seat human) nudges via `bot_tick`.
  useEffect(() => {
    if (roomStatus !== 'playing' || !gameState || myPlayerIndex == null || !roomId) return;

    const actorIndex = gameState.phase === 'merger_handle_stock'
      ? gameState.merger?.currentPlayerIndex
      : gameState.currentPlayerIndex;
    const actor = players.find((p) => p.player_index === actorIndex);
    if (!actor?.is_bot) return;

    const humanSeats = players.filter((p) => !p.is_bot).map((p) => p.player_index).sort((a, b) => a - b);
    if (humanSeats[0] !== myPlayerIndex) return; // only the primary human nudges

    const timer = setTimeout(() => { executeGameAction('bot_tick', roomId); }, 1500);
    return () => clearTimeout(timer);
  }, [gameState, players, roomStatus, myPlayerIndex, roomId]);

  // Refresh game state from database
  const refreshGameState = useCallback(async () => {
    if (!roomId || !roomCode) return;

    const dbState = await getPublicGameState(roomId);

    if (dbState) {
      const { players: fullPlayers, myPlayerIndex: seat } = await fetchFullPlayerData(roomId);
      if (seat !== null) setMyPlayerIndex(seat);
      const fullState = dbToGameState(dbState, fullPlayers, roomCode);
      setGameState(fullState);
    }
  }, [roomId, roomCode]);

  const handleTilePlacement = useCallback(async (tileId: TileId) => {
    if (!gameState || !roomId) return;

    // Check if it's my turn
    if (gameState.currentPlayerIndex !== myPlayerIndex) {
      toast({ title: 'Not Your Turn', variant: 'destructive' });
      return;
    }

    // Client-side validation
    const analysis = analyzeTilePlacement(gameState, tileId);
    if (!analysis.valid) {
      toast({ title: 'Invalid Move', description: analysis.reason, variant: 'destructive' });
      return;
    }

    const result = await executeGameAction('place_tile', roomId, { tileId });
    
    if (!result.success) {
      toast({ title: 'Error', description: result.error, variant: 'destructive' });
      return;
    }

    // Refresh state from server
    await refreshGameState();
  }, [gameState, roomId, myPlayerIndex, refreshGameState]);

  const handleFoundChain = useCallback(async (chainName: ChainName) => {
    if (!gameState || !roomId) return;

    if (gameState.currentPlayerIndex !== myPlayerIndex) {
      toast({ title: 'Not Your Turn', variant: 'destructive' });
      return;
    }

    const result = await executeGameAction('found_chain', roomId, { chainName });
    
    if (!result.success) {
      toast({ title: 'Error', description: result.error, variant: 'destructive' });
      return;
    }

    toast({ title: `${chainName} Founded!`, description: 'You received 1 bonus share.' });
    await refreshGameState();
  }, [gameState, roomId, myPlayerIndex, refreshGameState]);

  const handleChooseMergerSurvivor = useCallback(async (survivingChain: ChainName) => {
    if (!gameState || !roomId) return;

    if (gameState.currentPlayerIndex !== myPlayerIndex) {
      toast({ title: 'Not Your Turn', variant: 'destructive' });
      return;
    }

    // Server recomputes adjacent chains from last_placed_tile — only survivingChain is needed
    const result = await executeGameAction('choose_merger_survivor', roomId, { survivingChain });
    
    if (!result.success) {
      toast({ title: 'Error', description: result.error, variant: 'destructive' });
      return;
    }

    await refreshGameState();
  }, [gameState, roomId, myPlayerIndex, refreshGameState]);

  const handlePayMergerBonuses = useCallback(async () => {
    if (!gameState || !roomId || !gameState.merger?.currentDefunctChain) return;

    if (gameState.currentPlayerIndex !== myPlayerIndex) {
      toast({ title: 'Not Your Turn', variant: 'destructive' });
      return;
    }

    const result = await executeGameAction('pay_merger_bonuses', roomId);
    
    if (!result.success) {
      toast({ title: 'Error', description: result.error, variant: 'destructive' });
      return;
    }

    await refreshGameState();
  }, [gameState, roomId, myPlayerIndex, refreshGameState]);

  const handleMergerStockChoice = useCallback(async (decision: MergerStockDecision) => {
    if (!gameState || !roomId || !gameState.merger) return;

    if (gameState.merger.currentPlayerIndex !== myPlayerIndex) {
      toast({ title: 'Not Your Turn', variant: 'destructive' });
      return;
    }

    const result = await executeGameAction('merger_stock_choice', roomId, { decision });
    
    if (!result.success) {
      toast({ title: 'Error', description: result.error, variant: 'destructive' });
      return;
    }

    await refreshGameState();
  }, [gameState, roomId, myPlayerIndex, refreshGameState]);

  const handleBuyStocks = useCallback(async (purchases: { chain: ChainName; quantity: number }[]) => {
    if (!gameState || !roomId) return;

    if (gameState.currentPlayerIndex !== myPlayerIndex) {
      toast({ title: 'Not Your Turn', variant: 'destructive' });
      return;
    }

    const result = await executeGameAction('buy_stocks', roomId, { purchases });
    
    if (!result.success) {
      toast({ title: 'Error', description: result.error, variant: 'destructive' });
      return;
    }

    await refreshGameState();

    // The turn only ends here when the buy used up the per-turn cap or left
    // nothing affordable; otherwise the player stays in the buy phase.
    if (result.turnEnded === false) return;

    // Show next player's turn
    const nextPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    toast({ title: 'Turn Complete', description: `${gameState.players[nextPlayerIndex].name}'s turn` });
  }, [gameState, roomId, myPlayerIndex, refreshGameState]);

  // Selling never ends the turn or changes the phase — it just settles and the
  // panel re-reads the refreshed state. A rejection leaves the player's pending
  // selection alone so they can correct it.
  const handleSellStocks = useCallback(async (sales: { chain: ChainName; quantity: number }[]) => {
    if (!gameState || !roomId) return;

    if (gameState.currentPlayerIndex !== myPlayerIndex) {
      toast({ title: 'Not Your Turn', variant: 'destructive' });
      return;
    }

    const result = await executeGameAction('sell_stocks', roomId, { sales });

    if (!result.success) {
      toast({ title: 'Sale rejected', description: result.error, variant: 'destructive' });
      // The player row is written before the bank, so a partial failure leaves
      // the display stale until we re-read; cheap enough to always do it.
      await refreshGameState();
      return;
    }

    await refreshGameState();
  }, [gameState, roomId, myPlayerIndex, refreshGameState]);

  const handleSkipBuyStock = useCallback(async () => {
    if (!gameState || !roomId) return;

    if (gameState.currentPlayerIndex !== myPlayerIndex) {
      toast({ title: 'Not Your Turn', variant: 'destructive' });
      return;
    }

    const result = await executeGameAction('skip_buy', roomId);
    
    if (!result.success) {
      toast({ title: 'Error', description: result.error, variant: 'destructive' });
      return;
    }

    await refreshGameState();
    
    const nextPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    toast({ title: 'Turn Complete', description: `${gameState.players[nextPlayerIndex].name}'s turn` });
  }, [gameState, roomId, myPlayerIndex, refreshGameState]);

  const handleDiscardTile = useCallback(async (tileId: TileId) => {
    if (!gameState || !roomId) return;

    if (gameState.currentPlayerIndex !== myPlayerIndex) {
      toast({
        title: 'Not Your Turn',
        description: 'You can only discard tiles during your turn',
        variant: 'destructive',
      });
      return;
    }

    console.log('[useOnlineGame] Discarding tile:', tileId);

    try {
      const result = await executeGameAction('discard_tile', roomId, { tileId });

      if (!result.success) {
        toast({
          title: 'Error Discarding Tile',
          description: result.error || 'Failed to discard tile',
          variant: 'destructive',
        });
        return;
      }

      // Refresh game state to get updated tile hand
      await refreshGameState();

      console.log('[useOnlineGame] Tile discarded successfully');
    } catch (error) {
      console.error('[useOnlineGame] Error discarding tile:', error);
      toast({
        title: 'Error',
        description: 'Failed to discard tile',
        variant: 'destructive',
      });
    }
  }, [gameState, roomId, myPlayerIndex, refreshGameState]);

  const handleEndGameVote = useCallback(async (vote: boolean) => {
    if (!gameState || !roomId || myPlayerIndex === null) return;

    const result = await executeGameAction('end_game_vote', roomId, { vote });
    
    if (!result.success) {
      toast({ title: 'Error', description: result.error, variant: 'destructive' });
      return;
    }

    const botCount = players.filter(p => p.is_bot).length;
    const humanCount = gameState.players.length - botCount;
    const votesNeeded = Math.max(1, Math.ceil(humanCount / 2));
    const currentVotes = gameState.endGameVotes.length + (vote ? 1 : 0);
    
    if (currentVotes >= votesNeeded) {
      toast({ title: 'Game Ended', description: 'Players voted to end the game' });
    } else {
      toast({ title: 'Vote Recorded', description: `${currentVotes}/${votesNeeded} votes` });
    }

    await refreshGameState();
  }, [gameState, roomId, myPlayerIndex, refreshGameState]);

  const handleNewGame = useCallback(async () => {
    if (!roomId) return;

    const result = await executeGameAction('new_game', roomId);

    if (!result.success) {
      toast({ title: 'Error', description: result.error, variant: 'destructive' });
      return;
    }

    setGameState(null);
    setRoomStatus('waiting');
  }, [roomId]);

  const handleAutoEndTurn = useCallback(async () => {
    if (!gameState || !roomId) return;

    if (gameState.currentPlayerIndex !== myPlayerIndex) return;

    const result = await executeGameAction('auto_end_turn', roomId);

    if (!result.success) {
      console.warn('[useOnlineGame] auto_end_turn failed:', result.error);
      return;
    }

    await refreshGameState();
  }, [gameState, roomId, myPlayerIndex, refreshGameState]);

  // Rejoin an active game
  const handleRejoinGame = useCallback(async () => {
    if (!activeGameInfo) return;

    setIsLoading(true);
    try {
      const result = await joinRoom(activeGameInfo.roomCode, activeGameInfo.playerName);
      if (!result.success) {
        toast({ title: 'Error', description: result.error, variant: 'destructive' });
        setActiveGameInfo(null);
        return;
      }

      setRoomId(result.roomId!);
      setRoomCode(activeGameInfo.roomCode);
      setMyPlayerIndex(result.playerIndex!);

      // The seat comes from the roster, not the join response: if the room was
      // reseated (or shuffled at start) while we were away, the cached index
      // would be someone else's.
      const roster = await getRoomRoster(result.roomId!);
      setPlayers(roster.players);
      if (roster.myPlayerIndex !== null) setMyPlayerIndex(roster.myPlayerIndex);

      const room = await refreshRoomInfo(result.roomId!);
      if (room) {
        setRoomStatus(room.status);
        if (room.status === 'playing') {
          const dbState = await getPublicGameState(result.roomId!);
          if (dbState) {
            const { players: fullPlayers, myPlayerIndex: seat } = await fetchFullPlayerData(result.roomId!);
            if (seat !== null) setMyPlayerIndex(seat);
            setGameState(dbToGameState(dbState, fullPlayers, activeGameInfo.roomCode));
          }
        }
      }

      setActiveGameInfo(null);
      toast({ title: 'Rejoined Game', description: `Welcome back, ${activeGameInfo.playerName}!` });
    } finally {
      setIsLoading(false);
    }
  }, [activeGameInfo, refreshRoomInfo]);

  // ---- Waiting-room configuration (host only; the server enforces that) -----

  const handleUpdateRules = useCallback(async (rules: CustomRules) => {
    if (!roomId) return;
    const result = await updateRoomRules(roomId, rules);
    if (!result.success) {
      toast({ title: 'Could not save rules', description: result.error, variant: 'destructive' });
      return;
    }
    setRoomRules(rules);
    toast({ title: 'Rules updated' });
  }, [roomId]);

  const handleSetPlayerOrder = useCallback(async (playerIds: string[]) => {
    if (!roomId) return;
    // Show the new order straight away; the broadcast confirms it.
    setPlayers((prev) => playerIds
      .map((id, index) => {
        const player = prev.find((p) => p.id === id);
        return player ? { ...player, player_index: index } : null;
      })
      .filter((p): p is OnlinePlayer => p !== null));

    const result = await setPlayerOrder(roomId, playerIds);
    if (!result.success) {
      toast({ title: 'Could not reorder players', description: result.error, variant: 'destructive' });
    }
    const roster = await getRoomRoster(roomId);
    setPlayers(roster.players);
    if (roster.myPlayerIndex !== null) setMyPlayerIndex(roster.myPlayerIndex);
    setTurnOrderModeState('manual');
  }, [roomId]);

  const handleSetTurnOrderMode = useCallback(async (mode: TurnOrderMode) => {
    if (!roomId) return;
    setTurnOrderModeState(mode);
    const result = await setTurnOrderMode(roomId, mode);
    if (!result.success) {
      toast({ title: 'Could not change turn order', description: result.error, variant: 'destructive' });
      await refreshRoomInfo(roomId);
    }
  }, [roomId, refreshRoomInfo]);

  // Dismiss active game notification
  const dismissActiveGame = useCallback(() => {
    setActiveGameInfo(null);
  }, []);

  return {
    // State
    gameState,
    roomId,
    roomCode,
    players,
    myPlayerIndex,
    maxPlayers,
    roomStatus,
    isLoading,
    isMyTurn: gameState?.currentPlayerIndex === myPlayerIndex,
    roomRules,
    turnOrderMode,
    isHost,

    // Reconnection state
    isCheckingActiveGame,
    activeGameInfo,

    // Lobby actions
    handleCreateRoom,
    handleJoinRoom,
    handleLeaveRoom,
    handleToggleReady,
    handleAddBot,
    handleRemoveBot,
    handleUpdateRules,
    handleSetPlayerOrder,
    handleSetTurnOrderMode,

    // Reconnection actions
    handleRejoinGame,
    dismissActiveGame,

    // Game actions
    handleTilePlacement,
    handleDiscardTile,
    handleFoundChain,
    handleChooseMergerSurvivor,
    handlePayMergerBonuses,
    handleMergerStockChoice,
    handleBuyStocks,
    handleSellStocks,
    handleSkipBuyStock,
    handleEndGameVote,
    handleNewGame,
    handleAutoEndTurn,

    getAvailableChains: gameState ? () => getAvailableChainsForFoundation(gameState) : () => [],
  };
};
