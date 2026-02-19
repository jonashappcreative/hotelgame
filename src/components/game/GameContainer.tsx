import { useState } from 'react';
import { GameState, ChainName, MergerStockDecision, TileId } from '@/types/game';
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
import { TileConfirmationModal } from './TileConfirmationModal';
import { UnplayableTilesModal } from './UnplayableTilesModal';
import { TurnTimer } from './TurnTimer';
import { getPlayerNetWorth, getAvailableChainsForFoundation, hasPlayableTiles, getAdjacentTiles } from '@/utils/gameLogic';
import { analyzeMerger } from '@/utils/mergerLogic';
import { Clock, WifiOff } from 'lucide-react';

interface GameContainerProps {
  gameState: GameState;
  myPlayerIndex?: number; // Optional - if undefined, show all (local mode)
  onTilePlacement: (tileId: string) => void;
  onFoundChain: (chain: string) => void;
  onChooseMergerSurvivor: (chain: ChainName) => void;
  onPayMergerBonuses: () => void;
  onMergerStockChoice: (decision: MergerStockDecision) => void;
  onBuyStocks: (purchases: { chain: string; quantity: number }[]) => void;
  onEndTurn: () => void;
  onEndGameVote: (vote: boolean) => void;
  onNewGame: () => void;
  onDiscardTile?: (tileId: TileId) => void;
  onAutoEndTurn?: () => void;
}

