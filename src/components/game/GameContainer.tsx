import { GameState, ChainName, MergerStockDecision } from '@/types/game';
import { GameBoard } from './GameBoard';
import { PlayerHand } from './PlayerHand';
import { PlayerCard } from './PlayerCard';
import { StockPurchase } from './StockPurchase';
import { ChainFounder } from './ChainFounder';
import { InfoCard } from './InfoCard';
import { GameLog } from './GameLog';
import { GameOver } from './GameOver';
import { MergerSurvivorChoice } from './MergerSurvivorChoice';
import { MergerBonusDisplay } from './MergerBonusDisplay';
import { MergerStockDecision as MergerStockDecisionComponent } from './MergerStockDecision';
import { EndGameVote } from './EndGameVote';
import { getPlayerNetWorth, getAvailableChainsForFoundation } from '@/utils/gameLogic';
import { analyzeMerger } from '@/utils/mergerLogic';

interface GameContainerProps {
  gameState: GameState;
  onTilePlacement: (tileId: string) => void;
  onFoundChain: (chain: string) => void;
  onChooseMergerSurvivor: (chain: ChainName) => void;
  onPayMergerBonuses: () => void;
  onMergerStockChoice: (decision: MergerStockDecision) => void;
  onBuyStocks: (purchases: { chain: string; quantity: number }[]) => void;
  onSkipBuyStock: () => void;
  onEndGameVote: (vote: boolean) => void;
  onNewGame: () => void;
}

export const GameContainer = ({
  gameState,
  onTilePlacement,
  onFoundChain,
  onChooseMergerSurvivor,
  onPayMergerBonuses,
  onMergerStockChoice,
  onBuyStocks,
  onSkipBuyStock,
  onEndGameVote,
  onNewGame,
}: GameContainerProps) => {
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  
  // For local play, we're always "all players" but show current player's view
  const myPlayer = currentPlayer;
  const isMyTurn = true; // In local mode, it's always the current player's turn

  // Calculate player rankings by net worth
  const playersByNetWorth = [...gameState.players]
    .map(p => ({ ...p, netWorth: getPlayerNetWorth(p, gameState.chains) }))
    .sort((a, b) => b.netWorth - a.netWorth);

  const getPlayerRank = (playerId: string): number => {
    return playersByNetWorth.findIndex(p => p.id === playerId) + 1;
  };

  // Get merger analysis for survivor choice
  const getMergerPotentialSurvivors = (): ChainName[] => {
    if (gameState.phase !== 'merger_choose_survivor' || !gameState.mergerAdjacentChains) {
      return [];
    }
    const analysis = analyzeMerger(gameState, gameState.lastPlacedTile!, gameState.mergerAdjacentChains);
    return analysis.potentialSurvivors;
  };

  // Check if end game voting is allowed
  const activeChains = Object.values(gameState.chains).filter(c => c.isActive);
  const safeChains = activeChains.filter(c => c.isSafe);
  const canCallEndGameVote = safeChains.length > 0 && 
    gameState.phase !== 'game_over' &&
    ['place_tile', 'buy_stock'].includes(gameState.phase);

  return (
    <div className="min-h-screen bg-background p-4 lg:p-6">
      {/* Game Over Modal */}
      {gameState.phase === 'game_over' && (
        <GameOver gameState={gameState} onNewGame={onNewGame} />
      )}

      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <header className="flex items-center justify-between mb-4 lg:mb-6">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Acquire</h1>
            <p className="text-sm text-muted-foreground">
              Room: <span className="font-mono text-primary">{gameState.roomCode}</span>
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <EndGameVote
              gameState={gameState}
              currentPlayerId={myPlayer.id}
              onVote={onEndGameVote}
              canCallVote={canCallEndGameVote}
            />
            <div className="text-right hidden sm:block">
              <p className="text-sm text-muted-foreground">Current Turn</p>
              <p className="font-semibold text-primary">{currentPlayer.name}</p>
            </div>
            <InfoCard gameState={gameState} />
          </div>
        </header>

        {/* Main Layout */}
        <div className="grid lg:grid-cols-[1fr_320px] gap-4 lg:gap-6">
          {/* Left Column - Board and Controls */}
          <div className="space-y-4 lg:space-y-6">
            {/* Game Board */}
            <GameBoard
              gameState={gameState}
              playerTiles={myPlayer.tiles}
              isCurrentPlayer={isMyTurn}
              onTileClick={onTilePlacement}
            />

            {/* Action Area */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Player's Hand */}
              <PlayerHand
                tiles={myPlayer.tiles}
                gameState={gameState}
                isCurrentPlayer={isMyTurn}
                canPlace={gameState.phase === 'place_tile'}
                onTileClick={onTilePlacement}
              />

              {/* Current Action */}
              <div>
                {gameState.phase === 'place_tile' && (
                  <div className="bg-card rounded-xl p-6 h-full flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-lg font-semibold mb-2">Place a Tile</p>
                      <p className="text-sm text-muted-foreground">
                        Select a highlighted tile from your hand or the board
                      </p>
                    </div>
                  </div>
                )}

                {gameState.phase === 'found_chain' && (
                  <ChainFounder
                    availableChains={getAvailableChainsForFoundation(gameState)}
                    onSelectChain={onFoundChain}
                  />
                )}

                {gameState.phase === 'merger_choose_survivor' && (
                  <MergerSurvivorChoice
                    chains={getMergerPotentialSurvivors()}
                    chainSizes={Object.fromEntries(
                      Object.entries(gameState.chains).map(([k, v]) => [k, v.tiles.length])
                    ) as Record<ChainName, number>}
                    onSelectSurvivor={onChooseMergerSurvivor}
                  />
                )}

                {gameState.phase === 'merger_pay_bonuses' && gameState.merger?.currentDefunctChain && (
                  <MergerBonusDisplay
                    gameState={gameState}
                    defunctChain={gameState.merger.currentDefunctChain}
                    onContinue={onPayMergerBonuses}
                  />
                )}

                {gameState.phase === 'merger_handle_stock' && gameState.merger?.currentDefunctChain && gameState.merger.survivingChain && (
                  <MergerStockDecisionComponent
                    gameState={gameState}
                    playerIndex={gameState.merger.currentPlayerIndex}
                    defunctChain={gameState.merger.currentDefunctChain}
                    survivingChain={gameState.merger.survivingChain}
                    onDecision={onMergerStockChoice}
                  />
                )}

                {gameState.phase === 'buy_stock' && (
                  <StockPurchase
                    gameState={gameState}
                    playerCash={myPlayer.cash}
                    onPurchase={onBuyStocks}
                    onSkip={onSkipBuyStock}
                  />
                )}
              </div>
            </div>

            {/* Game Log - Mobile */}
            <div className="lg:hidden">
              <GameLog entries={gameState.gameLog} />
            </div>
          </div>

          {/* Right Column - Players and Log */}
          <div className="space-y-4 lg:space-y-6">
            {/* Player Cards */}
            <div className="space-y-3">
              {gameState.players.map((player, index) => (
                <PlayerCard
                  key={player.id}
                  player={player}
                  gameState={gameState}
                  isCurrentTurn={index === gameState.currentPlayerIndex}
                  isYou={player.id === myPlayer.id}
                  rank={getPlayerRank(player.id)}
                />
              ))}
            </div>

            {/* Game Log - Desktop */}
            <div className="hidden lg:block">
              <GameLog entries={gameState.gameLog} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
