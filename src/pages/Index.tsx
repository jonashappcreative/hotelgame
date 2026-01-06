import { useGameState } from '@/hooks/useGameState';
import { Lobby } from '@/components/game/Lobby';
import { GameContainer } from '@/components/game/GameContainer';
import { TileId, ChainName } from '@/types/game';

const Index = () => {
  const {
    gameState,
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
  } = useGameState();

  if (!gameState) {
    return <Lobby onStartGame={startGame} />;
  }

  return (
    <GameContainer
      gameState={gameState}
      onTilePlacement={(tileId) => handleTilePlacement(tileId as TileId)}
      onFoundChain={(chain) => handleFoundChain(chain as ChainName)}
      onChooseMergerSurvivor={handleChooseMergerSurvivor}
      onPayMergerBonuses={handlePayMergerBonuses}
      onMergerStockChoice={handleMergerStockChoice}
      onBuyStocks={(purchases) => handleBuyStocks(purchases as { chain: ChainName; quantity: number }[])}
      onEndTurn={handleSkipBuyStock}
      onEndGameVote={handleEndGameVote}
      onNewGame={resetGame}
    />
  );
};

export default Index;
