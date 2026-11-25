import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from './api/client';
import { AddFeedModal, type AddFeedTab } from './components/AddFeedModal';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { EntryList } from './components/EntryList';
import { FiltersExportModal } from './components/FiltersExportModal';
import { ReaderPane } from './components/ReaderPane';
import { Sidebar } from './components/Sidebar';
import { StreamToolbar } from './components/StreamToolbar';
import { ToastStack, type ToastMessage } from './components/Toast';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useTheme } from './hooks/useTheme';
import type { Entry, Feed, HealthStatus, NavView, ViewType } from './types/api';
import { cn } from './utils/cn';
import { getSafeHttpUrl } from './utils/sanitize';

const PAGE_SIZE = 50;

const VIEW_TITLES: Record<NavView, { title: string; subtitle: string }> = {
  all: { title: 'All · 全部订阅', subtitle: '聚合所有信息流的最新动态' },
  article: { title: 'Articles · 财经与科技', subtitle: '深度报道、行业资讯与精选博客' },
  hn: { title: 'Hacker News', subtitle: 'Algolia 高分破阈值发现时间流' },
  video: { title: 'Videos · YouTube', subtitle: '16:9 精选频道与无干扰播放器' },
  audio: { title: 'Podcasts · 播客', subtitle: '全局后台播放 + Shownotes 时间轴跳转' },
  social: { title: 'Social · 社媒动态', subtitle: 'RSSHub / MediaCrawler 代理阅读' },
  starred: { title: 'Starred · 我的收藏', subtitle: '随时打包导出至 NotebookLM 与 Obsidian' },
};

