import { useState, useMemo } from 'react';
import { ChainName, CHAINS, GameState, MergerStockDecision as StockDecision } from '@/types/game';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { getStockPrice } from '@/utils/gameLogic';
import { DollarSign, ArrowRightLeft, Package } from 'lucide-react';

interface MergerStockDecisionProps {
  gameState: GameState;
  playerIndex: number;
  defunctChain: ChainName;
  survivingChain: ChainName;
  onDecision: (decision: StockDecision) => void;
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
  const keep = totalShares - sell - trade;

  const defunctInfo = CHAINS[defunctChain];
  const survivingInfo = CHAINS[survivingChain];
  
  const stockPrice = getStockPrice(defunctChain, gameState.chains[defunctChain].tiles.length);
  const availableForTrade = gameState.stockBank[survivingChain];
  const maxTradeShares = Math.min(
    totalShares - sell,
    availableForTrade * 2 // 2:1 ratio
  );

  // Ensure trade is always even (2:1 ratio)
  const adjustedTrade = Math.floor(trade / 2) * 2;
  const receivedShares = adjustedTrade / 2;

  const saleValue = sell * stockPrice;
  
  const handleSellChange = (value: number[]) => {
    const newSell = value[0];
    setSell(newSell);
    // Adjust trade if needed
    const remaining = totalShares - newSell;
    if (adjustedTrade > remaining) {
      setTrade(Math.floor(remaining / 2) * 2);
    }
  };

  const handleTradeChange = (value: number[]) => {
    // Ensure even number for 2:1 trade
    const newTrade = Math.floor(value[0] / 2) * 2;
    setTrade(Math.min(newTrade, totalShares - sell, maxTradeShares));
  };

  const handleConfirm = () => {
    onDecision({
      sell,
      trade: adjustedTrade,
      keep: totalShares - sell - adjustedTrade,
    });
  };

  // Quick action buttons
  const sellAll = () => {
    setSell(totalShares);
    setTrade(0);
  };

  const tradeAll = () => {
    const maxTrade = Math.min(totalShares, maxTradeShares);
    const evenMax = Math.floor(maxTrade / 2) * 2;
    setSell(0);
    setTrade(evenMax);
  };

  const keepAll = () => {
    setSell(0);
    setTrade(0);
  };

  return (
    <Card className="bg-card border-chain-merger/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">
            {player.name}'s Stock Decision
          </CardTitle>
          <Badge 
            style={{ backgroundColor: defunctInfo.color, color: defunctInfo.textColor }}
          >
            {totalShares} {defunctInfo.displayName} shares
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {defunctInfo.displayName} is being acquired by {survivingInfo.displayName}. 
          Decide what to do with your shares.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" size="sm" onClick={sellAll}>
            Sell All
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={tradeAll}
            disabled={availableForTrade === 0}
          >
            Trade All
          </Button>
          <Button variant="outline" size="sm" onClick={keepAll}>
            Keep All
          </Button>
        </div>

        {/* Sell Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-cash" />
              <span className="font-medium">Sell</span>
            </div>
            <span className="text-sm">
              {sell} shares = <span className="text-cash font-bold">${saleValue.toLocaleString()}</span>
            </span>
          </div>
          <Slider
            value={[sell]}
            onValueChange={handleSellChange}
            max={totalShares}
            step={1}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground">
            Sell at ${stockPrice}/share
          </p>
        </div>

        {/* Trade Section */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-primary" />
              <span className="font-medium">Trade (2:1)</span>
            </div>
            <span className="text-sm">
              {adjustedTrade} → <span className="text-primary font-bold">{receivedShares} {survivingInfo.displayName}</span>
            </span>
          </div>
          <Slider
            value={[trade]}
            onValueChange={handleTradeChange}
            max={totalShares - sell}
            step={2}
            className="w-full"
            disabled={availableForTrade === 0}
          />
          <p className="text-xs text-muted-foreground">
            {availableForTrade} {survivingInfo.displayName} shares available in bank
          </p>
        </div>

        {/* Keep Section */}
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Keep</span>
          </div>
          <span className="text-lg font-bold">
            {totalShares - sell - adjustedTrade} shares
          </span>
        </div>

        {/* Summary */}
        <div className="p-3 bg-primary/10 rounded-lg space-y-1">
          <p className="text-sm font-medium">Summary:</p>
          <ul className="text-sm space-y-1">
            {sell > 0 && (
              <li className="text-cash">
                + ${saleValue.toLocaleString()} cash from selling
              </li>
            )}
            {receivedShares > 0 && (
              <li className="text-primary">
                + {receivedShares} {survivingInfo.displayName} shares from trading
              </li>
            )}
            {totalShares - sell - adjustedTrade > 0 && (
              <li className="text-muted-foreground">
                Keep {totalShares - sell - adjustedTrade} {defunctInfo.displayName} shares (for end game)
              </li>
            )}
          </ul>
        </div>

        <Button 
          onClick={handleConfirm} 
          className="w-full"
          size="lg"
        >
          Confirm Decision
        </Button>
      </CardContent>
    </Card>
  );
};
