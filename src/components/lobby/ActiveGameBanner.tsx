import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export interface ActiveGameInfo {
  roomCode: string;
  roomId: string;
  playerName: string;
  roomStatus: string;
}

interface ActiveGameBannerProps {
  info: ActiveGameInfo | null;
  isLoading?: boolean;
  onRejoin?: () => void;
  onDismiss?: () => void;
  /** 'card' stands alone on the menu; 'inline' sits inside another card. */
  variant?: 'card' | 'inline';
}

/**
 * "You have a game in progress" — shown on the menu, create and join screens.
 * One component instead of the three near-identical copies that existed before.
 */
export const ActiveGameBanner = ({
  info,
  isLoading,
  onRejoin,
  onDismiss,
  variant = 'inline',
}: ActiveGameBannerProps) => {
  if (!info) return null;

  const body = (
    <div className="flex items-start gap-3">
      <div className={`${variant === 'card' ? 'w-10 h-10' : 'w-8 h-8'} rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0`}>
        <RefreshCw className={`${variant === 'card' ? 'h-5 w-5' : 'h-4 w-4'} text-primary`} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-sm">Active Game Found</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {variant === 'card' ? (
            <>
              You have an {info.roomStatus === 'playing' ? 'ongoing' : 'active'} game in room{' '}
              <span className="font-mono font-medium">{info.roomCode}</span>
            </>
          ) : (
            <>
              Room <span className="font-mono font-medium">{info.roomCode}</span>
            </>
          )}
        </p>
        <div className={`flex gap-2 ${variant === 'card' ? 'mt-3' : 'mt-2'}`}>
          <Button
            size="sm"
            onClick={onRejoin}
            disabled={isLoading}
            className={variant === 'card' ? 'flex-1' : undefined}
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1.5" />
            )}
            {variant === 'card' ? 'Rejoin Game' : 'Rejoin'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss} disabled={isLoading}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );

  if (variant === 'card') {
    return (
      <Card className="mb-4 border-primary/50 bg-primary/5">
        <CardContent className="p-4">{body}</CardContent>
      </Card>
    );
  }

  return <div className="p-3 rounded-lg border border-primary/50 bg-primary/5 mb-2">{body}</div>;
};