export default function App() {
  const { theme, toggleTheme } = useTheme();

  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [starredCount, setStarredCount] = useState(0);

  const [activeView, setActiveView] = useState<NavView>('all');
  const [selectedFeedId, setSelectedFeedId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [isLoadingEntries, setIsLoadingEntries] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);

  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [refreshingFeedIds, setRefreshingFeedIds] = useState<Set<number>>(new Set());

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [addFeedOpen, setAddFeedOpen] = useState(false);
  const [addFeedTab, setAddFeedTab] = useState<AddFeedTab>('rss');
  const [filtersExportOpen, setFiltersExportOpen] = useState(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastIdRef = useRef(1);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const notify = useCallback((type: ToastMessage['type'], text: string) => {
    const id = toastIdRef.current++;
    setToasts((prev) => [...prev.slice(-3), { id, type, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Debounce search input
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  // Keep entry playback_seconds synced into list state
  const handleAudioProgressSynced = useCallback((entryId: number, seconds: number) => {
    setEntries((prev) =>
      prev.map((item) =>
        item.id === entryId ? { ...item, playback_seconds: seconds } : item,
      ),
    );
  }, []);

  // Root-level persistent audio player (survives all view switches!)
  const audioPlayer = useAudioPlayer(handleAudioProgressSynced);

  const loadHealthAndFeeds = useCallback(async () => {
    try {
      const [healthRes, feedsRes, starredRes] = await Promise.all([
        apiClient.getHealth().catch(() => null),
        apiClient.getFeeds(),
        apiClient.getEntries({ starred: true, limit: 1 }).catch(() => ({ items: [], total: 0 })),
      ]);
      if (healthRes) setHealth(healthRes);
      setFeeds(feedsRes);
      setStarredCount(starredRes.total);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : '无法连接后端服务');
    }
  }, [notify]);

  const loadEntries = useCallback(
    async (offset = 0, append = false) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoadingEntries(true);
      }

      try {
        const viewParam: ViewType | undefined =
          selectedFeedId !== null
            ? undefined
            : activeView === 'all' || activeView === 'starred'
              ? undefined
              : activeView;

        const res = await apiClient.getEntries({
          view_type: viewParam,
          feed_id: selectedFeedId ?? undefined,
          starred: activeView === 'starred' && selectedFeedId === null ? true : undefined,
          unread_only: unreadOnly || undefined,
          q: debouncedQuery || undefined,
          limit: PAGE_SIZE,
          offset,
        });

        setTotalEntries(res.total);
        if (append) {
          setEntries((prev) => {
            const seen = new Set(prev.map((e) => e.id));
            const next = res.items.filter((e) => !seen.has(e.id));
            return [...prev, ...next];
          });
        } else {
          setEntries(res.items);
        }
      } catch (err) {
        notify('error', err instanceof Error ? err.message : '加载条目失败');
      } finally {
        setIsLoadingEntries(false);
        setIsLoadingMore(false);
      }
    },
    [activeView, selectedFeedId, unreadOnly, debouncedQuery, notify],
  );

  // Initial load
  useEffect(() => {
    void loadHealthAndFeeds();
  }, [loadHealthAndFeeds]);

  // Reload entries whenever view/feed/filter/search changes
  useEffect(() => {
    void loadEntries(0, false);
  }, [loadEntries]);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedEntryId) ?? null,
    [entries, selectedEntryId],
  );

  const selectedFeed = useMemo(
    () => feeds.find((f) => f.id === selectedFeedId) ?? null,
    [feeds, selectedFeedId],
  );

  const adjustFeedUnread = useCallback((feedId: number, delta: number) => {
    setFeeds((prev) =>
      prev.map((f) =>
        f.id === feedId
          ? { ...f, unread_count: Math.max(0, (f.unread_count ?? 0) + delta) }
          : f,
      ),
    );
  }, []);

  const updateEntryInState = useCallback((updated: Entry) => {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  }, []);

  const handleSelectEntry = useCallback(
    async (entry: Entry) => {
      setSelectedEntryId(entry.id);
      if (!entry.is_read) {
        // Optimistic mark read
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, is_read: true } : e)),
        );
        adjustFeedUnread(entry.feed_id, -1);
        try {
          const updated = await apiClient.updateEntry(entry.id, { is_read: true });
          updateEntryInState(updated);
        } catch {
          // Keep optimistic UI smooth
        }
      }
    },
    [adjustFeedUnread, updateEntryInState],
  );

  const handleToggleStar = useCallback(
    async (entry: Entry) => {
      const nextStar = !entry.is_starred;
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, is_starred: nextStar } : e)),
      );
      setStarredCount((c) => Math.max(0, c + (nextStar ? 1 : -1)));
      try {
        const updated = await apiClient.updateEntry(entry.id, { is_starred: nextStar });
        updateEntryInState(updated);
      } catch (err) {
        // Rollback on failure
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, is_starred: !nextStar } : e)),
        );
        setStarredCount((c) => Math.max(0, c + (nextStar ? -1 : 1)));
        notify('error', err instanceof Error ? err.message : '更新收藏状态失败');
      }
    },
    [notify, updateEntryInState],
  );

  const handleToggleRead = useCallback(
    async (entry: Entry) => {
      const nextRead = !entry.is_read;
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, is_read: nextRead } : e)),
      );
      adjustFeedUnread(entry.feed_id, nextRead ? -1 : 1);
      try {
        const updated = await apiClient.updateEntry(entry.id, { is_read: nextRead });
        updateEntryInState(updated);
      } catch (err) {
        setEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, is_read: !nextRead } : e)),
        );
        adjustFeedUnread(entry.feed_id, nextRead ? 1 : -1);
        notify('error', err instanceof Error ? err.message : '更新已读状态失败');
      }
    },
    [adjustFeedUnread, notify, updateEntryInState],
  );

  const handleMarkAllRead = useCallback(async () => {
    try {
      const payload: { view_type?: ViewType; feed_id?: number } = {};
      if (selectedFeedId !== null) {
        payload.feed_id = selectedFeedId;
      } else if (activeView !== 'all' && activeView !== 'starred') {
        payload.view_type = activeView;
      }
      const res = await apiClient.markAllRead(payload);
      notify('success', `已将 ${res.updated} 条内容标为已读`);
      await Promise.all([loadHealthAndFeeds(), loadEntries(0, false)]);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : '全部标为已读失败');
    }
  }, [activeView, selectedFeedId, loadEntries, loadHealthAndFeeds, notify]);

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshingAll(true);
    try {
      const res = await apiClient.refreshAllFeeds();
      const errNote = res.errors.length > 0 ? `，${res.errors.length} 个源异常` : '';
      const filteredNote = res.total_filtered > 0 ? `，拦截 ${res.total_filtered} 条噪声` : '';
      notify(
        'success',
        `刷新 ${res.feeds_refreshed} 个源：新增 ${res.total_added} 条${filteredNote}${errNote}`,
      );
      await Promise.all([loadHealthAndFeeds(), loadEntries(0, false)]);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : '全部刷新失败');
    } finally {
      setIsRefreshingAll(false);
    }
  }, [loadEntries, loadHealthAndFeeds, notify]);

  const handleRefreshFeed = useCallback(
    async (feedId: number) => {
      setRefreshingFeedIds((prev) => new Set(prev).add(feedId));
      try {
        const res = await apiClient.refreshFeed(feedId);
        if (res.error) {
          notify('error', `抓取失败：${res.error}`);
        } else {
          const filteredNote = res.filtered > 0 ? `，过滤 ${res.filtered} 条` : '';
          notify('success', `刷新完成：新增 ${res.added} 条${filteredNote}`);
        }
        await Promise.all([loadHealthAndFeeds(), loadEntries(0, false)]);
      } catch (err) {
        notify('error', err instanceof Error ? err.message : '刷新订阅源失败');
      } finally {
        setRefreshingFeedIds((prev) => {
          const next = new Set(prev);
          next.delete(feedId);
          return next;
        });
      }
    },
    [loadEntries, loadHealthAndFeeds, notify],
  );

  const handleDeleteFeed = useCallback(
    async (feedId: number) => {
      try {
        await apiClient.deleteFeed(feedId);
        setFeeds((prev) => prev.filter((f) => f.id !== feedId));
        if (selectedFeedId === feedId) {
          setSelectedFeedId(null);
        }
        notify('info', '已删除订阅源');
        await loadEntries(0, false);
      } catch (err) {
        notify('error', err instanceof Error ? err.message : '删除订阅源失败');
      }
    },
    [loadEntries, notify, selectedFeedId],
  );

  const handleSelectView = useCallback((view: NavView) => {
    setActiveView(view);
    setSelectedFeedId(null);
    setSelectedEntryId(null);
  }, []);

  const handleSelectFeed = useCallback((feed: Feed) => {
    setSelectedFeedId(feed.id);
    setActiveView(feed.view_type);
    setSelectedEntryId(null);
  }, []);

  const handleSelectTrackFromBar = useCallback(
    async (entryId: number) => {
      const found = entries.find((e) => e.id === entryId);
      if (found) {
        setSelectedEntryId(found.id);
        return;
      }
      try {
        const fetched = await apiClient.getEntry(entryId);
        setActiveView('audio');
        setSelectedFeedId(null);
        setEntries((prev) => (prev.some((e) => e.id === fetched.id) ? prev : [fetched, ...prev]));
        setSelectedEntryId(fetched.id);
      } catch {
        // ignore
      }
    },
    [entries],
  );

  // Keyboard navigation (`j`, `k`, `s`, `m`, `o`, `/`, `Escape`)
  const modalOpen = addFeedOpen || filtersExportOpen;

  const navigateRelative = useCallback(
    (delta: 1 | -1) => {
      if (entries.length === 0) return;
      const idx = entries.findIndex((e) => e.id === selectedEntryId);
      let nextIdx: number;
      if (idx === -1) {
        nextIdx = delta === 1 ? 0 : entries.length - 1;
      } else {
        nextIdx = Math.min(entries.length - 1, Math.max(0, idx + delta));
      }
      const nextEntry = entries[nextIdx];
      if (nextEntry && nextEntry.id !== selectedEntryId) {
        void handleSelectEntry(nextEntry);
      }
    },
    [entries, selectedEntryId, handleSelectEntry],
  );

  useKeyboardShortcuts({
    enabled: !modalOpen,
    onNext: () => navigateRelative(1),
    onPrev: () => navigateRelative(-1),
    onToggleStar: () => {
      if (selectedEntry) void handleToggleStar(selectedEntry);
    },
    onToggleRead: () => {
      if (selectedEntry) void handleToggleRead(selectedEntry);
    },
    onOpenOriginal: () => {
      const safeUrl = getSafeHttpUrl(selectedEntry?.url);
      if (safeUrl) {
        window.open(safeUrl, '_blank', 'noopener,noreferrer');
      }
    },
    onFocusSearch: () => {
      searchInputRef.current?.focus();
    },
    onEscape: () => {
      if (addFeedOpen) {
        setAddFeedOpen(false);
      } else if (filtersExportOpen) {
        setFiltersExportOpen(false);
      } else if (selectedEntryId !== null) {
        setSelectedEntryId(null);
      }
    },
  });

  const isWideGridView = activeView === 'video' || activeView === 'social';
  const showReaderPane = !isWideGridView || selectedEntry !== null;

  const toolbarTitle = selectedFeed ? selectedFeed.title : VIEW_TITLES[activeView].title;
  const toolbarSubtitle = selectedFeed
    ? selectedFeed.category || selectedFeed.url
    : VIEW_TITLES[activeView].subtitle;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#faf9f6] text-zinc-900 dark:bg-[#0f1115] dark:text-zinc-100">
      {/* Main 3-Pane Workspace */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Pane 1: Left Sidebar */}
        <Sidebar
          feeds={feeds}
          activeView={activeView}
          selectedFeedId={selectedFeedId}
          starredCount={starredCount}
          health={health}
          theme={theme}
          isRefreshingAll={isRefreshingAll}
          refreshingFeedIds={refreshingFeedIds}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          onSelectView={handleSelectView}
          onSelectFeed={handleSelectFeed}
          onRefreshAll={() => void handleRefreshAll()}
          onRefreshFeed={(id) => void handleRefreshFeed(id)}
          onDeleteFeed={(id) => void handleDeleteFeed(id)}
          onOpenAddFeed={() => {
            setAddFeedTab('rss');
            setAddFeedOpen(true);
          }}
          onOpenFiltersExport={() => setFiltersExportOpen(true)}
          onToggleTheme={toggleTheme}
        />

        {/* Pane 2: Center Stream / Adaptive Grid */}
        <main
          className={cn(
            'flex min-w-0 flex-col border-r border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-[#12151c]',
            isWideGridView
              ? selectedEntry
                ? 'hidden w-full md:flex md:w-[420px] xl:w-[500px] shrink-0'
                : 'flex-1'
              : selectedEntry
                ? 'hidden w-full md:flex md:w-[370px] xl:w-[410px] shrink-0'
                : 'flex-1 md:max-w-[410px]',
          )}
        >
          <StreamToolbar
            title={toolbarTitle}
            subtitle={toolbarSubtitle}
            total={totalEntries}
            searchQuery={searchQuery}
            unreadOnly={unreadOnly}
            showMarkAllRead={activeView !== 'starred'}
            searchInputRef={searchInputRef}
            onSearchChange={setSearchQuery}
            onToggleUnreadOnly={() => setUnreadOnly((v) => !v)}
            onMarkAllRead={() => void handleMarkAllRead()}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
          />

          <EntryList
            entries={entries}
            total={totalEntries}
            activeView={activeView}
            selectedEntryId={selectedEntryId}
            isLoading={isLoadingEntries}
            isLoadingMore={isLoadingMore}
            currentAudioTrackId={audioPlayer.currentTrack?.id ?? null}
            isAudioPlaying={audioPlayer.isPlaying}
            isSplitOpen={selectedEntry !== null}
            onSelectEntry={(entry) => void handleSelectEntry(entry)}
            onToggleStar={(entry) => void handleToggleStar(entry)}
            onPlayPodcast={(entry) => audioPlayer.playTrack(entry)}
            onLoadMore={() => void loadEntries(entries.length, true)}
            onOpenSocialQuickAdd={() => {
              setAddFeedTab('social');
              setAddFeedOpen(true);
            }}
          />
        </main>

        {/* Pane 3: Right Editorial Reader Pane */}
        {showReaderPane && (
          <ReaderPane
            entry={selectedEntry}
            aiConfigured={Boolean(health?.ai_configured)}
            isCurrentAudioTrack={
              Boolean(selectedEntry && audioPlayer.currentTrack?.id === selectedEntry.id)
            }
            isAudioPlaying={audioPlayer.isPlaying}
            onClose={selectedEntry ? () => setSelectedEntryId(null) : undefined}
            onUpdateEntryState={updateEntryInState}
            onToggleStar={(entry) => void handleToggleStar(entry)}
            onToggleRead={(entry) => void handleToggleRead(entry)}
            onPlayPodcast={(entry, startSec) => audioPlayer.playTrack(entry, startSec)}
            onNotify={notify}
          />
        )}
      </div>

      {/* Global Persistent Bottom Audio Player (mounted outside view switches) */}
      <AudioPlayerBar
        player={audioPlayer}
        onSelectTrack={(entryId) => void handleSelectTrackFromBar(entryId)}
      />

      {/* Modals */}
      <AddFeedModal
        open={addFeedOpen}
        initialTab={addFeedTab}
        onClose={() => setAddFeedOpen(false)}
        onFeedAdded={(feed) => {
          setFeeds((prev) => [feed, ...prev.filter((f) => f.id !== feed.id)]);
          void handleRefreshFeed(feed.id);
        }}
        onFeedsReloadNeeded={() => {
          void Promise.all([loadHealthAndFeeds(), loadEntries(0, false)]);
        }}
        onNotify={notify}
      />

      <FiltersExportModal
        open={filtersExportOpen}
        nlmAvailable={Boolean(health?.nlm_available)}
        onClose={() => setFiltersExportOpen(false)}
        onNotify={notify}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
