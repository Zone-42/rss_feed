import {
  AlertTriangle,
  ArrowUp,
  Headphones,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
  Tv,
} from 'lucide-react';
import type { Entry, NavView } from '../types/api';
import { cn } from '../utils/cn';
import { extractYouTubeVideoId, getProxiedImageUrl } from '../utils/sanitize';
import { formatAudioDuration, formatRelativeTime, formatSeconds } from '../utils/time';

interface EntryListProps {
  entries: Entry[];
  total: number;
  activeView: NavView;
  selectedEntryId: number | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  currentAudioTrackId: number | null;
  isAudioPlaying: boolean;
  isSplitOpen: boolean;
  errorFeedCount?: number;
  isRetryingRefresh?: boolean;
  onSelectEntry: (entry: Entry) => void;
  onToggleStar: (entry: Entry) => void;
  onPlayPodcast: (entry: Entry) => void;
  onLoadMore: () => void;
  onOpenSocialQuickAdd: () => void;
  onRetryRefresh?: () => void;
}

function stripHtmlPreview(htmlOrText: string | null | undefined): string {
  if (!htmlOrText) return '';
  return htmlOrText
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function EntryList({
  entries,
  total,
  activeView,
  selectedEntryId,
  isLoading,
  isLoadingMore,
  currentAudioTrackId,
  isAudioPlaying,
  isSplitOpen,
  errorFeedCount = 0,
  isRetryingRefresh = false,
  onSelectEntry,
  onToggleStar,
  onPlayPodcast,
  onLoadMore,
  onOpenSocialQuickAdd,
  onRetryRefresh,
}: EntryListProps) {
  const isVideoGrid = activeView === 'video';
  const isSocialFeed = activeView === 'social';
  const isPodcastView = activeView === 'audio';
  const isHNView = activeView === 'hn';

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-sm text-zinc-400">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        <span>加载条目中...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Helpful Social / RSSHub Guide Banner */}
      {isSocialFeed && (
        <div className="m-3 rounded-2xl border border-sky-200/80 bg-gradient-to-r from-sky-50 to-indigo-50/60 p-3.5 dark:border-sky-900/60 dark:from-sky-950/40 dark:to-indigo-950/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-sky-900 dark:text-sky-200">
                社媒订阅指南 · RSSHub / MediaCrawler 接入
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-sky-800/80 dark:text-sky-300/80">
                支持接入自建 RSSHub 路由（X/Twitter、知乎、小红书）或 MediaCrawler CDP 导出源，外链图片自动通过安全代理防防盗链加载。
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenSocialQuickAdd}
              className="flex shrink-0 items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-sky-700"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>配置社媒源</span>
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        errorFeedCount > 0 ? (
          <div
            data-testid="entry-list-error-empty"
            className="flex flex-col items-center justify-center px-6 py-14 text-center"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <p className="mt-3 max-w-sm text-sm font-medium text-zinc-800 dark:text-zinc-200">
              未能获取到内容：当前视图有 {errorFeedCount} 个订阅源抓取异常
            </p>
            <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              请查看上方错误原因或检查网络/代理设置，修复后点击下方按钮重新抓取。
            </p>
            {onRetryRefresh && (
              <button
                type="button"
                onClick={onRetryRefresh}
                disabled={isRetryingRefresh}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-rose-700 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isRetryingRefresh && 'animate-spin')} />
                <span>{isRetryingRefresh ? '正在刷新...' : '重试刷新'}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {isSocialFeed ? '还没有社媒订阅内容' : '当前视图暂无条目'}
            </p>
            <p className="mt-1.5 max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
              {isSocialFeed
                ? '点击上方「配置社媒源」快速生成 X / 知乎 / 小红书 RSSHub 订阅路由。'
                : '尝试点击左侧「全部刷新」，或调整筛选 / 搜索条件。'}
            </p>
          </div>
        )
      ) : isVideoGrid ? (
        /* 16:9 YouTube Video Card Grid */
        <div
          data-testid="video-grid"
          className={cn(
            'grid gap-4 p-4',
            isSplitOpen
              ? 'grid-cols-1 xl:grid-cols-2'
              : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3',
          )}
        >
          {entries.map((entry) => {
            const selected = entry.id === selectedEntryId;
            const videoId = extractYouTubeVideoId(entry);
            const thumb =
              getProxiedImageUrl(entry.image_url) ||
              (videoId
                ? getProxiedImageUrl(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`)
                : null);

            return (
              <article
                key={entry.id}
                onClick={() => onSelectEntry(entry)}
                className={cn(
                  'group flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white transition hover:shadow-md dark:bg-[#171a23]',
                  selected
                    ? 'border-rose-500 ring-2 ring-rose-500/20'
                    : 'border-zinc-200/80 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700',
                )}
              >
                <div className="relative aspect-video w-full overflow-hidden bg-zinc-900">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={entry.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-zinc-600">
                      <Tv className="h-10 w-10" />
                    </div>
                  )}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition group-hover:opacity-100">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-600/95 text-white shadow-lg">
                      <Play className="ml-0.5 h-5 w-5 fill-current" />
                    </span>
                  </div>
                  {!entry.is_read && (
                    <span
                      className="absolute top-2.5 left-2.5 h-2.5 w-2.5 rounded-full bg-orange-500 ring-2 ring-white dark:ring-zinc-900"
                      title="未读"
                    />
                  )}
                </div>

                <div className="flex flex-1 flex-col p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className={cn(
                        'line-clamp-2 text-sm leading-snug',
                        entry.is_read
                          ? 'font-medium text-zinc-600 dark:text-zinc-400'
                          : 'font-semibold text-zinc-900 dark:text-zinc-100',
                      )}
                    >
                      {entry.title}
                    </h3>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(entry);
                      }}
                      className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-amber-500 dark:hover:bg-zinc-800"
                      aria-label={entry.is_starred ? '取消收藏' : '收藏'}
                    >
                      <Star
                        className={cn(
                          'h-4 w-4',
                          entry.is_starred && 'fill-amber-400 text-amber-400',
                        )}
                      />
                    </button>
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-2.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span className="truncate">{entry.feed_title || entry.author || 'YouTube'}</span>
                    <span className="shrink-0">
                      {formatRelativeTime(entry.published_at || entry.discovered_at)}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : isSocialFeed ? (
        /* Social Card Feed */
        <div
          data-testid="social-grid"
          className={cn(
            'grid gap-3.5 p-4 pt-1',
            isSplitOpen
              ? 'grid-cols-1'
              : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
          )}
        >
          {entries.map((entry) => {
            const selected = entry.id === selectedEntryId;
            const proxiedImg = getProxiedImageUrl(entry.image_url);
            const snippet = stripHtmlPreview(entry.summary || entry.content_html);

            return (
              <article
                key={entry.id}
                onClick={() => onSelectEntry(entry)}
                className={cn(
                  'flex cursor-pointer flex-col rounded-2xl border bg-white p-4 transition hover:shadow-md dark:bg-[#171a23]',
                  selected
                    ? 'border-sky-500 ring-2 ring-sky-500/20'
                    : 'border-zinc-200/80 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700',
                )}
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex min-w-0 items-center gap-2">
                    {!entry.is_read && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                    )}
                    <span className="truncate font-semibold text-zinc-800 dark:text-zinc-200">
                      {entry.author || entry.feed_title || 'Social'}
                    </span>
                    <span className="truncate text-[11px] text-zinc-400">
                      {formatRelativeTime(entry.published_at || entry.discovered_at)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStar(entry);
                    }}
                    className="rounded p-1 text-zinc-400 hover:text-amber-500"
                    aria-label={entry.is_starred ? '取消收藏' : '收藏'}
                  >
                    <Star
                      className={cn(
                        'h-4 w-4',
                        entry.is_starred && 'fill-amber-400 text-amber-400',
                      )}
                    />
                  </button>
                </div>

                <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {entry.title}
                </h3>

                {snippet && (
                  <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {snippet}
                  </p>
                )}

                {proxiedImg && (
                  <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200/70 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
                    <img
                      src={proxiedImg}
                      alt={entry.title}
                      loading="lazy"
                      className="max-h-56 w-full object-cover"
                    />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : isPodcastView ? (
        /* Podcast Episode Cards */
        <div className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70" data-testid="podcast-list">
          {entries.map((entry) => {
            const selected = entry.id === selectedEntryId;
            const cover = getProxiedImageUrl(entry.image_url);
            const durationText = formatAudioDuration(entry.audio_duration);
            const isThisTrack = currentAudioTrackId === entry.id;
            const isThisPlaying = isThisTrack && isAudioPlaying;

            return (
              <article
                key={entry.id}
                onClick={() => onSelectEntry(entry)}
                className={cn(
                  'flex cursor-pointer items-start gap-3.5 px-4 py-3.5 transition',
                  selected
                    ? 'bg-violet-50/70 dark:bg-violet-950/25'
                    : 'hover:bg-zinc-100/70 dark:hover:bg-zinc-800/40',
                )}
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-violet-50 dark:border-zinc-700 dark:bg-violet-950/30">
                  {cover ? (
                    <img
                      src={cover}
                      alt={entry.title}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-violet-500">
                      <Headphones className="h-6 w-6" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {!entry.is_read && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-violet-500" />
                    )}
                    <span className="truncate font-medium text-violet-700 dark:text-violet-300">
                      {entry.feed_title || 'Podcast'}
                    </span>
                    <span>·</span>
                    <span className="shrink-0">
                      {formatRelativeTime(entry.published_at || entry.discovered_at)}
                    </span>
                  </div>

                  <h3
                    className={cn(
                      'mt-1 line-clamp-2 text-sm leading-snug',
                      entry.is_read
                        ? 'font-medium text-zinc-600 dark:text-zinc-400'
                        : 'font-semibold text-zinc-900 dark:text-zinc-100',
                    )}
                  >
                    {entry.title}
                  </h3>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {entry.audio_url && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPlayPodcast(entry);
                        }}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition',
                          isThisPlaying
                            ? 'bg-violet-600 text-white shadow-xs'
                            : 'bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-500/20 dark:text-violet-300 dark:hover:bg-violet-500/30',
                        )}
                        aria-label={isThisPlaying ? `暂停 ${entry.title}` : `播放 ${entry.title}`}
                      >
                        {isThisPlaying ? (
                          <>
                            <Pause className="h-3 w-3 fill-current" />
                            <span>播放中</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-3 w-3 fill-current" />
                            <span>
                              {entry.playback_seconds > 0
                                ? `继续 ${formatSeconds(entry.playback_seconds)}`
                                : '播放'}
                            </span>
                          </>
                        )}
                      </button>
                    )}

                    {durationText && (
                      <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                        {durationText}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(entry);
                      }}
                      className="ml-auto rounded p-1 text-zinc-400 hover:text-amber-500"
                      aria-label={entry.is_starred ? '取消收藏' : '收藏'}
                    >
                      <Star
                        className={cn(
                          'h-3.5 w-3.5',
                          entry.is_starred && 'fill-amber-400 text-amber-400',
                        )}
                      />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        /* Editorial List View (Articles / All / Starred / Hacker News) */
        <ul
          className="divide-y divide-zinc-200/70 dark:divide-zinc-800/70"
          data-testid={isHNView ? 'hn-list' : 'article-list'}
        >
          {entries.map((entry) => {
            const selected = entry.id === selectedEntryId;
            const snippet = stripHtmlPreview(entry.summary || entry.extracted_text);
            const domain = extractDomain(entry.url);
            const isHN = isHNView || entry.view_type === 'hn' || entry.hn_points !== null;

            return (
              <li
                key={entry.id}
                onClick={() => onSelectEntry(entry)}
                data-entry-id={entry.id}
                className={cn(
                  'group relative cursor-pointer px-4 py-3.5 transition',
                  selected
                    ? 'bg-orange-50/75 dark:bg-orange-950/25'
                    : 'hover:bg-zinc-100/75 dark:hover:bg-zinc-800/40',
                )}
              >
                {selected && (
                  <span className="absolute top-2 bottom-2 left-0 w-1 rounded-r-full bg-orange-500" />
                )}

                <div className="flex items-start gap-2.5">
                  <div className="pt-1.5">
                    <span
                      className={cn(
                        'block h-2 w-2 rounded-full',
                        entry.is_read ? 'bg-transparent' : 'bg-orange-500',
                      )}
                      aria-label={entry.is_read ? '已读' : '未读'}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Top Meta Row */}
                    <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium text-zinc-700 dark:text-zinc-300">
                          {entry.feed_title || 'RSS'}
                        </span>
                        {domain && isHN && (
                          <span className="truncate text-zinc-400">({domain})</span>
                        )}
                      </div>
                      <span className="shrink-0">
                        {formatRelativeTime(entry.discovered_at || entry.published_at)}
                      </span>
                    </div>

                    {/* Title */}
                    <h3
                      className={cn(
                        'mt-1 line-clamp-2 text-[14px] leading-snug',
                        entry.is_read
                          ? 'font-normal text-zinc-600 dark:text-zinc-400'
                          : 'font-semibold text-zinc-900 dark:text-zinc-100',
                      )}
                    >
                      {entry.title}
                    </h3>

                    {/* HN Badges or Snippet */}
                    {isHN ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {entry.hn_points !== null && (
                          <span className="inline-flex items-center gap-0.5 rounded-md bg-orange-100/90 px-1.5 py-0.5 font-mono text-[11px] font-bold text-orange-700 dark:bg-orange-500/20 dark:text-orange-300">
                            <ArrowUp className="h-3 w-3" />
                            <span>{entry.hn_points}</span>
                          </span>
                        )}
                        {entry.hn_comments_count !== null && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            <MessageCircle className="h-3 w-3" />
                            <span>{entry.hn_comments_count}</span>
                          </span>
                        )}
                        {entry.author && (
                          <span className="text-[11px] text-zinc-400">by {entry.author}</span>
                        )}
                      </div>
                    ) : (
                      snippet && (
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                          {snippet}
                        </p>
                      )
                    )}

                    {/* Bottom micro-badges */}
                    <div className="mt-1.5 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        {entry.ai_summary && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-100/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                            <Sparkles className="h-2.5 w-2.5" />
                            AI
                          </span>
                        )}
                        {entry.audio_url && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-violet-100/80 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                            <Headphones className="h-2.5 w-2.5" />
                            音频
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStar(entry);
                        }}
                        className={cn(
                          'rounded p-1 transition',
                          entry.is_starred
                            ? 'text-amber-500 opacity-100'
                            : 'text-zinc-400 opacity-0 hover:text-amber-500 group-hover:opacity-100',
                        )}
                        aria-label={entry.is_starred ? '取消收藏' : '收藏'}
                      >
                        <Star
                          className={cn(
                            'h-3.5 w-3.5',
                            entry.is_starred && 'fill-amber-400 text-amber-400',
                          )}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Load More */}
      {entries.length > 0 && entries.length < total && (
        <div className="p-4 text-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 shadow-2xs transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {isLoadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>加载更多 ({entries.length} / {total})</span>
          </button>
        </div>
      )}
    </div>
  );
}