export const GameContainer = ({
  gameState,
  myPlayerIndex: myPlayerIndexProp,
  onTilePlacement,
  onFoundChain,
  onChooseMergerSurvivor,
  onPayMergerBonuses,
  onMergerStockChoice,
  onBuyStocks,
  onEndTurn,
  onEndGameVote,
  onNewGame,
  onDiscardTile,
  onAutoEndTurn,
}: GameContainerProps) => {
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  
  // Tile selection state for confirmation modal
  const [selectedTile, setSelectedTile] = useState<TileId | null>(null);
  const [showGameOver, setShowGameOver] = useState(true);
  
  // Determine if we're in online mode (myPlayerIndex provided) or local mode
  const isOnlineMode = myPlayerIndexProp !== undefined;
  const myPlayerIndex = myPlayerIndexProp ?? gameState.currentPlayerIndex;
  const myPlayer = gameState.players[myPlayerIndex];
  const isMyTurn = myPlayerIndex === gameState.currentPlayerIndex;
  
  // Check if it's my turn for merger stock decisions
  const isMyMergerTurn = gameState.phase === 'merger_handle_stock' &&
    gameState.merger?.currentPlayerIndex === myPlayerIndex;

  // Derive cash visibility: local games always show all cash; online games follow rules
  const cashVisibility: 'hidden' | 'visible' | 'aggregate' = (() => {
    if (!isOnlineMode) return 'visible';
    const rules = gameState.rulesSnapshot;
    if (!rules?.cashVisibilityEnabled) return 'hidden';
    return (rules.cashVisibility || 'hidden') as 'hidden' | 'visible' | 'aggregate';
  })();

  // Check if player has unplayable tiles
  const hasNoPlayableTiles = gameState.phase === 'place_tile' && 
    isMyTurn && 
    !hasPlayableTiles(gameState, gameState.currentPlayerIndex);

  // Calculate player rankings by net worth
  const playersByNetWorth = [...gameState.players]
    .map(p => ({ ...p, netWorth: getPlayerNetWorth(p, gameState.chains) }))
    .sort((a, b) => b.netWorth - a.netWorth);

  const getPlayerRank = (playerId: string): number => {
    return playersByNetWorth.findIndex(p => p.id === playerId) + 1;
  };

  // Get merger analysis for survivor choice
  const getMergerPotentialSurvivors = (): ChainName[] => {
    if (gameState.phase !== 'merger_choose_survivor') {
      return [];
    }

    // Try to use mergerAdjacentChains first, or derive from board state
    let adjacentChains = gameState.mergerAdjacentChains;

    if (!adjacentChains && gameState.lastPlacedTile) {
      // Derive adjacent chains from board state
      const adjacent = getAdjacentTiles(gameState.lastPlacedTile);
      const chainsSet = new Set<ChainName>();

      for (const adjTile of adjacent) {
        const tile = gameState.board.get(adjTile);
        if (tile?.chain) {
          chainsSet.add(tile.chain);
        }
      }

      adjacentChains = Array.from(chainsSet);
    }

    if (!adjacentChains || adjacentChains.length < 2) {
      return [];
    }

    const analysis = analyzeMerger(gameState, gameState.lastPlacedTile!, adjacentChains);
    return analysis.potentialSurvivors;
  };

  // Check if end game voting is allowed
  const canCallEndGameVote = 
    gameState.phase !== 'game_over' &&
    ['place_tile', 'buy_stock'].includes(gameState.phase);

  // Handle tile selection (show confirmation modal)
  const handleTileSelect = (tileId: TileId) => {
    setSelectedTile(tileId);
  };

  // Handle tile confirmation
  const handleTileConfirm = () => {
    if (selectedTile) {
      onTilePlacement(selectedTile);
      setSelectedTile(null);
    }
  };

  // Handle tile discard
  const handleDiscardTile = (tileId: TileId) => {
    if (onDiscardTile) {
      onDiscardTile(tileId);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 lg:p-6">
      {/* Tile Confirmation Modal */}
      <TileConfirmationModal
        selectedTile={selectedTile}
        onConfirm={handleTileConfirm}
        onCancel={() => setSelectedTile(null)}
      />

      {/* Unplayable Tiles Modal */}
      <UnplayableTilesModal
        isOpen={hasNoPlayableTiles}
        tiles={myPlayer.tiles}
        gameState={gameState}
        onDiscard={handleDiscardTile}
        onClose={() => {}}
      />

      {/* Chain Founder Modal - Only show to current player */}
      {gameState.phase === 'found_chain' && isMyTurn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <ChainFounder
            availableChains={getAvailableChainsForFoundation(gameState)}
            onSelectChain={onFoundChain}
          />
        </div>
      )}

      {/* Merger Survivor Choice Modal - Only show to current player */}
      {gameState.phase === 'merger_choose_survivor' && isMyTurn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
          <MergerSurvivorChoice
            chains={getMergerPotentialSurvivors()}
            chainSizes={Object.fromEntries(
              Object.entries(gameState.chains).map(([k, v]) => [k, v.tiles.length])
            ) as Record<ChainName, number>}
            onSelectSurvivor={onChooseMergerSurvivor}
          />
        </div>
      )}

      {/* Waiting overlay removed - now shown in sidebar notification */}

      {/* Game Over Modal */}
      {gameState.phase === 'game_over' && showGameOver && (
        <GameOver 
          gameState={gameState} 
          onNewGame={onNewGame}
          onClose={() => setShowGameOver(false)}
          onReturnToLobby={onNewGame}
        />
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
              onTileClick={handleTileSelect}
              selectedTile={selectedTile}
            />

            {/* Turn Timer — shown only to the active player when timer is enabled */}
            {(() => {
              const rules = gameState.rulesSnapshot;
              const roundNumber = gameState.roundNumber ?? 0;
              const showTimer =
                isMyTurn &&
                isOnlineMode &&
                gameState.phase === 'place_tile' &&
                rules?.turnTimerEnabled === true &&
                !(rules.disableTimerFirstRounds && roundNumber < 2) &&
                onAutoEndTurn !== undefined;
              if (!showTimer) return null;
              const durationSecs = parseInt(rules!.turnTimer ?? '60');
              return (
                <TurnTimer
                  key={gameState.currentPlayerIndex}
                  durationSeconds={durationSecs}
                  isActive={true}
                  onExpire={onAutoEndTurn!}
                />
              );
            })()}

            {/* Action Area */}
            <div>
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

                {gameState.phase === 'merger_pay_bonuses' && gameState.merger?.currentDefunctChain && (
                  <MergerBonusDisplay
                    gameState={gameState}
                    defunctChain={gameState.merger.currentDefunctChain}
                    onContinue={onPayMergerBonuses}
                  />
                )}

                {gameState.phase === 'merger_handle_stock' && gameState.merger?.currentDefunctChain && gameState.merger.survivingChain && (
                  isMyMergerTurn ? (
                    <MergerStockDecisionComponent
                      gameState={gameState}
                      playerIndex={gameState.merger.currentPlayerIndex}
                      defunctChain={gameState.merger.currentDefunctChain}
                      survivingChain={gameState.merger.survivingChain}
                      onDecision={onMergerStockChoice}
                    />
                  ) : isOnlineMode ? (
                    <div className="bg-card rounded-xl p-6 h-full flex items-center justify-center">
                      <div className="text-center">
                        <p className="text-lg font-semibold mb-2">Merger in Progress</p>
                        <p className="text-sm text-muted-foreground">
                          Waiting for {gameState.players[gameState.merger.currentPlayerIndex].name} to decide...
                        </p>
                      </div>
                    </div>
                  ) : (
                    <MergerStockDecisionComponent
                      gameState={gameState}
                      playerIndex={gameState.merger.currentPlayerIndex}
                      defunctChain={gameState.merger.currentDefunctChain}
                      survivingChain={gameState.merger.survivingChain}
                      onDecision={onMergerStockChoice}
                    />
                  )
                )}

                {gameState.phase === 'buy_stock' && (
                  isMyTurn ? (
                    <StockPurchase
                      gameState={gameState}
                      playerCash={myPlayer.cash}
                      onPurchase={onBuyStocks}
                      onEndTurn={onEndTurn}
                    />
                  ) : isOnlineMode ? (
                    <div className="bg-card rounded-xl p-6 h-full flex items-center justify-center">
                      <div className="text-center">
                        <p className="text-lg font-semibold mb-2">Stock Purchase</p>
                        <p className="text-sm text-muted-foreground">
                          Waiting for {currentPlayer.name} to buy stocks...
                        </p>
                      </div>
                    </div>
                  ) : (
                    <StockPurchase
                      gameState={gameState}
                      playerCash={myPlayer.cash}
                      onPurchase={onBuyStocks}
                      onEndTurn={onEndTurn}
                    />
                  )
                )}
              </div>
            </div>

            {/* Game Log */}
            <GameLog entries={gameState.gameLog} />

            {/* Turn Status Notification - Mobile */}
            {isOnlineMode && !isMyTurn && gameState.phase !== 'game_over' && !isMyMergerTurn && (
              <div className="lg:hidden mt-4">
                <div className={`bg-card rounded-xl p-4 shadow-md border ${
                  currentPlayer.isConnected === false ? 'border-destructive/40' : 'border-primary/20'
                }`}>
                  <div className="flex items-center gap-3">
                    {currentPlayer.isConnected === false ? (
                      <WifiOff className="w-5 h-5 text-destructive flex-shrink-0" />
                    ) : (
                      <Clock className="w-5 h-5 text-primary animate-pulse flex-shrink-0" />
                    )}
                    <div>
                      <p className="font-semibold text-sm">
                        {currentPlayer.isConnected === false
                          ? `Waiting for ${currentPlayer.name} to reconnect...`
                          : `Waiting for ${currentPlayer.name}`}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {currentPlayer.isConnected === false
                          ? 'They appear to be disconnected'
                          : "It's their turn to play"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right Column - Players and Log */}
          <div className="space-y-4 lg:space-y-6">
            {/* Your Player Card + Tiles */}
            <div className="space-y-3">
              <PlayerCard
                player={myPlayer}
                gameState={gameState}
                isCurrentTurn={myPlayerIndex === gameState.currentPlayerIndex}
                isYou={true}
                rank={getPlayerRank(myPlayer.id)}
                cashVisibility={cashVisibility}
                myPlayerIndex={myPlayerIndex}
              />
              {/* Player's Hand - positioned below your cash like in tutorial */}
              <PlayerHand
                tiles={myPlayer.tiles}
                gameState={gameState}
                isCurrentPlayer={isMyTurn}
                canPlace={gameState.phase === 'place_tile' && isMyTurn}
                onTileClick={handleTileSelect}
                selectedTile={selectedTile}
              />
            </div>

            {/* Other Player Cards */}
            <div className="space-y-3">
              {gameState.players
                .filter((player) => player.id !== myPlayer.id)
                .map((player, index) => {
                  const originalIndex = gameState.players.findIndex(p => p.id === player.id);
                  return (
                    <PlayerCard
                      key={player.id}
                      player={player}
                      gameState={gameState}
                      isCurrentTurn={originalIndex === gameState.currentPlayerIndex}
                      isYou={false}
                      rank={getPlayerRank(player.id)}
                      cashVisibility={cashVisibility}
                      myPlayerIndex={myPlayerIndex}
                    />
                  );
                })}
            </div>

            {/* Turn Status Notification - Desktop */}
            {isOnlineMode && !isMyTurn && gameState.phase !== 'game_over' && !isMyMergerTurn && (
              <div className="hidden lg:block mt-4">
                <div className={`bg-card rounded-xl p-4 shadow-md border ${
                  currentPlayer.isConnected === false ? 'border-destructive/40' : 'border-primary/20'
                }`}>
                  <div className="flex items-center gap-3">
                    {currentPlayer.isConnected === false ? (
                      <WifiOff className="w-5 h-5 text-destructive flex-shrink-0" />
                    ) : (
                      <Clock className="w-5 h-5 text-primary animate-pulse flex-shrink-0" />
                    )}
                    <div>
                      <p className="font-semibold text-sm">
                        {currentPlayer.isConnected === false
                          ? `Waiting for ${currentPlayer.name} to reconnect...`
                          : `Waiting for ${currentPlayer.name}`}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {currentPlayer.isConnected === false
                          ? 'They appear to be disconnected'
                          : "It's their turn to play"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
