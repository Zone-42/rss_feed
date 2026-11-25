import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Flame,
  Headphones,
  Inbox,
  MessageSquare,
  Moon,
  Newspaper,
  Plus,
  RefreshCw,
  Rss,
  SlidersHorizontal,
  Sun,
  Trash2,
  Tv,
  X,
} from 'lucide-react';
import type { Feed, HealthStatus, NavView, ViewType } from '../types/api';
import type { ThemeMode } from '../hooks/useTheme';
import { cn } from '../utils/cn';

interface SidebarProps {
  feeds: Feed[];
  activeView: NavView;
  selectedFeedId: number | null;
  starredCount: number;
  health: HealthStatus | null;
  theme: ThemeMode;
  isRefreshingAll: boolean;
  refreshingFeedIds: Set<number>;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onSelectView: (view: NavView) => void;
  onSelectFeed: (feed: Feed) => void;
  onRefreshAll: () => void;
  onRefreshFeed: (feedId: number) => void;
  onDeleteFeed: (feedId: number) => void;
  onOpenAddFeed: () => void;
  onOpenFiltersExport: () => void;
  onToggleTheme: () => void;
}

const VIEW_TABS: Array<{
  id: NavView;
  label: string;
  sublabel: string;
  icon: typeof Inbox;
  accent: string;
}> = [
  { id: 'all', label: 'All', sublabel: '全部', icon: Inbox, accent: 'text-orange-500' },
  { id: 'article', label: 'Articles', sublabel: '财经/科技', icon: Newspaper, accent: 'text-amber-600 dark:text-amber-400' },
  { id: 'hn', label: 'Hacker News', sublabel: 'HN 精选', icon: Flame, accent: 'text-orange-600 dark:text-orange-400' },
  { id: 'video', label: 'Videos', sublabel: 'YouTube', icon: Tv, accent: 'text-rose-500' },
  { id: 'audio', label: 'Podcasts', sublabel: '播客', icon: Headphones, accent: 'text-violet-500' },
  { id: 'social', label: 'Social', sublabel: '社媒', icon: MessageSquare, accent: 'text-sky-500' },
  { id: 'starred', label: 'Starred', sublabel: '收藏', icon: Bookmark, accent: 'text-yellow-500' },
];

const VIEW_GROUP_LABELS: Record<ViewType, string> = {
  article: 'Articles · 财经/科技',
  hn: 'Hacker News',
  video: 'Videos · YouTube',
  audio: 'Podcasts · 播客',
  social: 'Social · 社媒',
};

const VIEW_GROUP_ORDER: ViewType[] = ['article', 'hn', 'video', 'audio', 'social'];

