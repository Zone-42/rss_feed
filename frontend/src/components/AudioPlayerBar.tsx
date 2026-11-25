import {
  Headphones,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  X,
} from 'lucide-react';
import {
  PLAYBACK_RATES,
  type AudioPlayerController,
  type PlaybackRate,
} from '../hooks/useAudioPlayer';
import { getProxiedImageUrl, getSafeHttpUrl } from '../utils/sanitize';
import { formatSeconds, parseAudioDurationSeconds } from '../utils/time';

interface AudioPlayerBarProps {
  player: AudioPlayerController;
  onSelectTrack?: (entryId: number) => void;
}

export function AudioPlayerBar({ player, onSelectTrack }: AudioPlayerBarProps) {
  const {
    audioRef,
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    isLoading,
    error,
    togglePlay,
    seekTo,
    skipBy,
    setPlaybackRate,
    closePlayer,
  } = player;

  const coverUrl = getProxiedImageUrl(currentTrack?.image_url);
  const safeAudioSrc = getSafeHttpUrl(currentTrack?.audio_url) ?? undefined;
  const fallbackDuration = parseAudioDurationSeconds(currentTrack?.audio_duration);
  const effectiveDuration = duration > 0 ? duration : fallbackDuration;

  const cycleRate = () => {
    const idx = PLAYBACK_RATES.indexOf(playbackRate);
    const next: PlaybackRate = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    setPlaybackRate(next);
  };

  return (
    <>
      {/* Hidden persistent audio element mounted at root so playback survives view switches */}
      <audio
        ref={audioRef}
        src={safeAudioSrc}
        preload="metadata"
        data-testid="global-audio-element"
      />

      {currentTrack && (
        <aside
          aria-label="全局音频播放器"
          data-testid="global-audio-player"
          className="z-40 shrink-0 border-t border-zinc-200/90 bg-white/95 px-4 py-2.5 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-md dark:border-zinc-800 dark:bg-[#14171f]/95"
        >
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-3 md:flex-nowrap md:gap-5">
            {/* Track Info */}
            <div className="flex min-w-0 flex-1 items-center gap-3 md:max-w-xs">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-violet-50 dark:border-zinc-700 dark:bg-violet-950/40">
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt={currentTrack.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Headphones className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                )}
              </div>
              <button
                type="button"
                onClick={() => onSelectTrack?.(currentTrack.id)}
                className="min-w-0 text-left hover:opacity-80"
                title="查看播客 Shownotes"
              >
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {currentTrack.title}
                </p>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {error ? (
                    <span className="text-rose-500">{error}</span>
                  ) : (
                    currentTrack.feed_title || 'Podcast'
                  )}
                </p>
              </button>
            </div>

            {/* Transport Controls */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => skipBy(-15)}
                className="flex items-center gap-0.5 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                aria-label="快退15秒"
                title="快退 15 秒"
              >
                <RotateCcw className="h-4 w-4" />
                <span>15</span>
              </button>

              <button
                type="button"
                onClick={togglePlay}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-600 text-white shadow-sm transition hover:bg-violet-700 active:scale-95"
                aria-label={isPlaying ? '暂停' : '播放'}
                title={isPlaying ? '暂停' : '播放'}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4 fill-current" />
                )}
              </button>

              <button
                type="button"
                onClick={() => skipBy(15)}
                className="flex items-center gap-0.5 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                aria-label="快进15秒"
                title="快进 15 秒"
              >
                <span>15</span>
                <RotateCw className="h-4 w-4" />
              </button>
            </div>

            {/* Scrub Bar */}
            <div className="flex w-full flex-1 items-center gap-2.5 md:w-auto">
              <span
                className="w-12 text-right font-mono text-xs text-zinc-500 dark:text-zinc-400"
                data-testid="audio-current-time"
              >
                {formatSeconds(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={effectiveDuration > 0 ? Math.floor(effectiveDuration) : Math.max(100, Math.floor(currentTime) + 60)}
                value={Math.floor(currentTime)}
                onChange={(e) => seekTo(Number(e.target.value))}
                aria-label="播放进度"
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-200 accent-violet-600 dark:bg-zinc-700"
              />
              <span className="w-12 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                {effectiveDuration > 0 ? formatSeconds(effectiveDuration) : '--:--'}
              </span>
            </div>

            {/* Speed & Close */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cycleRate}
                className="min-w-[3.25rem] rounded-lg border border-zinc-200 px-2 py-1 font-mono text-xs font-semibold text-zinc-700 transition hover:border-violet-400 hover:text-violet-600 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-violet-500 dark:hover:text-violet-300"
                aria-label="切换倍速"
                title="点击切换播放倍速 (1x / 1.25x / 1.5x / 2x)"
              >
                {playbackRate}x
              </button>

              <button
                type="button"
                onClick={closePlayer}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label="关闭播放器"
                title="关闭播放器"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
