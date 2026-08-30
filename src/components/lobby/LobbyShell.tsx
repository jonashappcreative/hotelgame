import { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AudioSettingsButton } from '@/components/AudioSettingsButton';

interface LobbyShellProps {
  /** Omitted on screens with nowhere to go back to. */
  onBack?: () => void;
  backLabel?: string;
  /** 'md' for the single-column screens, 'lg' for the two-column waiting room. */
  width?: 'md' | 'lg';
  children: ReactNode;
}

/**
 * The frame every lobby screen shares: the background, the back button and the
 * audio toggle. Extracted because all five screens had copied it verbatim.
 */
export const LobbyShell = ({ onBack, backLabel = 'Back', width = 'md', children }: LobbyShellProps) => (
  <div className="min-h-screen flex items-center justify-center p-4 bg-cover bg-center bg-no-repeat bg-[linear-gradient(rgba(0,0,0,0.6),rgba(0,0,0,0.6)),url(/Background-image.jpeg)]">
    <div className={`w-full ${width === 'lg' ? 'max-w-4xl' : 'max-w-md'}`}>
      <div className="flex items-center justify-between mb-4">
        {onBack ? (
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {backLabel}
          </Button>
        ) : (
          <span />
        )}
        <AudioSettingsButton variant="outline" />
      </div>
      {children}
    </div>
  </div>
);