export function Sidebar({
  feeds,
  activeView,
  selectedFeedId,
  starredCount,
  health,
  theme,
  isRefreshingAll,
  refreshingFeedIds,
  mobileOpen,
  onCloseMobile,
  onSelectView,
  onSelectFeed,
  onRefreshAll,
  onRefreshFeed,
  onDeleteFeed,
  onOpenAddFeed,
  onOpenFiltersExport,
  onToggleTheme,
}: SidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const unreadByView = useMemo(() => {
    const counts: Record<string, number> = {
      all: 0,
      article: 0,
      hn: 0,
      video: 0,
      audio: 0,
      social: 0,
    };
    for (const feed of feeds) {
      const unread = Math.max(0, feed.unread_count ?? 0);
      counts.all += unread;
      counts[feed.view_type] = (counts[feed.view_type] ?? 0) + unread;
    }
    return counts;
  }, [feeds]);

  const errorFeedCount = useMemo(
    () => feeds.filter((feed) => Boolean(feed.last_error?.trim())).length,
    [feeds],
  );

  const groupedFeeds = useMemo(() => {
    const map = new Map<ViewType, Feed[]>();
    for (const vt of VIEW_GROUP_ORDER) {
      map.set(vt, []);
    }
    for (const feed of feeds) {
      const list = map.get(feed.view_type) ?? [];
      list.push(feed);
      map.set(feed.view_type, list);
    }
    return VIEW_GROUP_ORDER.map((vt) => ({
      viewType: vt,
      label: VIEW_GROUP_LABELS[vt],
      items: (map.get(vt) ?? []).sort((a, b) => {
        const catCompare = (a.category ?? '').localeCompare(b.category ?? '');
        if (catCompare !== 0) return catCompare;
        return a.title.localeCompare(b.title);
      }),
    })).filter((group) => group.items.length > 0);
  }, [feeds]);

  const toggleGroup = (vt: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [vt]: !prev[vt] }));
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#f5f3ee] text-zinc-800 dark:bg-[#13161d] dark:text-zinc-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200/80 px-4 py-3.5 dark:border-zinc-800/80">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-sm">
            <Rss className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              FolioRSS
            </h1>
            <p className="text-[11px] leading-none text-zinc-500 dark:text-zinc-400">
              多源信息阅读器
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleTheme}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
            title={theme === 'dark' ? '亮色模式' : '暗色模式'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-200/70 lg:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
            aria-label="关闭侧边栏"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-2 px-3 pt-3 pb-2">
        <button
          type="button"
          onClick={onOpenAddFeed}
          className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-orange-700 active:scale-[0.99]"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>添加订阅 / Add Feed</span>
        </button>

        <button
          type="button"
          onClick={onRefreshAll}
          disabled={isRefreshingAll}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200/90 bg-white/80 px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-white disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRefreshingAll && 'animate-spin')} />
          <span>{isRefreshingAll ? '刷新中' : '全部刷新'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenFiltersExport}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200/90 bg-white/80 px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>过滤与导出</span>
        </button>
      </div>

      {/* Scrollable Navigation */}
      <div className="flex-1 overflow-y-auto px-2.5 py-2">
        {/* Views */}
        <nav aria-label="视图切换" className="space-y-0.5">
          {VIEW_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeView === tab.id && selectedFeedId === null;
            const badge =
              tab.id === 'starred'
                ? starredCount
                : unreadByView[tab.id] ?? 0;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  onSelectView(tab.id);
                  onCloseMobile();
                }}
                data-testid={`nav-view-${tab.id}`}
                className={cn(
                  'flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm transition',
                  isActive
                    ? 'bg-white font-semibold text-zinc-900 shadow-xs ring-1 ring-zinc-200/80 dark:bg-zinc-800/90 dark:text-white dark:ring-zinc-700/80'
                    : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/40 dark:hover:text-zinc-100',
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Icon className={cn('h-4 w-4 shrink-0', tab.accent)} />
                  <span className="truncate">{tab.label}</span>
                  <span className="truncate text-[11px] font-normal text-zinc-400 dark:text-zinc-500">
                    {tab.sublabel}
                  </span>
                </span>
                {badge > 0 && (
                  <span
                    className={cn(
                      'ml-2 rounded-full px-1.5 py-0.5 font-mono text-[11px] font-semibold',
                      isActive
                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300'
                        : 'bg-zinc-200/80 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
                    )}
                  >
                    {badge > 999 ? '999+' : badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Feeds Grouped by View */}
        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between px-2.5">
            <span className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500">
              订阅源 ({feeds.length})
            </span>
            {errorFeedCount > 0 && (
              <span
                data-testid="sidebar-error-count-badge"
                title={`${errorFeedCount} 个订阅源最近抓取失败`}
                className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
              >
                <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                <span>{errorFeedCount} 异常</span>
              </span>
            )}
          </div>

          {groupedFeeds.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 p-3 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              暂无订阅源，点击上方「添加订阅」导入或加载 Starter Pack。
            </div>
          ) : (
            <div className="space-y-3">
              {groupedFeeds.map((group) => {
                const collapsed = Boolean(collapsedGroups[group.viewType]);
                return (
                  <div key={group.viewType}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.viewType)}
                      className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                    >
                      {collapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                      <span className="truncate">{group.label}</span>
                    </button>

                    {!collapsed && (
                      <ul className="mt-0.5 space-y-0.5">
                        {group.items.map((feed) => {
                          const isSelected = selectedFeedId === feed.id;
                          const isRefreshing = refreshingFeedIds.has(feed.id);
                          const isConfirmingDelete = confirmDeleteId === feed.id;

                          return (
                            <li key={feed.id} className="group relative">
                              <div
                                className={cn(
                                  'flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition',
                                  isSelected
                                    ? 'bg-white font-semibold text-zinc-900 shadow-xs ring-1 ring-zinc-200/80 dark:bg-zinc-800 dark:text-white dark:ring-zinc-700'
                                    : 'text-zinc-600 hover:bg-zinc-200/50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/40 dark:hover:text-zinc-100',
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    onSelectFeed(feed);
                                    onCloseMobile();
                                  }}
                                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                  title={
                                    feed.category
                                      ? `${feed.title} (${feed.category})`
                                      : feed.title
                                  }
                                >
                                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-zinc-200/80 text-[10px] font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                                    {feed.title.slice(0, 1).toUpperCase()}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">
                                    {feed.title}
                                  </span>
                                </button>

                                {feed.last_error?.trim() && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSelectFeed(feed);
                                      onCloseMobile();
                                    }}
                                    title={`查看抓取异常: ${feed.last_error}`}
                                    className="shrink-0 rounded p-0.5 text-rose-500 transition hover:bg-rose-100 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 dark:text-amber-400 dark:hover:bg-rose-950/60 dark:hover:text-rose-300"
                                    aria-label={`查看 ${feed.title} 抓取异常: ${feed.last_error}`}
                                  >
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                  </button>
                                )}

                                {/* Per-feed actions on hover or confirm */}
                                <div
                                  className={cn(
                                    'flex items-center gap-0.5',
                                    isConfirmingDelete
                                      ? 'opacity-100'
                                      : 'opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
                                  )}
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRefreshFeed(feed.id);
                                    }}
                                    disabled={isRefreshing}
                                    className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                                    aria-label={`刷新 ${feed.title}`}
                                    title="刷新此订阅源"
                                  >
                                    <RefreshCw
                                      className={cn('h-3 w-3', isRefreshing && 'animate-spin')}
                                    />
                                  </button>

                                  {isConfirmingDelete ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setConfirmDeleteId(null);
                                        onDeleteFeed(feed.id);
                                      }}
                                      onMouseLeave={() => setConfirmDeleteId(null)}
                                      className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-rose-700"
                                      aria-label={`确认删除 ${feed.title}`}
                                    >
                                      删除?
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setConfirmDeleteId(feed.id);
                                      }}
                                      className="rounded p-1 text-zinc-400 hover:bg-rose-100 hover:text-rose-600 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
                                      aria-label={`删除 ${feed.title}`}
                                      title="删除订阅源"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  )}
                                </div>

                                {feed.unread_count > 0 && !isConfirmingDelete && (
                                  <span className="shrink-0 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                                    {feed.unread_count}
                                  </span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer Status */}
      <div className="border-t border-zinc-200/80 px-3.5 py-2.5 text-[11px] text-zinc-500 dark:border-zinc-800/80 dark:text-zinc-400">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                health?.status === 'ok' ? 'bg-emerald-500' : 'bg-zinc-400',
              )}
            />
            <span>{health ? `v${health.version}` : '连接后端...'}</span>
          </span>
          <div className="flex items-center gap-2">
            <span
              title={
                health?.ai_configured
                  ? 'AI 摘要已配置'
                  : '未配置 GEMINI_API_KEY / OPENAI_API_KEY'
              }
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium',
                health?.ai_configured
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-zinc-200/70 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
              )}
            >
              AI {health?.ai_configured ? 'ON' : 'OFF'}
            </span>
            {health?.nlm_available && (
              <span
                title="检测到 NotebookLM CLI (nlm)"
                className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
              >
                NLM
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-zinc-200/80 lg:block dark:border-zinc-800/80">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] shadow-2xl">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
