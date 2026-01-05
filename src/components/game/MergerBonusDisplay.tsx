import { ChainName, CHAINS, GameState } from '@/types/game';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getBonuses, getStockholderRankings, getStockPrice } from '@/utils/gameLogic';
import { Trophy, Award, DollarSign } from 'lucide-react';

interface MergerBonusDisplayProps {
  gameState: GameState;
  defunctChain: ChainName;
  onContinue: () => void;
}

export const MergerBonusDisplay = ({
  gameState,
  defunctChain,
  onContinue,
}: MergerBonusDisplayProps) => {
  const chainInfo = CHAINS[defunctChain];
  const chainSize = gameState.chains[defunctChain].tiles.length;
  const stockPrice = getStockPrice(defunctChain, chainSize);
  const bonuses = getBonuses(defunctChain, chainSize);
  const { majority, minority } = getStockholderRankings(gameState.players, defunctChain);

  // Calculate individual payouts
  const majorityPayout = majority.length > 0 
    ? (minority.length === 0 
        ? Math.floor((bonuses.majority + bonuses.minority) / majority.length)
        : Math.floor(bonuses.majority / majority.length))
    : 0;

  const minorityPayout = minority.length > 0 
    ? Math.floor(bonuses.minority / minority.length)
    : 0;

  return (
    <Card className="bg-card border-chain-merger/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Trophy className="h-5 w-5 text-chain-merger" />
            Merger Bonuses
          </CardTitle>
          <Badge 
            style={{ backgroundColor: chainInfo.color, color: chainInfo.textColor }}
          >
            {chainInfo.displayName}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {chainInfo.displayName} ({chainSize} tiles) is being acquired. 
          Stock price: ${stockPrice}/share
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Bonus Amounts */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-chain-majority/20 rounded-lg text-center">
            <Trophy className="h-5 w-5 mx-auto mb-1 text-chain-majority" />
            <p className="text-xs text-muted-foreground">Majority Bonus</p>
            <p className="text-lg font-bold text-chain-majority">
              ${bonuses.majority.toLocaleString()}
            </p>
          </div>
          <div className="p-3 bg-chain-minority/20 rounded-lg text-center">
            <Award className="h-5 w-5 mx-auto mb-1 text-chain-minority" />
            <p className="text-xs text-muted-foreground">Minority Bonus</p>
            <p className="text-lg font-bold text-chain-minority">
              ${bonuses.minority.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Majority Holders */}
        {majority.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-chain-majority" />
              <span className="font-medium">Majority Stockholder{majority.length > 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-1">
              {majority.map(player => (
                <div 
                  key={player.id}
                  className="flex items-center justify-between p-2 bg-muted/50 rounded"
                >
                  <div>
                    <span className="font-medium">{player.name}</span>
                    <span className="text-sm text-muted-foreground ml-2">
                      ({player.stocks[defunctChain]} shares)
                    </span>
                  </div>
                  <span className="text-cash font-bold">
                    +${majorityPayout.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            {majority.length > 1 && minority.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                Tied for majority - splitting both bonuses
              </p>
            )}
          </div>
        )}

        {/* Minority Holders */}
        {minority.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-chain-minority" />
              <span className="font-medium">Minority Stockholder{minority.length > 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-1">
              {minority.map(player => (
                <div 
                  key={player.id}
                  className="flex items-center justify-between p-2 bg-muted/50 rounded"
                >
                  <div>
                    <span className="font-medium">{player.name}</span>
                    <span className="text-sm text-muted-foreground ml-2">
                      ({player.stocks[defunctChain]} shares)
                    </span>
                  </div>
                  <span className="text-cash font-bold">
                    +${minorityPayout.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No stockholders */}
        {majority.length === 0 && (
          <p className="text-center text-muted-foreground py-4">
            No players own {chainInfo.displayName} stock - no bonuses paid
          </p>
        )}

        <Button onClick={onContinue} className="w-full" size="lg">
          <DollarSign className="h-4 w-4 mr-2" />
          Pay Bonuses & Continue
        </Button>
      </CardContent>
    </Card>
  );
};
