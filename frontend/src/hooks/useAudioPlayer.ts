import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import type { Entry } from '../types/api';
import { getSafeHttpUrl } from '../utils/sanitize';
import { parseAudioDurationSeconds } from '../utils/time';

export const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export interface AudioPlayerController {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTrack: Entry | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: PlaybackRate;
  isLoading: boolean;
  error: string | null;
  playTrack: (entry: Entry, startSeconds?: number) => void;
  togglePlay: () => void;
  seekTo: (seconds: number) => void;
  skipBy: (deltaSeconds: number) => void;
  setPlaybackRate: (rate: PlaybackRate) => void;
  closePlayer: () => void;
}

export function useAudioPlayer(
  onProgressSynced?: (entryId: number, playbackSeconds: number) => void,
): AudioPlayerController {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTrack, setCurrentTrack] = useState<Entry | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRateState] = useState<PlaybackRate>(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingSeekRef = useRef<number | null>(null);
  const lastSyncedRef = useRef<{ entryId: number; seconds: number } | null>(null);
  const currentTrackRef = useRef<Entry | null>(null);
  const currentTimeRef = useRef<number>(0);

  currentTrackRef.current = currentTrack;
  currentTimeRef.current = currentTime;

  const syncProgress = useCallback(
    async (entryId: number, rawSeconds: number) => {
      const seconds = Math.max(0, Math.floor(rawSeconds));
      if (
        lastSyncedRef.current &&
        lastSyncedRef.current.entryId === entryId &&
        lastSyncedRef.current.seconds === seconds
      ) {
        return;
      }
      lastSyncedRef.current = { entryId, seconds };
      try {
        await apiClient.updateEntry(entryId, { playback_seconds: seconds });
        onProgressSynced?.(entryId, seconds);
      } catch {
        // Non-blocking sync failure
      }
    },
    [onProgressSynced],
  );

  // Sync playback progress every 15 seconds while playing
  useEffect(() => {
    if (!isPlaying || !currentTrack) return;
    const interval = window.setInterval(() => {
      const track = currentTrackRef.current;
      const audio = audioRef.current;
      if (!track) return;
      const secs = audio ? audio.currentTime : currentTimeRef.current;
      void syncProgress(track.id, secs);
    }, 15_000);

    return () => window.clearInterval(interval);
  }, [isPlaying, currentTrack, syncProgress]);

  // Keep <audio> element playbackRate in sync
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = playbackRate;
    }
  }, [playbackRate, currentTrack]);

  // Attach native audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setIsLoading(false);
      if (Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
      audio.playbackRate = playbackRate;
      if (pendingSeekRef.current !== null) {
        const target = Math.max(
          0,
          Number.isFinite(audio.duration)
            ? Math.min(pendingSeekRef.current, audio.duration)
            : pendingSeekRef.current,
        );
        audio.currentTime = target;
        setCurrentTime(target);
        pendingSeekRef.current = null;
      }
    };

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
      setError(null);
    };

    const handlePause = () => {
      setIsPlaying(false);
      const track = currentTrackRef.current;
      if (track) {
        void syncProgress(track.id, audio.currentTime);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      const track = currentTrackRef.current;
      if (track) {
        void syncProgress(track.id, audio.duration || audio.currentTime);
      }
    };

    const handleWaiting = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);
    const handleError = () => {
      setIsLoading(false);
      setIsPlaying(false);
      setError('音频加载失败，请检查音频链接或稍后重试');
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('error', handleError);
    };
  }, [playbackRate, syncProgress, currentTrack]);

  const safePlay = useCallback((audio: HTMLAudioElement) => {
    try {
      const promise = audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
          setIsPlaying(false);
          setIsLoading(false);
        });
      }
    } catch {
      setIsPlaying(false);
      setIsLoading(false);
    }
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    const clamped = Math.max(0, seconds);
    setCurrentTime(clamped);
    if (!audio) {
      pendingSeekRef.current = clamped;
      return;
    }
    if (audio.readyState >= 1) {
      const target =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.min(clamped, audio.duration)
          : clamped;
      audio.currentTime = target;
      setCurrentTime(target);
      pendingSeekRef.current = null;
    } else {
      pendingSeekRef.current = clamped;
    }
  }, []);

  const playTrack = useCallback(
    (entry: Entry, startSeconds?: number) => {
      const safeAudioUrl = getSafeHttpUrl(entry.audio_url);
      if (!safeAudioUrl) return;

      const existing = currentTrackRef.current;
      const audio = audioRef.current;

      // Same track already loaded
      if (existing && existing.id === entry.id) {
        if (startSeconds !== undefined) {
          seekTo(startSeconds);
          if (audio) {
            safePlay(audio);
          }
          setIsPlaying(true);
          return;
        }
        if (audio) {
          if (audio.paused) {
            safePlay(audio);
            setIsPlaying(true);
          } else {
            audio.pause();
            setIsPlaying(false);
          }
        } else {
          setIsPlaying((prev) => !prev);
        }
        return;
      }

      // Sync previous track before switching
      if (existing) {
        void syncProgress(existing.id, audio ? audio.currentTime : currentTimeRef.current);
      }

      const initialSec = startSeconds ?? entry.playback_seconds ?? 0;
      pendingSeekRef.current = initialSec;
      setError(null);
      setIsLoading(true);
      setCurrentTrack(entry);
      setCurrentTime(initialSec);
      setDuration(parseAudioDurationSeconds(entry.audio_duration));

      // Defer loading/playing onto next microtask after <audio src> updates if needed
      window.setTimeout(() => {
        const el = audioRef.current;
        if (!el) return;
        if (el.src !== safeAudioUrl) {
          el.src = safeAudioUrl;
          el.load();
        }
        el.playbackRate = playbackRate;
        if (el.readyState >= 1 && pendingSeekRef.current !== null) {
          el.currentTime = pendingSeekRef.current;
          pendingSeekRef.current = null;
        }
        safePlay(el);
        setIsPlaying(true);
      }, 0);
    },
    [playbackRate, safePlay, seekTo, syncProgress],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrackRef.current) return;
    if (audio.paused) {
      safePlay(audio);
      setIsPlaying(true);
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [safePlay]);

  const skipBy = useCallback(
    (deltaSeconds: number) => {
      const audio = audioRef.current;
      const base = audio ? audio.currentTime : currentTimeRef.current;
      seekTo(base + deltaSeconds);
    },
    [seekTo],
  );

  const setPlaybackRate = useCallback((rate: PlaybackRate) => {
    setPlaybackRateState(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

  const closePlayer = useCallback(() => {
    const audio = audioRef.current;
    const track = currentTrackRef.current;
    if (audio) {
      audio.pause();
    }
    if (track) {
      void syncProgress(track.id, audio ? audio.currentTime : currentTimeRef.current);
    }
    setIsPlaying(false);
    setCurrentTrack(null);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, [syncProgress]);

  return {
    audioRef,
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    isLoading,
    error,
    playTrack,
    togglePlay,
    seekTo,
    skipBy,
    setPlaybackRate,
    closePlayer,
  };
}
