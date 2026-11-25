import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { apiClient } from '../api/client';
import { EntryList } from '../components/EntryList';
import { FeedErrorBanner } from '../components/FeedErrorBanner';
import { Sidebar } from '../components/Sidebar';
import type { Feed } from '../types/api';
import { getActionableErrorHint, groupFeedsByError } from '../utils/feedErrors';

function makeFeed(overrides: Partial<Feed> & { id: number; title: string }): Feed {
  return {
    url: `https://example.com/feed-${overrides.id}.xml`,
    site_url: 'https://example.com',
    view_type: 'article',
    feed_kind: 'rss',
    category: 'Tech',
    icon_url: null,
    unread_count: 0,
    last_fetched_at: '2026-11-25T15:00:00Z',
    last_error: null,
    enabled: true,
    config_json: '{}',
    ...overrides,
  };
}

const SOCKS_ERROR =
  "Using SOCKS proxy, but the 'socksio' package is not installed. Make sure to install httpx using `pip install httpx[socks]`.";

describe('getActionableErrorHint & groupFeedsByError', () => {
  it('detects SOCKS, network/proxy, SSL/MITM, and 403/429 error hints', () => {
    expect(getActionableErrorHint(SOCKS_ERROR)).toContain('httpx[socks]');
    expect(getActionableErrorHint('ConnectError: All connection attempts failed')).toContain(
      'Surge / Sing-box / Clash',
    );
    expect(getActionableErrorHint('ReadTimeout: timed out while reading')).toContain(
      'RSS_PROXY_URL',
    );
    expect(getActionableErrorHint('ProxyError: 502 Bad Gateway')).toContain('RSS_PROXY_URL');
    expect(getActionableErrorHint('gaierror: nodename nor servname provided')).toContain(
      'RSS_PROXY_URL',
    );
    expect(
      getActionableErrorHint('ConnectError: [SSL: CERTIFICATE_VERIFY_FAILED]'),
    ).toContain('SSL_CERT_FILE');
    expect(getActionableErrorHint('HTTP 429 Too Many Requests')).toContain('限流或拦截');
    expect(getActionableErrorHint('HTTP 403 Forbidden')).toContain('限流或拦截');
    expect(getActionableErrorHint('Unexpected XML syntax error')).toBeNull();
  });

  it('groups feeds with identical trimmed error text sorted by group size', () => {
    const feeds = [
      makeFeed({ id: 1, title: 'Feed A', last_error: 'HTTP 429 Too Many Requests' }),
      makeFeed({ id: 2, title: 'Feed B', last_error: SOCKS_ERROR }),
      makeFeed({ id: 3, title: 'Feed C', last_error: `  ${SOCKS_ERROR}  ` }),
      makeFeed({ id: 4, title: 'Healthy Feed', last_error: null }),
    ];

    const groups = groupFeedsByError(feeds);
    expect(groups).toHaveLength(2);
    expect(groups[0].error).toBe(SOCKS_ERROR);
    expect(groups[0].feeds.map((f) => f.title)).toEqual(['Feed B', 'Feed C']);
    expect(groups[1].error).toBe('HTTP 429 Too Many Requests');
    expect(groups[1].feeds.map((f) => f.title)).toEqual(['Feed A']);
  });
});

