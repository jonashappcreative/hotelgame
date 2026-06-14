import { TileId, ChainName, GameState, CHAINS } from '@/types/game';
import { analyzeTilePlacement } from '@/utils/gameLogic';
import { cn } from '@/lib/utils';

interface GameBoardProps {
  gameState: GameState;
  playerTiles: TileId[];
  isCurrentPlayer: boolean;
  onTileClick: (tileId: TileId) => void;
  selectedTile?: TileId | null;
  mergerDisplayOverride?: Map<TileId, ChainName>;
}

const DEFAULT_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const DEFAULT_ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const GameBoard = ({ gameState, playerTiles, isCurrentPlayer, onTileClick, selectedTile, mergerDisplayOverride }: GameBoardProps) => {
  const COLS = gameState.boardCols?.length ? gameState.boardCols : DEFAULT_COLS;
  const ROWS = gameState.boardRows
    ? Array.from({ length: gameState.boardRows }, (_, i) => i + 1)
    : DEFAULT_ROWS;

  const canPlaceTile = (tileId: TileId): boolean => {
    if (!isCurrentPlayer || gameState.phase !== 'place_tile') return false;
    if (!playerTiles.includes(tileId)) return false;
    const analysis = analyzeTilePlacement(gameState, tileId);
    return analysis.valid;
  };

  const getTileState = (tileId: TileId) => {
    return gameState.board.get(tileId);
  };

  const getChainClass = (chainName: ChainName | null | undefined): string => {
    if (!chainName) return '';
    return `chain-${chainName}`;
  };

  // Returns the visually displayed chain for a tile (override or actual).
  const getDisplayChain = (id: TileId): ChainName | null | undefined => {
    if (mergerDisplayOverride?.has(id)) return mergerDisplayOverride.get(id)!;
    return gameState.board.get(id)?.chain;
  };

  return (
    <div className="bg-board rounded-2xl p-4 md:p-6 shadow-lg">
      {/* Column headers */}
      <div className="flex mb-2">
        <div className="w-8 md:w-10" /> {/* Empty corner */}
        {COLS.map(col => (
          <div
            key={col}
            className="flex-1 text-center text-xs md:text-sm font-medium text-muted-foreground"
          >
            {col}
          </div>
        ))}
      </div>

      {/* Board grid */}
      <div className="space-y-1 md:space-y-1.5">
        {ROWS.map(row => (
          <div key={row} className="flex gap-1 md:gap-1.5">
            {/* Row label */}
            <div className="w-8 md:w-10 flex items-center justify-center text-xs md:text-sm font-medium text-muted-foreground">
              {row}
            </div>

            {/* Tiles */}
            {COLS.map(col => {
              const tileId = `${row}${col}` as TileId;
              const tile = getTileState(tileId);
              const isInHand = playerTiles.includes(tileId);
              const canPlace = canPlaceTile(tileId);
              const chainName = tile?.chain;

              const displayChain = getDisplayChain(tileId);

              // Melt effect: remove rounded corners toward adjacent same-display-chain neighbors.
              // Neighbor display chains are also override-aware so the effect propagates
              // correctly tile-by-tile as the animation sweeps through.
              let meltStyle: React.CSSProperties | undefined;
              if (displayChain) {
                const colIndex = COLS.indexOf(col);
                const topId = row > ROWS[0] ? `${row - 1}${col}` as TileId : null;
                const bottomId = row < ROWS[ROWS.length - 1] ? `${row + 1}${col}` as TileId : null;
                const leftId = colIndex > 0 ? `${row}${COLS[colIndex - 1]}` as TileId : null;
                const rightId = colIndex < COLS.length - 1 ? `${row}${COLS[colIndex + 1]}` as TileId : null;

                const sameTop    = topId    ? getDisplayChain(topId)    === displayChain : false;
                const sameBottom = bottomId ? getDisplayChain(bottomId) === displayChain : false;
                const sameLeft   = leftId   ? getDisplayChain(leftId)   === displayChain : false;
                const sameRight  = rightId  ? getDisplayChain(rightId)  === displayChain : false;

                if (sameTop || sameBottom || sameLeft || sameRight) {
                  // 7px covers the max responsive gap (gap-1.5 = 6px) with 1px overlap
                  // so no dark hairline appears between tiles. var(--chain-color) is set
                  // by the chain-X CSS class applied to this tile.
                  const G = 7;
                  const shadows: string[] = [];
                  if (sameRight)  shadows.push(`${G}px 0 0 0 var(--chain-color)`);
                  if (sameLeft)   shadows.push(`-${G}px 0 0 0 var(--chain-color)`);
                  if (sameBottom) shadows.push(`0 ${G}px 0 0 var(--chain-color)`);
                  if (sameTop)    shadows.push(`0 -${G}px 0 0 var(--chain-color)`);

                  meltStyle = {
                    borderTopLeftRadius:     (sameTop    || sameLeft)  ? 0 : undefined,
                    borderTopRightRadius:    (sameTop    || sameRight) ? 0 : undefined,
                    borderBottomLeftRadius:  (sameBottom || sameLeft)  ? 0 : undefined,
                    borderBottomRightRadius: (sameBottom || sameRight) ? 0 : undefined,
                    boxShadow: shadows.join(', '),
                  };
                }
              }

              return (
                <button
                  key={tileId}
                  onClick={() => canPlace && onTileClick(tileId)}
                  disabled={!canPlace}
                  className={cn(
                    "tile flex-1 aspect-[4/3] min-h-[28px] md:min-h-[36px] text-[10px] md:text-xs font-mono",
                    tile?.placed && !chainName && "tile-placed",
                    displayChain && `tile-chain ${getChainClass(displayChain)}`,
                    canPlace && "tile-playable cursor-pointer",
                    selectedTile === tileId && "ring-2 ring-primary scale-105",
                    isInHand && !tile?.placed && !selectedTile && "ring-1 ring-primary/30",
                    !canPlace && !tile?.placed && "opacity-50",
                    // Always transition chain tiles so merger color sweep is smooth
                    (displayChain || chainName) && "transition-all duration-200",
                  )}
                  style={meltStyle}
                  title={tileId}
                >
                  {/* Always show tile ID for placed tiles or playable tiles */}
                  {(tile?.placed === true || canPlace) && (
                    <span className={cn(
                      "font-semibold",
                      (displayChain ?? chainName) === 'tower' ? "text-background" : "text-foreground"
                    )}>
                      {tileId}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Chain legend */}
      <div className="mt-4 flex flex-wrap gap-2 justify-center">
        {Object.entries(CHAINS).map(([key, chain]) => {
          const chainState = gameState.chains[key as ChainName];
          const isActive = chainState.isActive;

          return (
            <div
              key={key}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-opacity",
                isActive ? "opacity-100" : "opacity-40"
              )}
            >
              <div
                className={cn(
                  "w-3 h-3 rounded-full",
                  `chain-${key}`
                )}
              />
              <span className="text-foreground/80">
                {chain.displayName}
                {chainState.isSafe && " ★"}
              </span>
              {isActive && (
                <span className="text-muted-foreground">
                  ({chainState.tiles.length})
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
