import { useState } from 'react';
import { GameState } from '@/types/game';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Flag, Check, X } from 'lucide-react';

interface EndGameVoteProps {
  gameState: GameState;
  currentPlayerId: string;
  onVote: (vote: boolean) => void;
  canCallVote: boolean;
}

export const EndGameVote = ({
  gameState,
  currentPlayerId,
  onVote,
  canCallVote,
}: EndGameVoteProps) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Check if current player has already voted
  const hasVoted = gameState.endGameVotes?.includes(currentPlayerId);
  const votesNeeded = Math.ceil(gameState.players.length / 2);
  const currentVotes = gameState.endGameVotes?.length || 0;

  // Check end game eligibility
  const activeChains = Object.values(gameState.chains).filter(c => c.isActive);
  const safeChains = activeChains.filter(c => c.isSafe);
  const hasChainOver40 = activeChains.some(c => c.tiles.length >= 41);
  const allChainsSafe = activeChains.length > 0 && activeChains.every(c => c.isSafe);

  const canEndGame = safeChains.length > 0 || hasChainOver40 || allChainsSafe;

  if (!canCallVote || !canEndGame) {
    return null;
  }

  const handleVote = (vote: boolean) => {
    onVote(vote);
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          className="border-chain-merger text-chain-merger hover:bg-chain-merger/10"
        >
          <Flag className="h-4 w-4 mr-2" />
          End Game Vote
          {currentVotes > 0 && (
            <Badge variant="secondary" className="ml-2">
              {currentVotes}/{votesNeeded}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vote to End Game</DialogTitle>
          <DialogDescription>
            The game can end now because:
            {safeChains.length > 0 && (
              <span className="block mt-1">
                • {safeChains.length} chain{safeChains.length > 1 ? 's are' : ' is'} safe (11+ tiles)
              </span>
            )}
            {hasChainOver40 && (
              <span className="block mt-1">
                • A chain has reached 41+ tiles
              </span>
            )}
            {allChainsSafe && (
              <span className="block mt-1">
                • All chains are safe
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          <div className="p-4 bg-muted/50 rounded-lg">
            <p className="text-sm text-center mb-2">
              Votes needed: <span className="font-bold">{votesNeeded}</span>
            </p>
            <p className="text-sm text-center">
              Current votes: <span className="font-bold text-primary">{currentVotes}</span>
            </p>
          </div>

          {hasVoted ? (
            <div className="text-center p-4">
              <Check className="h-8 w-8 mx-auto text-green-500 mb-2" />
              <p className="text-sm text-muted-foreground">
                You have already voted to end the game
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                onClick={() => handleVote(false)}
                className="h-16"
              >
                <X className="h-5 w-5 mr-2" />
                Continue Playing
              </Button>
              <Button
                onClick={() => handleVote(true)}
                className="h-16"
              >
                <Flag className="h-5 w-5 mr-2" />
                End Game Now
              </Button>
            </div>
          )}

          {currentVotes > 0 && (
            <div className="text-xs text-muted-foreground text-center">
              Players who voted to end: {gameState.players
                .filter(p => gameState.endGameVotes?.includes(p.id))
                .map(p => p.name)
                .join(', ')}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