describe('FeedErrorBanner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders single failing feed callout with actionable hint, Copy, and Retry actions', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onRetryFeed = vi.fn();
    const onNotify = vi.fn();
    const failingFeed = makeFeed({
      id: 7,
      title: 'Bloomberg Markets',
      last_error: SOCKS_ERROR,
    });

    render(
      <FeedErrorBanner
        activeView="article"
        selectedFeed={failingFeed}
        failingFeeds={[failingFeed]}
        entriesCount={0}
        isRefreshingAll={false}
        refreshingFeedIds={new Set()}
        onRetryAll={vi.fn()}
        onRetryFeed={onRetryFeed}
        onSelectFeed={vi.fn()}
        onNotify={onNotify}
      />,
    );

    const banner = screen.getByTestId('feed-error-banner');
    expect(banner).toHaveTextContent('抓取失败 · Bloomberg Markets');
    expect(banner).toHaveTextContent('最近尝试：');
    expect(banner).toHaveTextContent(SOCKS_ERROR);
    expect(banner).toHaveTextContent('httpx[socks]');

    await user.click(screen.getByRole('button', { name: '复制错误' }));
    expect(writeText).toHaveBeenCalledWith(SOCKS_ERROR);
    expect(onNotify).toHaveBeenCalledWith('success', '错误信息已复制到剪贴板');
    expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重试刷新' }));
    expect(onRetryFeed).toHaveBeenCalledWith(7);
  });

  it('auto-expands grouped multi-feed errors when entriesCount is 0 and supports feed pill navigation', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onRetryAll = vi.fn();
    const onSelectFeed = vi.fn();

    const failingFeeds = [
      makeFeed({ id: 1, title: 'Bloomberg Markets', last_error: SOCKS_ERROR }),
      makeFeed({ id: 2, title: 'WSJ Markets', last_error: SOCKS_ERROR }),
      makeFeed({ id: 3, title: 'Reuters News', last_error: 'HTTP 429 Too Many Requests' }),
    ];

    render(
      <FeedErrorBanner
        activeView="all"
        selectedFeed={null}
        failingFeeds={failingFeeds}
        entriesCount={0}
        isRefreshingAll={false}
        refreshingFeedIds={new Set()}
        onRetryAll={onRetryAll}
        onRetryFeed={vi.fn()}
        onSelectFeed={onSelectFeed}
      />,
    );

    expect(screen.getByTestId('feed-error-groups')).toBeInTheDocument();
    const groups = screen.getAllByTestId('feed-error-group');
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveTextContent('影响 2 个订阅源');
    expect(groups[0]).toHaveTextContent(SOCKS_ERROR);
    expect(groups[0]).toHaveTextContent('httpx[socks]');
    expect(groups[1]).toHaveTextContent('影响 1 个订阅源');
    expect(groups[1]).toHaveTextContent('限流或拦截');

    await user.click(screen.getByRole('button', { name: 'WSJ Markets' }));
    expect(onSelectFeed).toHaveBeenCalledWith(failingFeeds[1]);

    await user.click(screen.getByRole('button', { name: '全部重试' }));
    expect(onRetryAll).toHaveBeenCalledTimes(1);

    const copyButtons = screen.getAllByRole('button', { name: '复制错误' });
    await user.click(copyButtons[0]);
    expect(writeText).toHaveBeenCalledWith(SOCKS_ERROR);
  });

  it('starts collapsed when entriesCount > 0 and expands on toggle', async () => {
    const user = userEvent.setup();
    const failingFeeds = [
      makeFeed({ id: 1, title: 'Bloomberg Markets', last_error: 'ConnectTimeout: timed out' }),
    ];

    render(
      <FeedErrorBanner
        activeView="all"
        selectedFeed={null}
        failingFeeds={failingFeeds}
        entriesCount={12}
        isRefreshingAll={false}
        refreshingFeedIds={new Set()}
        onRetryAll={vi.fn()}
        onRetryFeed={vi.fn()}
        onSelectFeed={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('feed-error-groups')).not.toBeInTheDocument();
    const toggleBtn = screen.getByRole('button', { name: /1 个订阅源抓取异常 · 查看原因/ });
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggleBtn);
    expect(screen.getByTestId('feed-error-groups')).toBeInTheDocument();
    expect(screen.getByText(/Surge \/ Sing-box \/ Clash/)).toBeInTheDocument();
  });
});

