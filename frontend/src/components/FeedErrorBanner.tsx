import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Lightbulb,
  RefreshCw,
} from 'lucide-react';
import type { Feed, NavView } from '../types/api';
import { cn } from '../utils/cn';
import { getActionableErrorHint, groupFeedsByError } from '../utils/feedErrors';
import { formatFullDate, formatRelativeTime } from '../utils/time';
import type { ToastMessage } from './Toast';

interface FeedErrorBannerProps {
  activeView: NavView;
  selectedFeed: Feed | null;
  failingFeeds: Feed[];
  entriesCount: number;
  isLoadingEntries?: boolean;
  isRefreshingAll: boolean;
  refreshingFeedIds: Set<number>;
  onRetryAll: () => void;
  onRetryFeed: (feedId: number) => void;
  onSelectFeed: (feed: Feed) => void;
  onNotify?: (type: ToastMessage['type'], text: string) => void;
}

export function FeedErrorBanner({
  activeView,
  selectedFeed,
  failingFeeds,
  entriesCount,
  isLoadingEntries = false,
  isRefreshingAll,
  refreshingFeedIds,
  onRetryAll,
  onRetryFeed,
  onSelectFeed,
  onNotify,
}: FeedErrorBannerProps) {
  const scopeKey = selectedFeed ? `feed-${selectedFeed.id}` : `view-${activeView}`;
  const [expandOverride, setExpandOverride] = useState<{
    scopeKey: string;
    expanded: boolean;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const groupedErrors = useMemo(() => groupFeedsByError(failingFeeds), [failingFeeds]);

  const handleCopyError = async (key: string, errorText: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(errorText);
      setCopiedKey(key);
      onNotify?.('success', '错误信息已复制到剪贴板');
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1800);
    } catch {
      onNotify?.('error', '复制失败，请手动选中错误信息复制');
    }
  };

  // Mode 1: Single selected feed with last_error
  if (selectedFeed) {
    const errorText = selectedFeed.last_error?.trim();
    if (!errorText) return null;

    const hint = getActionableErrorHint(errorText);
    const isRetrying = isRefreshingAll || refreshingFeedIds.has(selectedFeed.id);
    const copyKey = `feed-${selectedFeed.id}`;
    const isCopied = copiedKey === copyKey;
    const relativeFetched = formatRelativeTime(selectedFeed.last_fetched_at);
    const fullFetched = formatFullDate(selectedFeed.last_fetched_at);

    return (
      <section
        data-testid="feed-error-banner"
        role="alert"
        aria-label={`${selectedFeed.title} 抓取异常`}
        className="shrink-0 border-b border-rose-200/80 bg-rose-50/85 px-4 py-3 text-rose-950 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-rose-900 dark:text-rose-100">
                抓取失败 · {selectedFeed.title}
              </p>
              {relativeFetched && (
                <p
                  className="mt-0.5 text-[11px] text-rose-700/80 dark:text-rose-300/80"
                  title={fullFetched || undefined}
                >
                  最近尝试：{fullFetched || relativeFetched}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleCopyError(copyKey, errorText)}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white/90 px-2 py-1 text-[11px] font-medium text-rose-800 transition hover:bg-white dark:border-rose-800/70 dark:bg-rose-950/60 dark:text-rose-200 dark:hover:bg-rose-900/60"
            >
              {isCopied ? (
                <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
              <span>{isCopied ? '已复制' : '复制错误'}</span>
            </button>
            <button
              type="button"
              onClick={() => onRetryFeed(selectedFeed.id)}
              disabled={isRetrying}
              className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-2xs transition hover:bg-rose-700 disabled:opacity-60"
            >
              <RefreshCw className={cn('h-3 w-3', isRetrying && 'animate-spin')} />
              <span>{isRetrying ? '刷新中' : '重试刷新'}</span>
            </button>
          </div>
        </div>

        <pre className="mt-2.5 max-h-32 overflow-y-auto rounded-lg border border-rose-200/80 bg-white/90 p-2.5 font-mono text-xs break-words whitespace-pre-wrap text-rose-900 select-text dark:border-rose-900/70 dark:bg-zinc-950/70 dark:text-rose-200">
          {errorText}
        </pre>

        {hint && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200/90 bg-amber-50/90 px-2.5 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>{hint}</span>
          </div>
        )}
      </section>
    );
  }

  // Mode 2: Aggregate views with failing feeds
  if (groupedErrors.length === 0) return null;

  const effectiveOverride =
    expandOverride?.scopeKey === scopeKey ? expandOverride.expanded : null;
  const isExpanded = effectiveOverride ?? (!isLoadingEntries && entriesCount === 0);

  return (
    <section
      data-testid="feed-error-banner"
      role="status"
      aria-label="订阅源抓取异常汇总"
      className="shrink-0 border-b border-amber-200/80 bg-amber-50/85 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpandOverride({ scopeKey, expanded: !isExpanded })}
          aria-expanded={isExpanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs font-semibold text-rose-800 transition hover:text-rose-950 dark:text-amber-200 dark:hover:text-amber-100"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-amber-400" />
          <span className="truncate">
            {failingFeeds.length} 个订阅源抓取异常 · {isExpanded ? '收起原因' : '查看原因'}
          </span>
        </button>

        <button
          type="button"
          onClick={onRetryAll}
          disabled={isRefreshingAll}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-2xs transition hover:bg-rose-700 disabled:opacity-60"
        >
          <RefreshCw className={cn('h-3 w-3', isRefreshingAll && 'animate-spin')} />
          <span>{isRefreshingAll ? '刷新中' : '全部重试'}</span>
        </button>
      </div>

      {isExpanded && (
        <div
          data-testid="feed-error-groups"
          className="max-h-72 space-y-2.5 overflow-y-auto border-t border-amber-200/70 px-4 py-3 dark:border-amber-900/50"
        >
          {groupedErrors.map((group, idx) => {
            const hint = getActionableErrorHint(group.error);
            const copyKey = `group-${idx}`;
            const isCopied = copiedKey === copyKey;

            return (
              <div
                key={group.error}
                data-testid="feed-error-group"
                className="rounded-xl border border-rose-200/80 bg-white/90 p-3 shadow-2xs dark:border-rose-900/60 dark:bg-zinc-900/80"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                    影响 {group.feeds.length} 个订阅源
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyError(copyKey, group.error)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    {isCopied ? (
                      <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    <span>{isCopied ? '已复制' : '复制错误'}</span>
                  </button>
                </div>

                <pre className="mt-2 max-h-28 overflow-y-auto rounded-lg border border-rose-100 bg-rose-50/70 p-2 font-mono text-xs break-words whitespace-pre-wrap text-rose-900 select-text dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
                  {group.error}
                </pre>

                {hint && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50/90 px-2.5 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
                    <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>{hint}</span>
                  </div>
                )}

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {group.feeds.map((feed) => (
                    <button
                      key={feed.id}
                      type="button"
                      onClick={() => onSelectFeed(feed)}
                      title={`切换到 ${feed.title}`}
                      className="inline-flex max-w-full items-center rounded-full border border-rose-200/80 bg-rose-50/70 px-2 py-0.5 text-[11px] font-medium text-rose-800 transition hover:border-rose-300 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-200 dark:hover:bg-rose-900/60"
                    >
                      <span className="truncate">{feed.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
