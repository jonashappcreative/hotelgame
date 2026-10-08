import { useState } from 'react';
import { ChainName, GameState, CHAINS, MAX_POWER_TRADES, TRADE_GIVE } from '@/types/game';
import { remainingPowerTrades } from '@/types/power-cards';
import { getStockPrice } from '@/utils/gameLogic';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Minus, Plus, Repeat2 } from 'lucide-react';

interface PowerTradePanelProps {
  gameState: GameState;
  /** The trading player's holdings — the panel only renders for them. */
  playerStocks: Record<ChainName, number>;
  onTrade: (give: { chain: ChainName; quantity: number }[], receive: ChainName) => void;
}

const noSelections = (): Record<ChainName, number> => ({
  sackson: 0, tower: 0, worldwide: 0, american: 0,
  festival: 0, continental: 0, imperial: 0,
});

/**
 * Epic 17, Stock Trade. Give exactly TRADE_GIVE shares, take 1 back.
 *
 * Every disabled chain says why rather than simply greying out: the three
 * reasons a chain is unavailable — not on the board, bought this turn, no
 * shares left in the bank — are all rules a player has to learn, and a silent
 * disabled row teaches none of them.
 */
export const PowerTradePanel = ({ gameState, playerStocks, onTrade }: PowerTradePanelProps) => {
  const [give, setGive] = useState<Record<ChainName, number>>(noSelections);
  const [receive, setReceive] = useState<ChainName | null>(null);

  const active = gameState.activePowerCard ?? null;
  const tradesLeft = remainingPowerTrades(active);
  const tradesUsed = MAX_POWER_TRADES - tradesLeft;
  const boughtThisTurn = gameState.chainsBoughtThisTurn ?? [];
  const allChains = Object.keys(gameState.chains) as ChainName[];

  const totalGiven = Object.values(give).reduce((a, b) => a + b, 0);
  const ready = totalGiven === TRADE_GIVE && receive !== null;

  // Both sides are restricted to chains on the board: a defunct chain's
  // certificates are worthless paper and cannot be laundered into live stock.
  const giveReason = (chain: ChainName): string | null => {
    if (!gameState.chains[chain].isActive) return 'Not on the board';
    if (boughtThisTurn.includes(chain)) return 'Bought this turn';
    if ((playerStocks[chain] ?? 0) === 0) return 'You hold none';
    return null;
  };

  const receiveReason = (chain: ChainName): string | null => {
    if (!gameState.chains[chain].isActive) return 'Not on the board';
    if ((gameState.stockBank[chain] ?? 0) === 0) return 'None left in the bank';
    return null;
  };

  const updateGive = (chain: ChainName, delta: number) => {
    const held = playerStocks[chain] ?? 0;
    const next = Math.max(0, Math.min(give[chain] + delta, held));
    if (delta > 0 && totalGiven >= TRADE_GIVE) return;
    setGive((prev) => ({ ...prev, [chain]: next }));
  };

  const handleTrade = () => {
    if (!ready || !receive) return;
    const basket = (Object.entries(give) as [ChainName, number][])
      .filter(([, qty]) => qty > 0)
      .map(([chain, quantity]) => ({ chain, quantity }));
    onTrade(basket, receive);
    setGive(noSelections());
    setReceive(null);
  };

  if (tradesLeft === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-secondary/30 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          All {MAX_POWER_TRADES} trades used this turn.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <Repeat2 className="h-4 w-4 text-primary" />
          Stock Trade
        </h4>
        <span className="text-xs text-muted-foreground">
          Trade {tradesUsed + 1} of {MAX_POWER_TRADES}
        </span>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-muted-foreground">
          Give {totalGiven} of {TRADE_GIVE}
        </p>
        <div className="space-y-1.5">
          {allChains.map((chain) => {
            const reason = giveReason(chain);
            const selected = give[chain];
            return (
              <div
                key={`give-${chain}`}
                className={cn(
                  'flex items-center justify-between rounded-md border border-border/50 bg-secondary/50 px-3 py-2',
                  reason && 'opacity-50',
                )}
              >
                <div className="flex items-center gap-2">
                  <div className={cn('h-3 w-3 rounded-full', `chain-${chain}`)} />
                  <div>
                    <p className="text-sm font-medium">{CHAINS[chain].displayName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {reason ?? `${playerStocks[chain] ?? 0} held`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline" size="icon" className="h-7 w-7"
                    aria-label={`Give one fewer ${CHAINS[chain].displayName}`}
                    onClick={() => updateGive(chain, -1)}
                    disabled={selected === 0}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-5 text-center font-mono text-sm font-semibold">{selected}</span>
                  <Button
                    variant="outline" size="icon" className="h-7 w-7"
                    aria-label={`Give one more ${CHAINS[chain].displayName}`}
                    onClick={() => updateGive(chain, 1)}
                    disabled={!!reason || selected >= (playerStocks[chain] ?? 0) || totalGiven >= TRADE_GIVE}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold text-muted-foreground">Receive 1</p>
        <div className="grid grid-cols-2 gap-1.5">
          {allChains.map((chain) => {
            const reason = receiveReason(chain);
            return (
              <button
                key={`receive-${chain}`}
                type="button"
                onClick={() => setReceive(chain)}
                disabled={!!reason}
                title={reason ?? undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
                  receive === chain
                    ? 'border-primary bg-primary/20'
                    : 'border-border/50 bg-secondary/50 hover:bg-secondary',
                  reason && 'cursor-not-allowed opacity-50 hover:bg-secondary/50',
                )}
              >
                <div className={cn('h-3 w-3 shrink-0 rounded-full', `chain-${chain}`)} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{CHAINS[chain].displayName}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {reason ?? `$${getStockPrice(chain, gameState.chains[chain].tiles.length).toLocaleString()}`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <Button className="w-full" onClick={handleTrade} disabled={!ready}>
        <Repeat2 className="mr-2 h-4 w-4" />
        Trade ({tradesUsed}/{MAX_POWER_TRADES})
      </Button>
    </div>
  );
};
