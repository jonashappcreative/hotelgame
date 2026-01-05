import { ChainName, CHAINS, GameState } from '@/types/game';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Crown } from 'lucide-react';

interface MergerSurvivorChoiceProps {
  chains: ChainName[];
  chainSizes: Record<ChainName, number>;
  onSelectSurvivor: (chain: ChainName) => void;
}

export const MergerSurvivorChoice = ({
  chains,
  chainSizes,
  onSelectSurvivor,
}: MergerSurvivorChoiceProps) => {
  // Sort by size (descending), then by tier (premium > midrange > budget)
  const sortedChains = [...chains].sort((a, b) => {
    const sizeA = chainSizes[a] || 0;
    const sizeB = chainSizes[b] || 0;
    if (sizeB !== sizeA) return sizeB - sizeA;
    const tierOrder = { premium: 3, midrange: 2, budget: 1 };
    return tierOrder[CHAINS[b].tier] - tierOrder[CHAINS[a].tier];
  });

  const maxSize = Math.max(...chains.map(c => chainSizes[c] || 0));

  return (
    <Card className="bg-card border-chain-merger/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Crown className="h-5 w-5 text-chain-merger" />
          Choose Surviving Chain
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Multiple chains are tied for largest. Select which chain will survive the merger.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {sortedChains.map(chain => {
          const info = CHAINS[chain];
          const size = chainSizes[chain] || 0;
          const isTied = size === maxSize;

          return (
            <Button
              key={chain}
              variant="outline"
              className="w-full h-auto p-4 flex items-center justify-between hover:border-primary"
              style={{
                borderColor: info.color,
                backgroundColor: `${info.color}15`,
              }}
              onClick={() => onSelectSurvivor(chain)}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                  style={{ backgroundColor: info.color, color: info.textColor }}
                >
                  {info.displayName[0]}
                </div>
                <div className="text-left">
                  <p className="font-semibold">{info.displayName}</p>
                  <p className="text-xs text-muted-foreground capitalize">{info.tier} tier</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-bold text-lg">{size} tiles</p>
                {isTied && (
                  <p className="text-xs text-chain-merger">Tied for largest</p>
                )}
              </div>
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
};
