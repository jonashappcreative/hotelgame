import { useState, useCallback } from 'react';
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
  advanceMergerPlayer,
  completeMerger,
  getPlayersWithStock,
} from '@/utils/mergerLogic';
import { toast } from '@/hooks/use-toast';

export const useGameState = () => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);

  const startGame = useCallback((playerNames: string[]) => {
    const newGame = initializeGame(playerNames);
    setGameState(newGame);
    setCurrentPlayerIndex(0);
    toast({
      title: "Game Started!",
      description: `${playerNames[0]}'s turn to play`,
    });
  }, []);

  const handleTilePlacement = useCallback((tileId: TileId) => {
    if (!gameState) return;
    
    const analysis = analyzeTilePlacement(gameState, tileId);
    if (!analysis.valid) {
      toast({
        title: "Invalid Move",
        description: analysis.reason,
        variant: "destructive",
      });
      return;
    }

    let newState = placeTile(gameState, tileId);

    if (analysis.action === 'form_chain') {
      // Need to choose which chain to found
      newState.phase = 'found_chain';
      newState.pendingChainFoundation = [tileId, ...analysis.adjacentUnincorporated];
      setGameState(newState);
      return;
    }

    if (analysis.action === 'grow_chain') {
      // Automatically grow the chain
      const chainToGrow = analysis.adjacentChains[0];
      newState = growChain(newState, chainToGrow);
      
      // Add log entry for growth
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
      // Analyze the merger
      const mergerAnalysis = analyzeMerger(newState, tileId, analysis.adjacentChains);
      
      if (!mergerAnalysis.canMerge) {
        toast({
          title: "Invalid Merger",
          description: mergerAnalysis.reason,
          variant: "destructive",
        });
        return;
      }

      // Store adjacent chains for later use
      newState.mergerAdjacentChains = analysis.adjacentChains;

      if (mergerAnalysis.tieBreakerNeeded) {
        // Player needs to choose surviving chain
        newState.phase = 'merger_choose_survivor';
        setGameState(newState);
        
        toast({
          title: "Merger: Choose Survivor",
          description: "Multiple chains are tied - choose which survives",
        });
        return;
      } else {
        // Auto-select the largest chain as survivor
        const survivingChain = mergerAnalysis.potentialSurvivors[0];
        newState.merger = initializeMerger(newState, analysis.adjacentChains, survivingChain);
        newState.phase = 'merger_pay_bonuses';
        
        toast({
          title: "Merger Started",
          description: `${survivingChain} will absorb the other chains`,
        });
      }
    }

    if (analysis.action === 'place_only') {
      newState.phase = 'buy_stock';
    }

    // Check for game end
    if (checkGameEnd(newState)) {
      newState.phase = 'game_over';
      newState.winner = calculateFinalScores(newState)[0].name;
    }

    setGameState(newState);
  }, [gameState]);

  const handleFoundChain = useCallback((chainName: ChainName) => {
    if (!gameState) return;

    const newState = foundChain(gameState, chainName);
    
    // Check for game end after founding
    if (checkGameEnd(newState)) {
      newState.phase = 'game_over';
      newState.winner = calculateFinalScores(newState)[0].name;
    }

    setGameState(newState);
    
    toast({
      title: `${chainName.charAt(0).toUpperCase() + chainName.slice(1)} Founded!`,
      description: "You received 1 bonus share.",
    });
  }, [gameState]);

  const handleChooseMergerSurvivor = useCallback((survivingChain: ChainName) => {
    if (!gameState || !gameState.mergerAdjacentChains) return;

    const newState = { ...gameState };
    newState.merger = initializeMerger(newState, gameState.mergerAdjacentChains, survivingChain);
    newState.phase = 'merger_pay_bonuses';
    
    setGameState(newState);
    
    toast({
      title: "Survivor Chosen",
      description: `${survivingChain} will survive the merger`,
    });
  }, [gameState]);

  const handlePayMergerBonuses = useCallback(() => {
    if (!gameState || !gameState.merger || !gameState.merger.currentDefunctChain) return;

    let newState = payMergerBonuses(gameState, gameState.merger.currentDefunctChain);
    newState.merger = { ...newState.merger!, bonusesPaid: true };
    
    // Check if any player has shares in the defunct chain
    const playersWithShares = getPlayersWithStock(newState, newState.merger.currentDefunctChain!);
    
    if (playersWithShares.length === 0) {
      // No one has shares, skip to next defunct chain or complete
      const currentDefunctIndex = newState.merger.defunctChains.indexOf(newState.merger.currentDefunctChain!);
      if (currentDefunctIndex < newState.merger.defunctChains.length - 1) {
        newState.merger.currentDefunctChain = newState.merger.defunctChains[currentDefunctIndex + 1];
        newState.merger.bonusesPaid = false;
        // Stay in pay_bonuses phase for next chain
      } else {
        // Complete the merger
        newState = completeMerger(newState);
      }
    } else {
      // Start with active player for stock decisions
      newState.merger.currentPlayerIndex = gameState.currentPlayerIndex;
      
      // If active player doesn't have shares, find first player who does
      if (!playersWithShares.includes(newState.merger.currentPlayerIndex)) {
        // Find next player with shares starting from active player
        for (let i = 0; i < newState.players.length; i++) {
          const idx = (gameState.currentPlayerIndex + i) % newState.players.length;
          if (playersWithShares.includes(idx)) {
            newState.merger.currentPlayerIndex = idx;
            break;
          }
        }
      }
      
      newState.phase = 'merger_handle_stock';
    }

    setGameState(newState);
  }, [gameState]);

  const handleMergerStockChoice = useCallback((decision: MergerStockDecision) => {
    if (!gameState || !gameState.merger) return;

    let newState = handleMergerStockDecision(
      gameState, 
      gameState.merger.currentPlayerIndex, 
      decision
    );
    
    // Find next player with shares
    const defunctChain = newState.merger!.currentDefunctChain!;
    const startPlayerIndex = gameState.currentPlayerIndex;
    let nextIndex = (newState.merger!.currentPlayerIndex + 1) % newState.players.length;
    let foundNext = false;
    
    // Go around the table from current player
    while (nextIndex !== startPlayerIndex) {
      if (newState.players[nextIndex].stocks[defunctChain] > 0) {
        newState.merger = { ...newState.merger!, currentPlayerIndex: nextIndex };
        foundNext = true;
        break;
      }
      nextIndex = (nextIndex + 1) % newState.players.length;
    }
    
    // Check if we've looped back to start (or start player has shares)
    if (!foundNext && newState.players[startPlayerIndex].stocks[defunctChain] > 0 && 
        startPlayerIndex !== gameState.merger.currentPlayerIndex) {
      newState.merger = { ...newState.merger!, currentPlayerIndex: startPlayerIndex };
      foundNext = true;
    }

    if (!foundNext) {
      // No more players with shares, move to next defunct chain or complete
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
        // Complete the merger
        newState = completeMerger(newState);
      }
    }

    // Check for game end
    if (newState.phase === 'buy_stock' && checkGameEnd(newState)) {
      newState.phase = 'game_over';
      newState.winner = calculateFinalScores(newState)[0].name;
    }

    setGameState(newState);
  }, [gameState]);

  const handleBuyStocks = useCallback((purchases: { chain: ChainName; quantity: number }[]) => {
    if (!gameState) return;

    let newState = buyStocks(gameState, purchases);
    newState = endTurn(newState);
    
    // Check for game end
    if (checkGameEnd(newState)) {
      newState.phase = 'game_over';
      newState.winner = calculateFinalScores(newState)[0].name;
    }

    setGameState(newState);
    setCurrentPlayerIndex(newState.currentPlayerIndex);

    toast({
      title: "Turn Complete",
      description: `${newState.players[newState.currentPlayerIndex].name}'s turn`,
    });
  }, [gameState]);

  const handleSkipBuyStock = useCallback(() => {
    if (!gameState) return;

    let newState = endTurn(gameState);
    
    // Check for game end
    if (checkGameEnd(newState)) {
      newState.phase = 'game_over';
      newState.winner = calculateFinalScores(newState)[0].name;
    }

    setGameState(newState);
    setCurrentPlayerIndex(newState.currentPlayerIndex);

    toast({
      title: "Turn Complete",
      description: `${newState.players[newState.currentPlayerIndex].name}'s turn`,
    });
  }, [gameState]);

  const handleEndGameVote = useCallback((vote: boolean) => {
    if (!gameState) return;

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    let newState = { ...gameState };
    
    if (vote && !newState.endGameVotes.includes(currentPlayer.id)) {
      newState.endGameVotes = [...newState.endGameVotes, currentPlayer.id];
      
      // Check if majority voted
      const votesNeeded = Math.ceil(gameState.players.length / 2);
      if (newState.endGameVotes.length >= votesNeeded) {
        newState.phase = 'game_over';
        newState.winner = calculateFinalScores(newState)[0].name;
        
        toast({
          title: "Game Ended",
          description: "Players voted to end the game",
        });
      } else {
        toast({
          title: "Vote Recorded",
          description: `${newState.endGameVotes.length}/${votesNeeded} votes to end`,
        });
      }
    }

    setGameState(newState);
  }, [gameState]);

  const resetGame = useCallback(() => {
    setGameState(null);
    setCurrentPlayerIndex(0);
  }, []);

  return {
    gameState,
    currentPlayerIndex,
    startGame,
    handleTilePlacement,
    handleFoundChain,
    handleChooseMergerSurvivor,
    handlePayMergerBonuses,
    handleMergerStockChoice,
    handleBuyStocks,
    handleSkipBuyStock,
    handleEndGameVote,
    resetGame,
    getAvailableChains: gameState ? () => getAvailableChainsForFoundation(gameState) : () => [],
  };
};
