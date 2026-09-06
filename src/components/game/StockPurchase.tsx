import { useState, useEffect } from 'react';
import { ChainName, GameState, CHAINS } from '@/types/game';
import {
  getStockAllowance,
  isFreeStockActive,
  POWER_CARD_INFO,
} from '@/types/power-cards';
import { PowerTradePanel } from './PowerTradePanel';
import {
  getStockPrice,
  getSellPrice,
  getSellPriceFactor,
  getRemainingStockAllowance,
  getRemainingSellAllowance,
} from '@/utils/gameLogic';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Minus, Plus, ShoppingCart, Banknote, Sparkles } from 'lucide-react';

/** Shares picked but not yet confirmed, on either side of the panel. */
export interface PendingTrade {
  shares: number;
  cost: number;
  sellShares: number;
  proceeds: number;
}

interface StockPurchaseProps {
  gameState: GameState;
  playerCash: number;
  /** The trading player's holdings — the panel only ever renders for them. */
  playerStocks: Record<ChainName, number>;
  onPurchase: (purchases: { chain: ChainName; quantity: number }[]) => void;
  /** Sell shares back to the bank. Omitted where selling isn't wired up. */
  onSell?: (sales: { chain: ChainName; quantity: number }[]) => void;
  /** Reports shares picked but not yet confirmed, so End Turn can warn about them. */
  onPendingChange?: (pending: PendingTrade) => void;
  /** Power-card trade (Epic 17). Omitted where power cards aren't wired up. */
  onPowerTrade?: (give: { chain: ChainName; quantity: number }[], receive: ChainName) => void;
}

const noSelections = (): Record<ChainName, number> => ({
  sackson: 0,
  tower: 0,
  worldwide: 0,
  american: 0,
  festival: 0,
  continental: 0,
  imperial: 0,
});