describe('EntryList error-aware empty state', () => {
  it('renders error-aware empty state with retry button when errorFeedCount > 0', async () => {
    const user = userEvent.setup();
    const onRetryRefresh = vi.fn();

    render(
      <EntryList
        entries={[]}
        total={0}
        activeView="all"
        selectedEntryId={null}
        isLoading={false}
        isLoadingMore={false}
        currentAudioTrackId={null}
        isAudioPlaying={false}
        isSplitOpen={false}
        errorFeedCount={14}
        onSelectEntry={vi.fn()}
        onToggleStar={vi.fn()}
        onPlayPodcast={vi.fn()}
        onLoadMore={vi.fn()}
        onOpenSocialQuickAdd={vi.fn()}
        onRetryRefresh={onRetryRefresh}
      />,
    );

    const empty = screen.getByTestId('entry-list-error-empty');
    expect(empty).toHaveTextContent('未能获取到内容：当前视图有 14 个订阅源抓取异常');
    expect(empty).toHaveTextContent('请查看上方错误原因或检查网络/代理设置');
    expect(screen.queryByText(/调整筛选 \/ 搜索条件/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重试刷新' }));
    expect(onRetryRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('Sidebar error indicators', () => {
  it('shows compact error count badge and clickable per-feed error button', async () => {
    const user = userEvent.setup();
    const onSelectFeed = vi.fn();
    const failingFeed = makeFeed({
      id: 1,
      title: 'Bloomberg Markets',
      last_error: SOCKS_ERROR,
    });
    const healthyFeed = makeFeed({
      id: 2,
      title: 'Ars Technica',
      last_error: null,
    });

    render(
      <Sidebar
        feeds={[failingFeed, healthyFeed]}
        activeView="all"
        selectedFeedId={null}
        starredCount={0}
        health={{ status: 'ok', version: '0.3.1', ai_configured: false, nlm_available: false }}
        theme="light"
        isRefreshingAll={false}
        refreshingFeedIds={new Set()}
        mobileOpen={false}
        onCloseMobile={vi.fn()}
        onSelectView={vi.fn()}
        onSelectFeed={onSelectFeed}
        onRefreshAll={vi.fn()}
        onRefreshFeed={vi.fn()}
        onDeleteFeed={vi.fn()}
        onOpenAddFeed={vi.fn()}
        onOpenFiltersExport={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    );

    expect(screen.getByTestId('sidebar-error-count-badge')).toHaveTextContent('1 异常');

    const errBtn = screen.getByRole('button', {
      name: /查看 Bloomberg Markets 抓取异常/,
    });
    expect(errBtn).toHaveAttribute('title', expect.stringContaining('socksio'));

    await user.click(errBtn);
    expect(onSelectFeed).toHaveBeenCalledWith(failingFeed);
  });
});

describe('App refreshAll toasts and sidebar error drill-down', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits an error toast with real error message when all feeds fail on refreshAll', async () => {
    const user = userEvent.setup();
    const failingFeeds = [
      makeFeed({ id: 1, title: 'Bloomberg Markets', last_error: SOCKS_ERROR }),
      makeFeed({ id: 2, title: 'WSJ Markets', last_error: SOCKS_ERROR }),
    ];

    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({
      status: 'ok',
      version: '0.3.1',
      ai_configured: false,
      nlm_available: false,
    });
    vi.spyOn(apiClient, 'getFeeds').mockResolvedValue(failingFeeds);
    vi.spyOn(apiClient, 'getEntries').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(apiClient, 'refreshAllFeeds').mockResolvedValue({
      feeds_refreshed: 2,
      total_added: 0,
      total_filtered: 0,
      errors: [
        { feed_id: 1, error: SOCKS_ERROR },
        { feed_id: 2, error: SOCKS_ERROR },
      ],
    });

    render(<App />);
    const refreshBtn = await screen.findByRole('button', { name: '全部刷新' });
    await user.click(refreshBtn);

    const toast = await screen.findByText(/全部 2 个订阅源抓取失败：Using SOCKS proxy/);
    expect(toast.closest('[data-toast-type]')).toHaveAttribute('data-toast-type', 'error');

    // Clicking the sidebar error icon selects that feed and reveals single-feed banner
    const sidebarErrBtn = screen.getByRole('button', {
      name: /查看 Bloomberg Markets 抓取异常/,
    });
    await user.click(sidebarErrBtn);

    await waitFor(() => {
      expect(screen.getByTestId('feed-error-banner')).toHaveTextContent(
        '抓取失败 · Bloomberg Markets',
      );
    });
  });

  it('emits a warning toast with first error message when some feeds fail on refreshAll', async () => {
    const user = userEvent.setup();
    const feeds = [
      makeFeed({ id: 1, title: 'Bloomberg Markets', last_error: null }),
      makeFeed({ id: 2, title: 'Reuters News', last_error: 'HTTP 429 Too Many Requests' }),
    ];

    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({
      status: 'ok',
      version: '0.3.1',
      ai_configured: false,
      nlm_available: false,
    });
    vi.spyOn(apiClient, 'getFeeds').mockResolvedValue(feeds);
    vi.spyOn(apiClient, 'getEntries').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(apiClient, 'refreshAllFeeds').mockResolvedValue({
      feeds_refreshed: 2,
      total_added: 5,
      total_filtered: 0,
      errors: [{ feed_id: 2, error: 'HTTP 429 Too Many Requests' }],
    });

    render(<App />);
    const refreshBtn = await screen.findByRole('button', { name: '全部刷新' });
    await user.click(refreshBtn);

    const toast = await screen.findByText(
      /刷新完成：新增 5 条，1 个源异常（HTTP 429 Too Many Requests）/,
    );
    expect(toast.closest('[data-toast-type]')).toHaveAttribute('data-toast-type', 'warning');
  });
});
