import { useState } from 'react';
import { ChainName, CHAINS, GameState, MergerStockDecision as StockDecision } from '@/types/game';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { getStockPrice } from '@/utils/gameLogic';
import { DollarSign, ArrowRightLeft, Package, TrendingUp } from 'lucide-react';

interface MergerStockDecisionProps {
  gameState: GameState;
  playerIndex: number;
  defunctChain: ChainName;
  survivingChain: ChainName;
  onDecision: (decision: StockDecision) => void;
}

// Render a slider with clickable tick marks below it.
// Ticks are capped at MAX_VISIBLE so the row never crowds on small screens.
const MAX_VISIBLE_TICKS = 13;

function SliderWithTicks({
  value,
  onChange,
  max,
  step = 1,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  max: number;
  step?: number;
  disabled?: boolean;
}) {
  // Compute which tick values to render
  const rawTicks: number[] = [];
  for (let v = 0; v <= max; v += step) rawTicks.push(v);
  if (rawTicks[rawTicks.length - 1] !== max) rawTicks.push(max);

  // If too many ticks, thin them out while keeping 0 and max
  let ticks = rawTicks;
  if (rawTicks.length > MAX_VISIBLE_TICKS) {
    const stride = Math.ceil((rawTicks.length - 1) / (MAX_VISIBLE_TICKS - 1));
    ticks = rawTicks.filter((_, i) => i % stride === 0);
    if (ticks[ticks.length - 1] !== max) ticks.push(max);
  }

  return (
    <div className="space-y-0.5">
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        max={Math.max(max, 1)}
        step={step}
        disabled={disabled || max === 0}
        className="w-full"
      />

      {/* Tick marks — positioned proportionally under the track */}
      {max > 0 && (
        <div className="relative h-6 px-[8px]">
          {ticks.map((v) => {
            const pct = (v / max) * 100;
            return (
              <button
                key={v}
                type="button"
                disabled={disabled || max === 0}
                onClick={() => onChange(v)}
                className="absolute flex flex-col items-center -translate-x-1/2 group"
                style={{ left: `${pct}%` }}
                aria-label={`Set to ${v}`}
              >
                <div
                  className={`w-px transition-colors ${
                    v === value
                      ? 'h-2.5 bg-primary'
                      : 'h-1.5 bg-border group-hover:bg-primary/70'
                  }`}
                />
                <span
                  className={`text-[9px] leading-none select-none transition-colors ${
                    v === value
                      ? 'text-primary font-semibold'
                      : 'text-muted-foreground group-hover:text-primary/70'
                  }`}
                >
                  {v}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const MergerStockDecision = ({
  gameState,
  playerIndex,
  defunctChain,
  survivingChain,
  onDecision,
}: MergerStockDecisionProps) => {
  const player = gameState.players[playerIndex];
  const totalShares = player.stocks[defunctChain];

  const [sell, setSell] = useState(0);
  const [trade, setTrade] = useState(0);

  const defunctInfo = CHAINS[defunctChain];
  const survivingInfo = CHAINS[survivingChain];

  const defunctPrice  = getStockPrice(defunctChain,  gameState.chains[defunctChain].tiles.length);
  const survivingPrice = getStockPrice(survivingChain, gameState.chains[survivingChain].tiles.length);
  const availableForTrade = gameState.stockBank[survivingChain];

  const adjustedTrade = Math.floor(trade / 2) * 2;
  const receivedShares = adjustedTrade / 2;
  const keepShares = totalShares - sell - adjustedTrade;

  const maxSell = totalShares;
  const maxTrade = Math.min(totalShares, availableForTrade * 2);

  const saleValue = sell * defunctPrice;
  const existingSurviving = player.stocks[survivingChain] ?? 0;
  const newSurvivingTotal = existingSurviving + receivedShares;
  const receivedValue = receivedShares * survivingPrice;

  const handleSellChange = (newSell: number) => {
    setSell(newSell);
    const remaining = totalShares - newSell;
    if (adjustedTrade > remaining) {
      setTrade(Math.floor(remaining / 2) * 2);
    }
  };

  const handleTradeChange = (v: number) => {
    const even = Math.floor(v / 2) * 2;
    const capped = Math.min(even, maxTrade);
    setTrade(capped);
    const maxAllowedSell = totalShares - capped;
    if (sell > maxAllowedSell) setSell(maxAllowedSell);
  };

  const handleConfirm = () => {
    onDecision({ sell, trade: adjustedTrade, keep: keepShares });
  };

  const sellAll  = () => { setSell(totalShares); setTrade(0); };
  const tradeAll = () => { setSell(0); setTrade(Math.floor(maxTrade / 2) * 2); };
  const keepAll  = () => { setSell(0); setTrade(0); };

  return (
    <Card className="bg-card border-chain-merger/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{player.name}'s Stock Decision</CardTitle>
          <Badge style={{ backgroundColor: defunctInfo.color, color: defunctInfo.textColor }}>
            {totalShares} {defunctInfo.displayName} shares
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {defunctInfo.displayName} is being acquired by {survivingInfo.displayName}.
          Decide what to do with your shares.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" onClick={sellAll}>Sell All</Button>
          <Button variant="outline" size="sm" onClick={tradeAll} disabled={availableForTrade === 0}>
            Trade All
          </Button>
          <Button variant="outline" size="sm" onClick={keepAll}>Keep All</Button>
        </div>

        {/* Sell slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-cash" />
              <span className="font-medium">Sell</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tabular-nums text-cash">{sell}</span>
              <span className="text-sm text-muted-foreground">
                {sell > 0 ? `= $${saleValue.toLocaleString()}` : `@ $${defunctPrice}/share`}
              </span>
            </div>
          </div>
          <SliderWithTicks value={sell} onChange={handleSellChange} max={maxSell} step={1} />
        </div>

        {/* Trade slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-primary" />
              <span className="font-medium">Trade (2:1)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tabular-nums text-primary">{adjustedTrade}</span>
              <span className="text-sm text-muted-foreground">
                {adjustedTrade > 0
                  ? `→ ${receivedShares} ${survivingInfo.displayName}`
                  : `→ ${survivingInfo.displayName}`}
              </span>
            </div>
          </div>
          <SliderWithTicks
            value={trade}
            onChange={handleTradeChange}
            max={maxTrade}
            step={2}
            disabled={availableForTrade === 0}
          />
          <p className="text-xs text-muted-foreground">
            {availableForTrade} {survivingInfo.displayName} shares available in bank
          </p>
        </div>

        {/* Keep row */}
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Keep</span>
          </div>
          <span className="text-2xl font-bold tabular-nums">{keepShares}</span>
        </div>

        {/* Post-trade portfolio */}
        <div className="border border-border rounded-lg p-3 space-y-2.5">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              After this decision
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {/* Cash gained */}
            <div>
              <p className="text-muted-foreground text-xs">Cash gained</p>
              <p className={`text-lg font-bold tabular-nums ${sell > 0 ? 'text-cash' : 'text-muted-foreground/50'}`}>
                {sell > 0 ? `+$${saleValue.toLocaleString()}` : '—'}
              </p>
            </div>

            {/* Surviving chain shares */}
            <div>
              <p className="text-muted-foreground text-xs">{survivingInfo.displayName} shares</p>
              {receivedShares > 0 ? (
                <>
                  <p className="text-lg font-bold tabular-nums text-primary">
                    {existingSurviving} + {receivedShares} = {newSurvivingTotal}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    worth ${(newSurvivingTotal * survivingPrice).toLocaleString()}
                    {receivedValue > 0 && (
                      <span className="text-primary ml-1">(+${receivedValue.toLocaleString()})</span>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-lg font-bold tabular-nums text-muted-foreground/50">{existingSurviving}</p>
              )}
            </div>

            {/* Kept defunct shares */}
            {keepShares > 0 && (
              <div className="col-span-2">
                <p className="text-muted-foreground text-xs">{defunctInfo.displayName} kept</p>
                <p className="text-lg font-bold tabular-nums">{keepShares} shares</p>
                <p className="text-xs text-muted-foreground">
                  end-game value: ${(keepShares * defunctPrice).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </div>

        <Button onClick={handleConfirm} className="w-full" size="lg">
          Confirm Decision
        </Button>
      </CardContent>
    </Card>
  );
};
