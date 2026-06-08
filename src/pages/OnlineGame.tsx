import { useEffect, useRef } from 'react';
import { useOnlineGame } from '@/hooks/useOnlineGame';
import { OnlineLobby } from '@/components/game/OnlineLobby';
import { GameContainer } from '@/components/game/GameContainer';
import { TileId, ChainName } from '@/types/game';
import { useAudio } from '@/contexts/AudioContext';

const OnlineGame = () => {
  const { playSfx } = useAudio();
  const prevPlayersLengthRef = useRef(0);

  const {
    gameState,
    roomId,
    roomCode,
    players,
    myPlayerIndex,
    maxPlayers,
    roomStatus,
    isLoading,
    isCheckingActiveGame,
    activeGameInfo,
    handleCreateRoom,
    handleJoinRoom,
    handleLeaveRoom,
    handleToggleReady,
    handleAddBot,
    handleRemoveBot,
    isHost,
    handleRejoinGame,
    dismissActiveGame,
    handleTilePlacement,
    handleDiscardTile,
    handleFoundChain,
    handleChooseMergerSurvivor,
    handlePayMergerBonuses,
    handleMergerStockChoice,
    handleBuyStocks,
    handleSkipBuyStock,
    handleEndGameVote,
    handleNewGame,
    handleAutoEndTurn,
  } = useOnlineGame();

  // SFX: play player-join when someone new joins the lobby
  useEffect(() => {
    if (players.length > prevPlayersLengthRef.current && prevPlayersLengthRef.current > 0) {
      playSfx('player-join');
    }
    prevPlayersLengthRef.current = players.length;
  }, [players.length, playSfx]);

  // Show lobby if not in a game
  if (roomStatus !== 'playing' || !gameState) {
    return (
      <OnlineLobby
        roomCode={roomCode}
        roomId={roomId}
        players={players}
        myPlayerIndex={myPlayerIndex}
        maxPlayers={maxPlayers}
        isLoading={isLoading}
        isCheckingActiveGame={isCheckingActiveGame}
        activeGameInfo={activeGameInfo}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
        onLeaveRoom={handleLeaveRoom}
        onToggleReady={handleToggleReady}
        isHost={isHost}
        onAddBot={handleAddBot}
        onRemoveBot={handleRemoveBot}
        onRejoinGame={handleRejoinGame}
        onDismissActiveGame={dismissActiveGame}
      />
    );
  }

  const botCount = players.filter(p => p.is_bot).length;

  return (
    <GameContainer
      gameState={gameState}
      myPlayerIndex={myPlayerIndex ?? undefined}
      onTilePlacement={(tileId) => handleTilePlacement(tileId as TileId)}
      onDiscardTile={(tileId) => handleDiscardTile(tileId as TileId)}
      onFoundChain={(chain) => handleFoundChain(chain as ChainName)}
      onChooseMergerSurvivor={handleChooseMergerSurvivor}
      onPayMergerBonuses={handlePayMergerBonuses}
      onMergerStockChoice={handleMergerStockChoice}
      onBuyStocks={(purchases) => handleBuyStocks(purchases as { chain: ChainName; quantity: number }[])}
      onEndTurn={handleSkipBuyStock}
      onEndGameVote={handleEndGameVote}
      onNewGame={handleNewGame}
      onReturnToLobby={handleLeaveRoom}
      onAutoEndTurn={handleAutoEndTurn}
      botCount={botCount}
      isHost={isHost}
    />
  );
};

export default OnlineGame;
