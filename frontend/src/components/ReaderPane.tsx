import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  Headphones,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Star,
} from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import type { Entry, HNComment } from '../types/api';
import { cn } from '../utils/cn';
import {
  extractYouTubeVideoId,
  getProxiedImageUrl,
  getSafeHttpUrl,
  plainTextToSanitizedHtml,
  sanitizeHtml,
} from '../utils/sanitize';
import {
  formatAudioDuration,
  formatFullDate,
  formatRelativeTime,
  formatSeconds,
} from '../utils/time';

interface ReaderPaneProps {
  entry: Entry | null;
  aiConfigured: boolean;
  isCurrentAudioTrack: boolean;
  isAudioPlaying: boolean;
  onClose?: () => void;
  onUpdateEntryState: (updated: Entry) => void;
  onToggleStar: (entry: Entry) => void;
  onToggleRead: (entry: Entry) => void;
  onPlayPodcast: (entry: Entry, startSeconds?: number) => void;
  onNotify: (type: 'success' | 'error' | 'info', text: string) => void;
}

function HNCommentThread({ comment, depth = 0 }: { comment: HNComment; depth?: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const sanitizedText = useMemo(
    () => sanitizeHtml(comment.text, { proxyImages: false, linkifyTimestamps: false }),
    [comment.text],
  );

  if (!comment.text && (!comment.children || comment.children.length === 0)) {
    return null;
  }

  return (
    <div
      className={cn(
        'text-sm',
        depth > 0 && 'mt-3 border-l-2 border-orange-200/80 pl-3.5 dark:border-zinc-700',
      )}
    >
      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="font-mono text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          aria-label={collapsed ? '展开评论' : '折叠评论'}
        >
          [{collapsed ? '+' : '−'}]
        </button>
        <span className="font-semibold text-orange-700 dark:text-orange-400">
          {comment.author || 'anonymous'}
        </span>
        {comment.created_at && (
          <span>{formatRelativeTime(comment.created_at)}</span>
        )}
      </div>

      {!collapsed && (
        <>
          {sanitizedText && (
            <div
              className="reader-prose mt-1.5 text-[13.5px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: sanitizedText }}
            />
          )}
          {comment.children && comment.children.length > 0 && depth < 4 && (
            <div className="mt-2">
              {comment.children.map((child) => (
                <HNCommentThread key={child.id} comment={child} depth={depth + 1} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ReaderPane({
  entry,
  aiConfigured,
  isCurrentAudioTrack,
  isAudioPlaying,
  onClose,
  onUpdateEntryState,
  onToggleStar,
  onToggleRead,
  onPlayPodcast,
  onNotify,
}: ReaderPaneProps) {
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryModel, setSummaryModel] = useState<string | null>(null);
  const [preferExtracted, setPreferExtracted] = useState(true);

  const [hnComments, setHnComments] = useState<HNComment[] | null>(null);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  // Reset per-entry transient UI state when switching entries
  useEffect(() => {
    setSummaryError(null);
    setSummaryModel(null);
    setHnComments(null);
    setCommentsError(null);
    setPreferExtracted(true);
  }, [entry?.id]);

  const videoId = useMemo(
    () => (entry ? extractYouTubeVideoId(entry) : null),
    [entry],
  );

  const isPodcast = Boolean(entry && (entry.view_type === 'audio' || entry.audio_url));
  const isSocial = entry?.view_type === 'social';
  const isHN = Boolean(entry && (entry.view_type === 'hn' || entry.hn_item_id));

  const renderedHtml = useMemo(() => {
    if (!entry) return '';
    const options = {
      proxyImages: Boolean(isSocial || isPodcast),
      linkifyTimestamps: isPodcast,
    };

    if (preferExtracted && entry.extracted_text) {
      return plainTextToSanitizedHtml(entry.extracted_text, options);
    }
    if (entry.content_html) {
      return sanitizeHtml(entry.content_html, options);
    }
    if (entry.summary) {
      // Summary might contain HTML or plain text
      if (/<[a-z][\s\S]*>/i.test(entry.summary)) {
        return sanitizeHtml(entry.summary, options);
      }
      return plainTextToSanitizedHtml(entry.summary, options);
    }
    return '';
  }, [entry, preferExtracted, isSocial, isPodcast]);

  if (!entry) {
    return (
      <section className="hidden flex-1 flex-col items-center justify-center bg-[#faf9f6] px-8 text-center md:flex dark:bg-[#0f1115]">
        <div className="max-w-sm rounded-3xl border border-zinc-200/80 bg-white/80 p-8 shadow-xs dark:border-zinc-800 dark:bg-[#151821]">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400">
            <BookOpen className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-bold text-zinc-900 dark:text-zinc-100">
            选择左侧任意条目开始阅读
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            支持全文提取、按需 AI 摘要、播客 Shownotes 时间轴点击跳转，以及周报批量打包导出至 NotebookLM / Obsidian。
          </p>
          <div className="mt-5 grid grid-cols-2 gap-2 text-left text-[11px] text-zinc-500 dark:text-zinc-400">
            <div className="rounded-lg bg-zinc-100/80 px-2.5 py-1.5 dark:bg-zinc-800/70">
              <kbd className="font-mono font-bold text-zinc-700 dark:text-zinc-200">j / k</kbd>{' '}
              上下切换
            </div>
            <div className="rounded-lg bg-zinc-100/80 px-2.5 py-1.5 dark:bg-zinc-800/70">
              <kbd className="font-mono font-bold text-zinc-700 dark:text-zinc-200">s</kbd>{' '}
              收藏 / 取消
            </div>
            <div className="rounded-lg bg-zinc-100/80 px-2.5 py-1.5 dark:bg-zinc-800/70">
              <kbd className="font-mono font-bold text-zinc-700 dark:text-zinc-200">m</kbd>{' '}
              已读 / 未读
            </div>
            <div className="rounded-lg bg-zinc-100/80 px-2.5 py-1.5 dark:bg-zinc-800/70">
              <kbd className="font-mono font-bold text-zinc-700 dark:text-zinc-200">o</kbd>{' '}
              打开原文
            </div>
          </div>
        </div>
      </section>
    );
  }

  const handleExtract = async () => {
    setIsExtracting(true);
    try {
      const updated = await apiClient.extractEntry(entry.id);
      onUpdateEntryState(updated);
      setPreferExtracted(true);
      onNotify('success', '全文提取成功');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '全文提取失败';
      onNotify('error', msg);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSummarize = async (force = false) => {
    setIsSummarizing(true);
    setSummaryError(null);
    try {
      const res = await apiClient.summarizeEntry(entry.id, force);
      onUpdateEntryState({ ...entry, ai_summary: res.ai_summary });
      setSummaryModel(res.model);
      onNotify('success', res.cached ? '已加载缓存的 AI 摘要' : 'AI 摘要生成完成');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setSummaryError(err.detail);
      } else {
        setSummaryError(
          err instanceof Error
            ? err.message
            : 'AI 摘要生成失败，请检查 .env 中的 GEMINI_API_KEY 或 OPENAI_API_KEY 配置。',
        );
      }
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleLoadHNComments = async () => {
    setIsLoadingComments(true);
    setCommentsError(null);
    try {
      const res = await apiClient.getHNComments(entry.id);
      setHnComments(res.comments);
    } catch (err) {
      setCommentsError(err instanceof Error ? err.message : '无法加载 Hacker News 评论');
    } finally {
      setIsLoadingComments(false);
    }
  };

  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    const tsEl = target?.closest<HTMLElement>('[data-seek-seconds]');
    if (!tsEl) return;
    e.preventDefault();
    const rawSec = Number(tsEl.getAttribute('data-seek-seconds'));
    if (Number.isFinite(rawSec) && rawSec >= 0) {
      onPlayPodcast(entry, rawSec);
    }
  };

  const safeEntryUrl = getSafeHttpUrl(entry.url);
  const safeAudioUrl = getSafeHttpUrl(entry.audio_url);
  const proxiedCover = getProxiedImageUrl(entry.image_url);
  const durationLabel = formatAudioDuration(entry.audio_duration);
  const hnItemIdStr =
    entry.hn_item_id !== null && entry.hn_item_id !== undefined
      ? String(entry.hn_item_id).trim()
      : '';
  const hnDiscussionUrl = /^\d+$/.test(hnItemIdStr)
    ? `https://news.ycombinator.com/item?id=${hnItemIdStr}`
    : null;

  return (
    <section
      aria-label="阅读器面板"
      data-testid="reader-pane"
      className="flex min-w-0 flex-1 flex-col bg-[#faf9f6] dark:bg-[#0f1115]"
    >
      {/* Top Action Bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200/80 bg-white/85 px-4 py-2.5 backdrop-blur-sm dark:border-zinc-800/80 dark:bg-[#14171f]/85">
        <div className="flex items-center gap-1.5">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              aria-label="返回列表"
            >
              <ArrowLeft className="h-4 w-4" />
              <span>返回</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleExtract}
            disabled={isExtracting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {isExtracting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            <span>提取全文</span>
          </button>

          <button
            type="button"
            onClick={() => void handleSummarize(false)}
            disabled={isSummarizing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/80 bg-amber-50/80 px-2.5 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/50"
          >
            {isSummarizing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>AI 摘要</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleStar(entry)}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
              entry.is_starred
                ? 'bg-amber-100/80 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
                : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
            )}
            aria-label={entry.is_starred ? '取消收藏' : '收藏条目'}
          >
            <Star
              className={cn(
                'h-3.5 w-3.5',
                entry.is_starred && 'fill-amber-400 text-amber-400',
              )}
            />
            <span className="hidden sm:inline">{entry.is_starred ? '已收藏' : '收藏'}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleRead(entry)}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label={entry.is_read ? '标为未读' : '标为已读'}
          >
            {entry.is_read ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-orange-500" />
            )}
            <span className="hidden sm:inline">{entry.is_read ? '已读' : '未读'}</span>
          </button>

          {safeEntryUrl && (
            <a
              href={safeEntryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">原文</span>
            </a>
          )}
        </div>
      </div>

      {/* Scrollable Reading Surface */}
      <article className="flex-1 overflow-y-auto px-5 py-6 sm:px-10 sm:py-8">
        <div className="mx-auto max-w-2xl">
          {/* Meta Header */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="rounded-md bg-zinc-200/70 px-2 py-0.5 font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {entry.feed_title || 'RSS'}
            </span>
            {entry.author && <span>· {entry.author}</span>}
            {(entry.published_at || entry.discovered_at) && (
              <span>· {formatFullDate(entry.published_at || entry.discovered_at)}</span>
            )}
            {isHN && entry.hn_points !== null && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-orange-100 px-1.5 py-0.5 font-mono font-bold text-orange-700 dark:bg-orange-500/20 dark:text-orange-300">
                <ArrowUp className="h-3 w-3" />
                {entry.hn_points}
              </span>
            )}
            {hnDiscussionUrl && (
              <a
                href={hnDiscussionUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-orange-600 hover:underline dark:text-orange-400"
              >
                HN 讨论 ({entry.hn_comments_count ?? 0}) ↗
              </a>
            )}
          </div>

          <h1 className="mt-3 text-2xl leading-tight font-bold tracking-tight text-zinc-900 sm:text-[1.7rem] dark:text-zinc-50">
            {safeEntryUrl ? (
              <a
                href={safeEntryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-orange-600 dark:hover:text-orange-400"
              >
                {entry.title}
              </a>
            ) : (
              entry.title
            )}
          </h1>

          {/* AI Summary Box or Helpful Unconfigured Notice */}
          {summaryError && (
            <div className="mt-5 rounded-2xl border border-amber-300/80 bg-amber-50/90 p-4 text-xs leading-relaxed text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="font-semibold">AI 摘要暂不可用</p>
              <p className="mt-1">{summaryError}</p>
              {!aiConfigured && (
                <p className="mt-1.5 text-[11px] opacity-80">
                  提示：在项目根目录 <code>.env</code> 中配置 <code>GEMINI_API_KEY</code> 或{' '}
                  <code>OPENAI_API_KEY</code> 后重启后端即可启用按需 AI 摘要。
                </p>
              )}
            </div>
          )}

          {entry.ai_summary && (
            <div
              data-testid="ai-summary-card"
              className="mt-5 rounded-2xl border border-amber-200/90 bg-gradient-to-br from-amber-50/90 to-orange-50/50 p-4 shadow-2xs dark:border-amber-900/50 dark:from-amber-950/35 dark:to-orange-950/20"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>AI 提炼摘要</span>
                  {summaryModel && (
                    <span className="font-mono text-[10px] font-normal opacity-75">
                      ({summaryModel})
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void handleSummarize(true)}
                  disabled={isSummarizing}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-amber-700 hover:bg-amber-200/60 dark:text-amber-300 dark:hover:bg-amber-900/50"
                >
                  <RefreshCw className={cn('h-3 w-3', isSummarizing && 'animate-spin')} />
                  <span>重新生成</span>
                </button>
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                {entry.ai_summary}
              </div>
            </div>
          )}

          {/* Embedded YouTube Player */}
          {videoId && (
            <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-black shadow-sm dark:border-zinc-800">
              <div className="relative aspect-video w-full">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${videoId}`}
                  title={entry.title}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            </div>
          )}

          {/* Podcast Episode Hero Card */}
          {isPodcast && safeAudioUrl && (
            <div className="mt-6 flex flex-wrap items-center gap-4 rounded-2xl border border-violet-200/80 bg-violet-50/70 p-4 dark:border-violet-900/60 dark:bg-violet-950/25">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-violet-200 bg-white dark:border-violet-800 dark:bg-zinc-900">
                {proxiedCover ? (
                  <img
                    src={proxiedCover}
                    alt={entry.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-violet-500">
                    <Headphones className="h-7 w-7" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-violet-800 dark:text-violet-300">
                  播客单集音频 {durationLabel ? `· ${durationLabel}` : ''}
                </p>
                <p className="mt-0.5 text-[11px] text-violet-700/80 dark:text-violet-300/75">
                  点击下方 Shownotes 中的时间轴（如 05:30 / 1:12:00）可直接跳转播放。
                </p>
              </div>
              <button
                type="button"
                onClick={() => onPlayPodcast(entry)}
                className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 active:scale-95"
              >
                {isCurrentAudioTrack && isAudioPlaying ? (
                  <>
                    <Pause className="h-4 w-4 fill-current" />
                    <span>暂停播放</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    <span>
                      {entry.playback_seconds > 0
                        ? `继续播放 (${formatSeconds(entry.playback_seconds)})`
                        : '立即播放'}
                    </span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Lead Image for Social / Articles (when not video/podcast and image not already in HTML) */}
          {!videoId && !isPodcast && proxiedCover && !entry.content_html?.includes(entry.image_url ?? '') && (
            <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200/80 dark:border-zinc-800">
              <img
                src={proxiedCover}
                alt={entry.title}
                loading="lazy"
                className="max-h-96 w-full object-cover"
              />
            </div>
          )}

          {/* Switch between Extracted Full Text & RSS Original when both exist */}
          {entry.extracted_text && entry.content_html && (
            <div className="mt-6 inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 text-xs dark:border-zinc-800 dark:bg-zinc-900">
              <button
                type="button"
                onClick={() => setPreferExtracted(true)}
                className={cn(
                  'rounded-md px-2.5 py-1 font-medium transition',
                  preferExtracted
                    ? 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300'
                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400',
                )}
              >
                全文提取版本
              </button>
              <button
                type="button"
                onClick={() => setPreferExtracted(false)}
                className={cn(
                  'rounded-md px-2.5 py-1 font-medium transition',
                  !preferExtracted
                    ? 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300'
                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400',
                )}
              >
                原始订阅内容
              </button>
            </div>
          )}

          {/* Sanitized Editorial Body */}
          {renderedHtml ? (
            <div
              onClick={handleContentClick}
              data-testid="reader-content"
              className="reader-prose mt-6"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              订阅源仅包含标题/链接，可点击顶部「提取全文」或「原文」查看完整内容。
            </div>
          )}

          {/* Hacker News Nested Comments Section */}
          {isHN && (
            <section className="mt-8 border-t border-zinc-200 pt-6 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  <MessageSquare className="h-4 w-4 text-orange-500" />
                  <span>Hacker News 热门讨论</span>
                  {entry.hn_comments_count !== null && (
                    <span className="font-mono text-xs font-normal text-zinc-400">
                      ({entry.hn_comments_count})
                    </span>
                  )}
                </h2>

                <button
                  type="button"
                  onClick={() => void handleLoadHNComments()}
                  disabled={isLoadingComments}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition hover:bg-orange-100 disabled:opacity-60 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300 dark:hover:bg-orange-900/40"
                >
                  {isLoadingComments && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{hnComments ? '刷新评论' : 'Load Top Comments · 加载热门评论'}</span>
                </button>
              </div>

              {commentsError && (
                <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{commentsError}</p>
              )}

              {hnComments && hnComments.length === 0 && (
                <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
                  暂无可展示的评论。
                </p>
              )}

              {hnComments && hnComments.length > 0 && (
                <div className="mt-4 space-y-4" data-testid="hn-comments-tree">
                  {hnComments.map((comment) => (
                    <div
                      key={comment.id}
                      className="rounded-xl border border-zinc-200/80 bg-white p-3.5 dark:border-zinc-800 dark:bg-[#151821]"
                    >
                      <HNCommentThread comment={comment} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </article>
    </section>
  );
}
