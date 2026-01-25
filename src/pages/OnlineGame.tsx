import { useOnlineGame } from '@/hooks/useOnlineGame';
import { OnlineLobby } from '@/components/game/OnlineLobby';
import { GameContainer } from '@/components/game/GameContainer';
import { TileId, ChainName } from '@/types/game';

const OnlineGame = () => {
  const {
    gameState,
    roomCode,
    players,
    myPlayerIndex,
    roomStatus,
    isLoading,
    handleCreateRoom,
    handleJoinRoom,
    handleLeaveRoom,
    handleStartGame,
    handleTilePlacement,
    handleFoundChain,
    handleChooseMergerSurvivor,
    handlePayMergerBonuses,
    handleMergerStockChoice,
    handleBuyStocks,
    handleSkipBuyStock,
    handleEndGameVote,
    handleNewGame,
  } = useOnlineGame();

  // Show lobby if not in a game
  if (roomStatus !== 'playing' || !gameState) {
    return (
      <OnlineLobby
        roomCode={roomCode}
        players={players}
        myPlayerIndex={myPlayerIndex}
        isLoading={isLoading}
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
        onLeaveRoom={handleLeaveRoom}
        onStartGame={handleStartGame}
      />
    );
  }

  return (
    <GameContainer
      gameState={gameState}
      myPlayerIndex={myPlayerIndex ?? undefined}
      onTilePlacement={(tileId) => handleTilePlacement(tileId as TileId)}
      onFoundChain={(chain) => handleFoundChain(chain as ChainName)}
      onChooseMergerSurvivor={handleChooseMergerSurvivor}
      onPayMergerBonuses={handlePayMergerBonuses}
      onMergerStockChoice={handleMergerStockChoice}
      onBuyStocks={(purchases) => handleBuyStocks(purchases as { chain: ChainName; quantity: number }[])}
      onEndTurn={handleSkipBuyStock}
      onEndGameVote={handleEndGameVote}
      onNewGame={handleNewGame}
    />
  );
};

export default OnlineGame;
