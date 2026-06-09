import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { Howl } from 'howler';

export type SfxName =
  | 'tile-place'
  | 'chain-founded'
  | 'merger-fanfare'
  | 'buy-stock'
  | 'game-over'
  | 'your-turn'
  | 'player-join'
  | 'timer-warn'
  | 'ui-click';

const SFX_FILES: Record<SfxName, string> = {
  'tile-place':     '/sounds/sfx/tile-place.mp3',
  'chain-founded':  '/sounds/sfx/chain-founded.mp3',
  'merger-fanfare': '/sounds/sfx/merger-fanfare.mp3',
  'buy-stock':      '/sounds/sfx/buy-stock.mp3',
  'game-over':      '/sounds/sfx/game-over.mp3',
  'your-turn':      '/sounds/sfx/your-turn.mp3',
  'player-join':    '/sounds/sfx/player-join.mp3',
  'timer-warn':     '/sounds/sfx/timer-warn.mp3',
  'ui-click':       '/sounds/sfx/ui-click.mp3',
};

// Voice lines that play after their associated SFX
const VOICE_FILES: Record<string, string> = {
  'merger-fanfare': '/sounds/voice/acquisition-triggered.mp3',
  'chain-founded':  '/sounds/voice/hotel-established.mp3',
};

const MUSIC_TRACKS = [
  '/sounds/sfx/music/music-01.mp3',
  '/sounds/sfx/music/music-02.mp3',
  '/sounds/sfx/music/music-03.mp3',
  '/sounds/sfx/music/music-04.mp3',
];

const LS_MUSIC  = 'audio_music_volume';
const LS_SFX    = 'audio_sfx_volume';
const LS_VOICE  = 'audio_voice_volume';

interface AudioContextType {
  musicVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  setMusicVolume: (v: number) => void;
  setSfxVolume: (v: number) => void;
  setVoiceVolume: (v: number) => void;
  playSfx: (name: SfxName) => void;
}

const AudioCtx = createContext<AudioContextType | undefined>(undefined);

export function AudioProvider({ children }: { children: ReactNode }) {
  const [musicVolume, setMusicVolumeState] = useState<number>(() => {
    const s = localStorage.getItem(LS_MUSIC);
    return s !== null ? parseFloat(s) : 0.4;
  });
  const [sfxVolume, setSfxVolumeState] = useState<number>(() => {
    const s = localStorage.getItem(LS_SFX);
    return s !== null ? parseFloat(s) : 0.7;
  });
  const [voiceVolume, setVoiceVolumeState] = useState<number>(() => {
    const s = localStorage.getItem(LS_VOICE);
    return s !== null ? parseFloat(s) : 0.7;
  });

  // Mutable refs so callbacks always read latest values without re-creating
  const musicVolumeRef = useRef(musicVolume);
  const sfxVolumeRef   = useRef(sfxVolume);
  const voiceVolumeRef = useRef(voiceVolume);
  musicVolumeRef.current = musicVolume;
  sfxVolumeRef.current   = sfxVolume;
  voiceVolumeRef.current = voiceVolume;

  const sfxHowlsRef   = useRef<Map<SfxName, Howl>>(new Map());
  const voiceHowlsRef = useRef<Map<string, Howl>>(new Map());
  const musicHowlRef  = useRef<Howl | null>(null);
  const trackIndexRef = useRef<number>(Math.floor(Math.random() * MUSIC_TRACKS.length));
  const unlockedRef   = useRef(false);

  // Stable ref to playNextTrack so the onend closure never goes stale
  const playNextTrackRef = useRef<() => void>(() => {});

  const playNextTrack = useCallback(() => {
    if (musicVolumeRef.current === 0) return;

    const src = MUSIC_TRACKS[trackIndexRef.current];
    if (musicHowlRef.current) {
      musicHowlRef.current.unload();
    }

    musicHowlRef.current = new Howl({
      src: [src],
      volume: musicVolumeRef.current,
      html5: true,
      loop: false,
      onend: () => {
        trackIndexRef.current = (trackIndexRef.current + 1) % MUSIC_TRACKS.length;
        playNextTrackRef.current();
      },
    });

    musicHowlRef.current.play();
  }, []);

  playNextTrackRef.current = playNextTrack;

  // Preload SFX and voice howls once on mount
  useEffect(() => {
    const sfxMap   = sfxHowlsRef.current;
    const voiceMap = voiceHowlsRef.current;

    for (const [name, src] of Object.entries(SFX_FILES) as [SfxName, string][]) {
      sfxMap.set(name, new Howl({ src: [src], volume: sfxVolumeRef.current, preload: true }));
    }

    for (const [name, src] of Object.entries(VOICE_FILES)) {
      voiceMap.set(name, new Howl({ src: [src], volume: voiceVolumeRef.current, preload: true }));
    }

    return () => {
      sfxMap.forEach(h => h.unload());
      sfxMap.clear();
      voiceMap.forEach(h => h.unload());
      voiceMap.clear();
      musicHowlRef.current?.unload();
    };
  }, []);

  // Start music on first user interaction (browser autoplay policy)
  useEffect(() => {
    const unlock = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      if (musicVolumeRef.current > 0) playNextTrackRef.current();
    };
    document.addEventListener('click',   unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('click',   unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

  // Pause / resume music when tab is hidden / shown
  useEffect(() => {
    const onVisibility = () => {
      if (!musicHowlRef.current) return;
      if (document.hidden) {
        musicHowlRef.current.pause();
      } else if (musicVolumeRef.current > 0) {
        musicHowlRef.current.play();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const setMusicVolume = useCallback((v: number) => {
    setMusicVolumeState(v);
    localStorage.setItem(LS_MUSIC, String(v));
    musicVolumeRef.current = v;

    if (v === 0) {
      musicHowlRef.current?.pause();
    } else if (musicHowlRef.current) {
      musicHowlRef.current.volume(v);
      if (!musicHowlRef.current.playing() && unlockedRef.current) {
        musicHowlRef.current.play();
      }
    } else if (unlockedRef.current) {
      playNextTrackRef.current();
    }
  }, []);

  const setSfxVolume = useCallback((v: number) => {
    setSfxVolumeState(v);
    localStorage.setItem(LS_SFX, String(v));
    sfxVolumeRef.current = v;
    sfxHowlsRef.current.forEach(h => h.volume(v));
  }, []);

  const setVoiceVolume = useCallback((v: number) => {
    setVoiceVolumeState(v);
    localStorage.setItem(LS_VOICE, String(v));
    voiceVolumeRef.current = v;
    voiceHowlsRef.current.forEach(h => h.volume(v));
  }, []);

  const playSfx = useCallback((name: SfxName) => {
    if (sfxVolumeRef.current === 0) return;
    const howl = sfxHowlsRef.current.get(name);
    if (!howl) return;

    howl.stop();
    const id = howl.play();

    // Chain voice line after SFX ends, if one is registered for this event
    const voiceHowl = voiceHowlsRef.current.get(name);
    if (voiceHowl && id !== undefined && voiceVolumeRef.current > 0) {
      howl.once('end', () => {
        voiceHowl.stop();
        voiceHowl.play();
      }, id);
    }
  }, []);

  return (
    <AudioCtx.Provider value={{ musicVolume, sfxVolume, voiceVolume, setMusicVolume, setSfxVolume, setVoiceVolume, playSfx }}>
      {children}
    </AudioCtx.Provider>
  );
}

export function useAudio() {
  const ctx = useContext(AudioCtx);
  if (!ctx) throw new Error('useAudio must be used within AudioProvider');
  return ctx;
}
