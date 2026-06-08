import { useState } from 'react';
import { Settings, Volume2, Music, Mic, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAudio } from '@/contexts/AudioContext';

interface AudioSettingsButtonProps {
  variant?: 'ghost' | 'outline';
}

export const AudioSettingsButton = ({ variant = 'ghost' }: AudioSettingsButtonProps) => {
  const [open, setOpen] = useState(false);
  const { musicVolume, sfxVolume, voiceVolume, setMusicVolume, setSfxVolume, setVoiceVolume } = useAudio();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant={variant} size="icon" title="Sound settings" className="shrink-0">
          <Settings className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end" sideOffset={8}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium">Sound Settings</p>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 -mr-1"
            onClick={() => setOpen(false)}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div className="space-y-4">
          {/* Music slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Music className="w-3.5 h-3.5" />
                Music
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(musicVolume * 100)}%
              </span>
            </div>
            <Slider
              value={[musicVolume * 100]}
              min={0}
              max={100}
              step={1}
              onValueChange={([v]) => setMusicVolume(v / 100)}
            />
          </div>

          {/* SFX slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Volume2 className="w-3.5 h-3.5" />
                Sound Effects
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(sfxVolume * 100)}%
              </span>
            </div>
            <Slider
              value={[sfxVolume * 100]}
              min={0}
              max={100}
              step={1}
              onValueChange={([v]) => setSfxVolume(v / 100)}
            />
          </div>

          {/* Voice slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Mic className="w-3.5 h-3.5" />
                Voice
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">
                {Math.round(voiceVolume * 100)}%
              </span>
            </div>
            <Slider
              value={[voiceVolume * 100]}
              min={0}
              max={100}
              step={1}
              onValueChange={([v]) => setVoiceVolume(v / 100)}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
