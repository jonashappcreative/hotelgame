import { useState, useEffect, useCallback } from 'react';
import { 
  GameState, 
  TileId, 
  ChainName,
  MergerStockDecision,
} from '@/types/game';
import {
  initializeGame,
  placeTile,
  foundChain,
  growChain,
  buyStocks,
  endTurn,
  analyzeTilePlacement,
  getAvailableChainsForFoundation,
  checkGameEnd,
  calculateFinalScores,
} from '@/utils/gameLogic';
import {
  analyzeMerger,
  initializeMerger,
  payMergerBonuses,
  handleMergerStockDecision,
  completeMerger,
  getPlayersWithStock,
} from '@/utils/mergerLogic';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoomPlayers,
  startGame as startOnlineGame,
  updateGameState,
  dbToGameState,
  subscribeToRoom,
  getSessionId,
} from '@/utils/multiplayerService';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface OnlinePlayer {
  id: string;
  player_name: string;
  player_index: number;
}

export const useOnlineGame = () => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [players, setPlayers] = useState<OnlinePlayer[]>([]);
  const [myPlayerIndex, setMyPlayerIndex] = useState<number | null>(null);
  const [roomStatus, setRoomStatus] = useState<'waiting' | 'playing' | 'finished'>('waiting');
  const [isLoading, setIsLoading] = useState(false);

  const sessionId = getSessionId();

  // Subscribe to room changes
  useEffect(() => {
    if (!roomId) return;

    const unsubscribe = subscribeToRoom(
      roomId,
      (newPlayers) => {
        setPlayers(newPlayers);
      },
      async (newState) => {
        // Fetch fresh player data to construct complete game state
        const freshPlayers = await fetchFullPlayerData(roomId);
        if (newState && roomCode) {
          const fullState = dbToGameState(newState, freshPlayers, roomCode);
          setGameState(fullState);
        }
      },
      (status) => {
        setRoomStatus(status as 'waiting' | 'playing' | 'finished');
      }
    );

    return unsubscribe;
  }, [roomId, roomCode]);

  const fetchFullPlayerData = async (rId: string) => {
    const { data } = await supabase
      .from('game_players')
      .select('*')
      .eq('room_id', rId)
      .order('player_index');
    return data || [];
  };

  const handleCreateRoom = useCallback(async (playerName: string) => {
    setIsLoading(true);
    try {
      const result = await createRoom();
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

      const currentPlayers = await getRoomPlayers(result.roomId);
      setPlayers(currentPlayers);

      toast({ title: 'Room Created', description: `Share code: ${result.roomCode}` });
    } finally {
      setIsLoading(false);
    }
  }, []);

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

      const currentPlayers = await getRoomPlayers(result.roomId!);
      setPlayers(currentPlayers);

      // Check if game already started
      const { data: room } = await supabase
        .from('game_rooms')
        .select('status')
        .eq('id', result.roomId!)
        .single();

      if (room?.status === 'playing') {
        setRoomStatus('playing');
        // Fetch game state
        const { data: dbState } = await supabase
          .from('game_states')
          .select('*')
          .eq('room_id', result.roomId!)
          .single();
        
        if (dbState) {
          const fullPlayers = await fetchFullPlayerData(result.roomId!);
          const fullState = dbToGameState(dbState, fullPlayers, code.toUpperCase());
          setGameState(fullState);
        }
      }

      toast({ title: 'Joined Room', description: `Welcome, ${playerName}!` });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleLeaveRoom = useCallback(async () => {
    if (!roomId) return;
    await leaveRoom(roomId);
    setRoomId(null);
    setRoomCode(null);
    setPlayers([]);
    setMyPlayerIndex(null);
    setGameState(null);
    setRoomStatus('waiting');
  }, [roomId]);

  const handleStartGame = useCallback(async () => {
    if (!roomId || !roomCode || players.length !== 4) {
      toast({ 
        title: 'Cannot Start', 
        description: 'Need exactly 4 players', 
        variant: 'destructive' 
      });
      return;
    }

    setIsLoading(true);
    try {
      const playerNames = players.map(p => p.player_name);
      const newGame = initializeGame(playerNames);
      newGame.roomCode = roomCode;

      const success = await startOnlineGame(roomId, newGame);
      if (!success) {
        toast({ title: 'Error', description: 'Failed to start game', variant: 'destructive' });
        return;
      }

      setGameState(newGame);
      setRoomStatus('playing');
      toast({ title: 'Game Started!', description: `${playerNames[0]}'s turn` });
    } finally {
      setIsLoading(false);
    }
  }, [roomId, roomCode, players]);

  // Game action wrapper that syncs to database
  const syncGameAction = useCallback(async (
    action: (state: GameState) => GameState | null
  ) => {
    if (!gameState || !roomId) return;

    // Check if it's my turn (for most actions)
    const isMyTurn = gameState.currentPlayerIndex === myPlayerIndex;
    const isMergerStockPhase = gameState.phase === 'merger_handle_stock';
    const isMyMergerTurn = isMergerStockPhase && 
      gameState.merger?.currentPlayerIndex === myPlayerIndex;

    if (!isMyTurn && !isMyMergerTurn) {
      toast({ title: 'Not Your Turn', variant: 'destructive' });
      return;
    }

    const newState = action(gameState);
    if (newState) {
      setGameState(newState);
      await updateGameState(roomId, newState);
    }
  }, [gameState, roomId, myPlayerIndex]);

  const handleTilePlacement = useCallback((tileId: TileId) => {
    syncGameAction((state) => {
      const analysis = analyzeTilePlacement(state, tileId);
      if (!analysis.valid) {
        toast({ title: 'Invalid Move', description: analysis.reason, variant: 'destructive' });
        return null;
      }

      let newState = placeTile(state, tileId);

      if (analysis.action === 'form_chain') {
        newState.phase = 'found_chain';
        newState.pendingChainFoundation = [tileId, ...analysis.adjacentUnincorporated];
        return newState;
      }

      if (analysis.action === 'grow_chain') {
        const chainToGrow = analysis.adjacentChains[0];
        newState = growChain(newState, chainToGrow);
        newState.gameLog = [
          ...newState.gameLog,
          {
            timestamp: Date.now(),
            playerId: newState.players[newState.currentPlayerIndex].id,
            playerName: newState.players[newState.currentPlayerIndex].name,
            action: `Extended ${chainToGrow}`,
            details: `Chain now has ${newState.chains[chainToGrow].tiles.length} tiles`,
          },
        ];
      }

      if (analysis.action === 'merge_chains') {
        const mergerAnalysis = analyzeMerger(newState, tileId, analysis.adjacentChains);
        
        if (!mergerAnalysis.canMerge) {
          toast({ title: 'Invalid Merger', description: mergerAnalysis.reason, variant: 'destructive' });
          return null;
        }

        newState.mergerAdjacentChains = analysis.adjacentChains;

        if (mergerAnalysis.tieBreakerNeeded) {
          newState.phase = 'merger_choose_survivor';
          return newState;
        } else {
          const survivingChain = mergerAnalysis.potentialSurvivors[0];
          newState.merger = initializeMerger(newState, analysis.adjacentChains, survivingChain);
          newState.phase = 'merger_pay_bonuses';
        }
      }

      if (analysis.action === 'place_only') {
        newState.phase = 'buy_stock';
      }

      if (checkGameEnd(newState)) {
        newState.phase = 'game_over';
        newState.winner = calculateFinalScores(newState)[0].name;
      }

      return newState;
    });
  }, [syncGameAction]);

  const handleFoundChain = useCallback((chainName: ChainName) => {
    syncGameAction((state) => {
      const newState = foundChain(state, chainName);
      if (checkGameEnd(newState)) {
        newState.phase = 'game_over';
        newState.winner = calculateFinalScores(newState)[0].name;
      }
      toast({ title: `${chainName} Founded!`, description: 'You received 1 bonus share.' });
      return newState;
    });
  }, [syncGameAction]);

  const handleChooseMergerSurvivor = useCallback((survivingChain: ChainName) => {
    syncGameAction((state) => {
      if (!state.mergerAdjacentChains) return null;
      const newState = { ...state };
      newState.merger = initializeMerger(newState, state.mergerAdjacentChains, survivingChain);
      newState.phase = 'merger_pay_bonuses';
      return newState;
    });
  }, [syncGameAction]);

  const handlePayMergerBonuses = useCallback(() => {
    syncGameAction((state) => {
      if (!state.merger?.currentDefunctChain) return null;

      let newState = payMergerBonuses(state, state.merger.currentDefunctChain);
      newState.merger = { ...newState.merger!, bonusesPaid: true };
      
      const playersWithShares = getPlayersWithStock(newState, newState.merger.currentDefunctChain!);
      
      if (playersWithShares.length === 0) {
        const currentDefunctIndex = newState.merger.defunctChains.indexOf(newState.merger.currentDefunctChain!);
        if (currentDefunctIndex < newState.merger.defunctChains.length - 1) {
          newState.merger.currentDefunctChain = newState.merger.defunctChains[currentDefunctIndex + 1];
          newState.merger.bonusesPaid = false;
        } else {
          newState = completeMerger(newState);
        }
      } else {
        newState.merger.currentPlayerIndex = state.currentPlayerIndex;
        if (!playersWithShares.includes(newState.merger.currentPlayerIndex)) {
          for (let i = 0; i < newState.players.length; i++) {
            const idx = (state.currentPlayerIndex + i) % newState.players.length;
            if (playersWithShares.includes(idx)) {
              newState.merger.currentPlayerIndex = idx;
              break;
            }
          }
        }
        newState.phase = 'merger_handle_stock';
      }

      return newState;
    });
  }, [syncGameAction]);

  const handleMergerStockChoice = useCallback((decision: MergerStockDecision) => {
    // Special handling - allow if it's this player's merger turn
    if (!gameState || !roomId || !gameState.merger) return;

    if (gameState.merger.currentPlayerIndex !== myPlayerIndex) {
      toast({ title: 'Not Your Turn', variant: 'destructive' });
      return;
    }

    const processDecision = (state: GameState): GameState | null => {
      let newState = handleMergerStockDecision(
        state, 
        state.merger!.currentPlayerIndex, 
        decision
      );
      
      const defunctChain = newState.merger!.currentDefunctChain!;
      const startPlayerIndex = state.currentPlayerIndex;
      let nextIndex = (newState.merger!.currentPlayerIndex + 1) % newState.players.length;
      let foundNext = false;
      
      while (nextIndex !== startPlayerIndex) {
        if (newState.players[nextIndex].stocks[defunctChain] > 0) {
          newState.merger = { ...newState.merger!, currentPlayerIndex: nextIndex };
          foundNext = true;
          break;
        }
        nextIndex = (nextIndex + 1) % newState.players.length;
      }
      
      if (!foundNext && newState.players[startPlayerIndex].stocks[defunctChain] > 0 && 
          startPlayerIndex !== state.merger!.currentPlayerIndex) {
        newState.merger = { ...newState.merger!, currentPlayerIndex: startPlayerIndex };
        foundNext = true;
      }

      if (!foundNext) {
        const currentDefunctIndex = newState.merger!.defunctChains.indexOf(defunctChain);
        if (currentDefunctIndex < newState.merger!.defunctChains.length - 1) {
          newState.merger = {
            ...newState.merger!,
            currentDefunctChain: newState.merger!.defunctChains[currentDefunctIndex + 1],
            currentPlayerIndex: startPlayerIndex,
            bonusesPaid: false,
          };
          newState.phase = 'merger_pay_bonuses';
        } else {
          newState = completeMerger(newState);
        }
      }

      if (newState.phase === 'buy_stock' && checkGameEnd(newState)) {
        newState.phase = 'game_over';
        newState.winner = calculateFinalScores(newState)[0].name;
      }

      return newState;
    };

    const newState = processDecision(gameState);
    if (newState) {
      setGameState(newState);
      updateGameState(roomId, newState);
    }
  }, [gameState, roomId, myPlayerIndex]);

  const handleBuyStocks = useCallback((purchases: { chain: ChainName; quantity: number }[]) => {
    syncGameAction((state) => {
      let newState = buyStocks(state, purchases);
      newState = endTurn(newState);
      
      if (checkGameEnd(newState)) {
        newState.phase = 'game_over';
        newState.winner = calculateFinalScores(newState)[0].name;
      }

      toast({ title: 'Turn Complete', description: `${newState.players[newState.currentPlayerIndex].name}'s turn` });
      return newState;
    });
  }, [syncGameAction]);

  const handleSkipBuyStock = useCallback(() => {
    syncGameAction((state) => {
      let newState = endTurn(state);
      
      if (checkGameEnd(newState)) {
        newState.phase = 'game_over';
        newState.winner = calculateFinalScores(newState)[0].name;
      }

      toast({ title: 'Turn Complete', description: `${newState.players[newState.currentPlayerIndex].name}'s turn` });
      return newState;
    });
  }, [syncGameAction]);

  const handleEndGameVote = useCallback((vote: boolean) => {
    if (!gameState || myPlayerIndex === null) return;

    const currentPlayer = gameState.players[myPlayerIndex];
    
    if (vote && !gameState.endGameVotes.includes(currentPlayer.id)) {
      const newVotes = [...gameState.endGameVotes, currentPlayer.id];
      const votesNeeded = Math.ceil(gameState.players.length / 2);
      
      let newState = { ...gameState, endGameVotes: newVotes };
      
      if (newVotes.length >= votesNeeded) {
        newState.phase = 'game_over';
        newState.winner = calculateFinalScores(newState)[0].name;
        toast({ title: 'Game Ended', description: 'Players voted to end the game' });
      } else {
        toast({ title: 'Vote Recorded', description: `${newVotes.length}/${votesNeeded} votes` });
      }

      setGameState(newState);
      if (roomId) {
        updateGameState(roomId, newState);
      }
    }
  }, [gameState, myPlayerIndex, roomId]);

  const handleNewGame = useCallback(async () => {
    if (!roomId) return;
    
    // Reset to lobby
    await supabase
      .from('game_rooms')
      .update({ status: 'waiting' })
      .eq('id', roomId);

    await supabase
      .from('game_states')
      .delete()
      .eq('room_id', roomId);

    setGameState(null);
    setRoomStatus('waiting');
  }, [roomId]);

  return {
    // State
    gameState,
    roomId,
    roomCode,
    players,
    myPlayerIndex,
    roomStatus,
    isLoading,
    isMyTurn: gameState?.currentPlayerIndex === myPlayerIndex,
    
    // Lobby actions
    handleCreateRoom,
    handleJoinRoom,
    handleLeaveRoom,
    handleStartGame,
    
    // Game actions
    handleTilePlacement,
    handleFoundChain,
    handleChooseMergerSurvivor,
    handlePayMergerBonuses,
    handleMergerStockChoice,
    handleBuyStocks,
    handleSkipBuyStock,
    handleEndGameVote,
    handleNewGame,
    
    getAvailableChains: gameState ? () => getAvailableChainsForFoundation(gameState) : () => [],
  };
};
