import { useEffect, useRef, useState } from 'react';
import { useAudio } from '@/contexts/AudioContext';

interface TurnTimerProps {
  durationSeconds: number;
  isActive: boolean;
  onExpire: () => void;
}

export const TurnTimer = ({ durationSeconds, isActive, onExpire }: TurnTimerProps) => {
  const [secondsLeft, setSecondsLeft] = useState(durationSeconds);
  const hasExpiredRef = useRef(false);
  const hasWarnedRef  = useRef(false);
  const { playSfx } = useAudio();

  // Reset when a new turn starts (durationSeconds changes)
  useEffect(() => {
    setSecondsLeft(durationSeconds);
    hasExpiredRef.current = false;
    hasWarnedRef.current  = false;
  }, [durationSeconds]);

  // Countdown interval
  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isActive]);

  // Call onExpire exactly once when countdown hits zero
  useEffect(() => {
    if (isActive && secondsLeft === 0 && !hasExpiredRef.current) {
      hasExpiredRef.current = true;
      onExpire();
    }
  }, [secondsLeft, isActive, onExpire]);

  // Play warning sound once at 10 seconds
  useEffect(() => {
    if (isActive && secondsLeft === 10 && !hasWarnedRef.current) {
      hasWarnedRef.current = true;
      playSfx('timer-warn');
    }
  }, [secondsLeft, isActive, playSfx]);

  if (!isActive) return null;

  const progress = durationSeconds > 0 ? (secondsLeft / durationSeconds) * 100 : 0;
  const isUrgent = secondsLeft <= 10;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${
      isUrgent ? 'bg-destructive/10 border-destructive/40' : 'bg-muted/50 border-muted'
    }`}>
      <span className={`font-bold text-lg tabular-nums min-w-[3ch] text-right ${
        isUrgent ? 'text-destructive' : 'text-foreground'
      }`}>
        {secondsLeft}s
      </span>
      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all duration-1000 ${
            isUrgent ? 'bg-destructive' : 'bg-primary'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};