export const StockPurchase = ({
  gameState,
  playerCash,
  playerStocks,
  onPurchase,
  onSell,
  onPendingChange,
  onPowerTrade,
}: StockPurchaseProps) => {
  const [selections, setSelections] = useState<Record<ChainName, number>>(noSelections);
  // Kept separate from `selections` so switching tabs preserves both baskets.
  const [sellSelections, setSellSelections] = useState<Record<ChainName, number>>(noSelections);
  const [mode, setMode] = useState<'buy' | 'sell'>('buy');
  const [hasPurchased, setHasPurchased] = useState(false);

  const totalSelected = Object.values(selections).reduce((a, b) => a + b, 0);
  // Shares left in the per-turn cap after what's already been bought this turn.
  // The cap itself is 5 under Extra Purchase and 3 otherwise (Epic 17).
  const allowance = getRemainingStockAllowance(gameState);
  const activePowerCard = gameState.activePowerCard ?? null;
  const buyCap = getStockAllowance(activePowerCard);
  // Free Shares zeroes the price and nothing else — the bank must still hold
  // the shares and the chain must still be active.
  const freeShares = isFreeStockActive(activePowerCard);
  const tradeActive = activePowerCard?.card === 'stock_trade' && !!onPowerTrade;

  // Selling is a room rule; the factor is 0 when it's off. Buying and selling
  // have independent per-turn budgets, so this is its own allowance.
  const sellFactor = getSellPriceFactor(gameState.rulesSnapshot);
  const sellingEnabled = sellFactor > 0 && !!onSell;
  const sellAllowance = getRemainingSellAllowance(gameState);
  const chainsBoughtThisTurn = gameState.chainsBoughtThisTurn ?? [];

  // All chains for display (active first, then inactive/sold out)
  const allChains = (Object.keys(gameState.chains) as ChainName[]);

  const activeChains = allChains
    .filter(chain => gameState.chains[chain].isActive && gameState.stockBank[chain] > 0)
    .sort((a, b) => {
      const priceA = getStockPrice(a, gameState.chains[a].tiles.length);
      const priceB = getStockPrice(b, gameState.chains[b].tiles.length);
      return priceA - priceB;
    });

  // Only active chains can be sold back — a defunct chain has no market price.
  const sellableChains = allChains
    .filter(chain => gameState.chains[chain].isActive && (playerStocks[chain] ?? 0) > 0)
    .sort((a, b) => {
      const priceA = getStockPrice(a, gameState.chains[a].tiles.length);
      const priceB = getStockPrice(b, gameState.chains[b].tiles.length);
      return priceA - priceB;
    });

  const priceOf = (chain: ChainName): number =>
    freeShares ? 0 : getStockPrice(chain, gameState.chains[chain].tiles.length);

  const getTotalCost = (): number => {
    return (Object.entries(selections) as [ChainName, number][]).reduce((total, [chain, qty]) => {
      if (qty === 0) return total;
      return total + (priceOf(chain) * qty);
    }, 0);
  };

  // What the bank pays for the selected basket, and what the same shares are
  // worth at market — the difference is the spread, shown before confirming.
  const getTotalProceeds = (): number => {
    return (Object.entries(sellSelections) as [ChainName, number][]).reduce((total, [chain, qty]) => {
      if (qty === 0) return total;
      return total + getSellPrice(chain, gameState.chains[chain].tiles.length, sellFactor) * qty;
    }, 0);
  };

  const getTotalMarketValue = (): number => {
    return (Object.entries(sellSelections) as [ChainName, number][]).reduce((total, [chain, qty]) => {
      if (qty === 0) return total;
      return total + getStockPrice(chain, gameState.chains[chain].tiles.length) * qty;
    }, 0);
  };

  const totalCost = getTotalCost();
  const canAfford = totalCost <= playerCash;
  const remainingPurchases = allowance - totalSelected;

  const totalSellSelected = Object.values(sellSelections).reduce((a, b) => a + b, 0);
  const totalProceeds = getTotalProceeds();
  const spread = getTotalMarketValue() - totalProceeds;
  const remainingSales = sellAllowance - totalSellSelected;

  useEffect(() => {
    onPendingChange?.({
      shares: totalSelected,
      cost: totalCost,
      sellShares: totalSellSelected,
      proceeds: totalProceeds,
    });
  }, [totalSelected, totalCost, totalSellSelected, totalProceeds, onPendingChange]);

  const soldOutChains = allChains
    .filter(chain => gameState.chains[chain].isActive && gameState.stockBank[chain] === 0);

  const updateSelection = (chain: ChainName, delta: number) => {
    const currentQty = selections[chain];
    const available = gameState.stockBank[chain];
    const newQty = Math.max(0, Math.min(currentQty + delta, available));

    // Check if adding would exceed max purchases
    if (delta > 0 && totalSelected >= allowance) return;

    // Check if can afford (always true while Free Shares is active)
    if (delta > 0 && totalCost + priceOf(chain) > playerCash) return;

    setSelections(prev => ({ ...prev, [chain]: newQty }));
  };

  const updateSellSelection = (chain: ChainName, delta: number) => {
    if (chainsBoughtThisTurn.includes(chain)) return;
    const held = playerStocks[chain] ?? 0;
    const newQty = Math.max(0, Math.min(sellSelections[chain] + delta, held));

    if (delta > 0 && totalSellSelected >= sellAllowance) return;

    setSellSelections(prev => ({ ...prev, [chain]: newQty }));
  };

  const handleBuy = () => {
    const purchases = (Object.entries(selections) as [ChainName, number][])
      .filter(([_, qty]) => qty > 0)
      .map(([chain, quantity]) => ({ chain, quantity }));

    if (purchases.length > 0) {
      onPurchase(purchases);
      setHasPurchased(true);
      // Reset selections after purchase
      setSelections(noSelections());
    }
  };

  const handleSell = () => {
    const sales = (Object.entries(sellSelections) as [ChainName, number][])
      .filter(([_, qty]) => qty > 0)
      .map(([chain, quantity]) => ({ chain, quantity }));

    if (sales.length > 0) {
      onSell?.(sales);
      setSellSelections(noSelections());
    }
  };

  // Nothing to buy and nothing to trade into — a trade needs an active chain on
  // both sides, so there is genuinely nothing this panel could offer.
  if (activeChains.length === 0 && soldOutChains.length === 0) {
    return (
      <div className="bg-card rounded-xl p-6 text-center animate-slide-up">
        <p className="text-muted-foreground">No active chains — use End Turn below.</p>
      </div>
    );
  }

  const showingSell = sellingEnabled && mode === 'sell';

  return (
    <div className="bg-card rounded-xl p-4 md:p-6 animate-slide-up">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{showingSell ? 'Sell Stocks' : 'Buy Stocks'}</h3>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {showingSell ? remainingSales : remainingPurchases} of{' '}
            {showingSell ? sellAllowance + totalSellSelected : buyCap} remaining
          </span>
        </div>
      </div>

      {/* Which card is colouring this buy phase, named rather than implied —
          "Free" prices and a cap of 5 are both surprising enough that the
          player should be able to see why. */}
      {activePowerCard && (
        <div className="flex items-center gap-2 mb-4 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs">
            <span className="font-semibold">{POWER_CARD_INFO[activePowerCard.card].name}</span>
            <span className="text-muted-foreground"> — {POWER_CARD_INFO[activePowerCard.card].summary}</span>
          </p>
        </div>
      )}

      {/* Trading has its own budget and never touches the buy allowance, so it
          sits above the buy/sell switch rather than inside it. */}
      {tradeActive && (
        <div className="mb-4">
          <PowerTradePanel
            gameState={gameState}
            playerStocks={playerStocks}
            onTrade={onPowerTrade!}
          />
        </div>
      )}

      {/* Buy / Sell segmented control — only when the room allows selling.
          Buying and selling have separate budgets, so this is a view switch,
          not an either/or choice. */}
      {sellingEnabled && (
        <div className="grid grid-cols-2 gap-1 p-1 mb-4 rounded-lg bg-muted/50">
          <Button
            variant={mode === 'buy' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMode('buy')}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            Buy
          </Button>
          <Button
            variant={mode === 'sell' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMode('sell')}
          >
            <Banknote className="w-4 h-4 mr-2" />
            Sell
          </Button>
        </div>
      )}

      {showingSell ? (
        <>
          <div className="space-y-3 mb-4">
            {sellableChains.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                You don't hold shares in any active chain.
              </p>
            )}

            {sellableChains.map(chain => {
              const chainState = gameState.chains[chain];
              const price = getStockPrice(chain, chainState.tiles.length);
              const unitProceeds = getSellPrice(chain, chainState.tiles.length, sellFactor);
              const held = playerStocks[chain] ?? 0;
              const selected = sellSelections[chain];
              const boughtThisTurn = chainsBoughtThisTurn.includes(chain);
              const canSellMore = !boughtThisTurn && selected < held && totalSellSelected < sellAllowance;

              return (
                <div
                  key={chain}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg",
                    "bg-secondary/50 border border-border/50",
                    boughtThisTurn && "opacity-50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn("w-4 h-4 rounded-full", `chain-${chain}`)} />
                    <div>
                      <p className="font-medium">{CHAINS[chain].displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {boughtThisTurn
                          ? 'Bought this turn'
                          : `${held} held • $${price.toLocaleString()} market • you receive $${unitProceeds.toLocaleString()}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Sell one fewer ${CHAINS[chain].displayName}`}
                      onClick={() => updateSellSelection(chain, -1)}
                      disabled={selected === 0}
                    >
                      <Minus className="w-4 h-4" />
                    </Button>

                    <span className="w-8 text-center font-mono font-semibold">
                      {selected}
                    </span>

                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Sell one more ${CHAINS[chain].displayName}`}
                      onClick={() => updateSellSelection(chain, 1)}
                      disabled={!canSellMore}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* The spread is shown before confirming, never after. */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 mb-4">
            <div>
              <p className="text-sm text-muted-foreground">Proceeds</p>
              <p className="text-xl font-mono font-bold">${totalProceeds.toLocaleString()}</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Spread</p>
              <p className="text-xl font-mono font-bold text-destructive">
                −${spread.toLocaleString()}
              </p>
            </div>
          </div>

          <Button className="w-full" onClick={handleSell} disabled={totalSellSelected === 0}>
            <Banknote className="w-4 h-4 mr-2" />
            Sell {totalSellSelected} Share{totalSellSelected !== 1 ? 's' : ''}
          </Button>
        </>
      ) : (
        <>
          <div className="space-y-3 mb-4">
            {/* Active purchasable chains */}
            {activeChains.map(chain => {
              const chainState = gameState.chains[chain];
              const marketPrice = getStockPrice(chain, chainState.tiles.length);
              const price = priceOf(chain);
              const available = gameState.stockBank[chain];
              const selected = selections[chain];
              const canBuyMore = selected < available && totalSelected < allowance && totalCost + price <= playerCash;

              return (
                <div
                  key={chain}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg",
                    "bg-secondary/50 border border-border/50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn("w-4 h-4 rounded-full", `chain-${chain}`)} />
                    <div>
                      <p className="font-medium">{CHAINS[chain].displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {freeShares ? (
                          <>
                            <span className="line-through opacity-60">${marketPrice.toLocaleString()}</span>{' '}
                            <span className="font-semibold text-primary">Free</span>
                          </>
                        ) : (
                          <>${marketPrice.toLocaleString()}</>
                        )}
                        {' • '}{available} left
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Buy one fewer ${CHAINS[chain].displayName}`}
                      onClick={() => updateSelection(chain, -1)}
                      disabled={selected === 0}
                    >
                      <Minus className="w-4 h-4" />
                    </Button>

                    <span className="w-8 text-center font-mono font-semibold">
                      {selected}
                    </span>

                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Buy one more ${CHAINS[chain].displayName}`}
                      onClick={() => updateSelection(chain, 1)}
                      disabled={!canBuyMore}
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}

            {/* Sold out chains - muted display */}
            {soldOutChains.map(chain => {
              const chainState = gameState.chains[chain];
              const price = getStockPrice(chain, chainState.tiles.length);

              return (
                <div
                  key={chain}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg",
                    "bg-secondary/30 border border-border/30 opacity-50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn("w-4 h-4 rounded-full opacity-50", `chain-${chain}`)} />
                    <div>
                      <p className="font-medium text-muted-foreground">{CHAINS[chain].displayName}</p>
                      <p className="text-xs text-muted-foreground/60">
                        ${price.toLocaleString()} • Sold Out
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground italic">No shares available</span>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50 mb-4">
            <div>
              <p className="text-sm text-muted-foreground">Total Cost</p>
              <p className={cn(
                "text-xl font-mono font-bold",
                !canAfford && "text-destructive"
              )}>
                ${totalCost.toLocaleString()}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Your Cash</p>
              <p className="text-xl font-mono font-bold cash-display">
                ${playerCash.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Actions */}
          {totalSelected > 0 && (
            <Button
              className="w-full"
              onClick={handleBuy}
              disabled={!canAfford}
            >
              <ShoppingCart className="w-4 h-4 mr-2" />
              Buy {totalSelected} Share{totalSelected !== 1 ? 's' : ''}
            </Button>
          )}

          {hasPurchased && (
            <p className="text-xs text-muted-foreground text-center mt-3">
              Stocks purchased! You can buy more or end your turn.
            </p>
          )}
        </>
      )}
    </div>
  );
};
