import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { AddFeedModal } from '../components/AddFeedModal';
import { FiltersExportModal } from '../components/FiltersExportModal';
import type { Feed } from '../types/api';

const CREATED_FEED: Feed = {
  id: 10,
  title: 'Fireship',
  url: 'https://www.youtube.com/feeds/videos.xml?playlist_id=UULF123',
  site_url: null,
  view_type: 'video',
  feed_kind: 'youtube',
  category: 'YouTube',
  icon_url: null,
  unread_count: 0,
  last_fetched_at: null,
  last_error: null,
  enabled: true,
  config_json: '{}',
};

describe('AddFeedModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits YouTube @handle with exclude_shorts enabled by default', async () => {
    const user = userEvent.setup();
    const createFeedSpy = vi.spyOn(apiClient, 'createFeed').mockResolvedValueOnce(CREATED_FEED);
    const onFeedAdded = vi.fn();
    const onClose = vi.fn();

    render(
      <AddFeedModal
        open={true}
        initialTab="youtube"
        onClose={onClose}
        onFeedAdded={onFeedAdded}
        onFeedsReloadNeeded={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/@AndrejKarpathy/i);
    await user.type(input, '@Fireship');
    await user.click(screen.getByRole('button', { name: /添加 YouTube 频道/ }));

    await waitFor(() => {
      expect(createFeedSpy).toHaveBeenCalledWith({
        url: 'https://www.youtube.com/@Fireship',
        title: undefined,
        view_type: 'video',
        feed_kind: 'youtube',
        category: 'YouTube',
        exclude_shorts: true,
      });
    });
    expect(onFeedAdded).toHaveBeenCalledWith(CREATED_FEED);
    expect(onClose).toHaveBeenCalled();
  });

  it('searches podcasts via iTunes proxy and subscribes', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'discoverPodcasts').mockResolvedValueOnce({
      results: [
        {
          title: 'Latent Space',
          author: 'swyx & Alessio',
          feed_url: 'https://api.substack.com/feed/podcast/1084089.rss',
          artwork_url: 'https://img.example.com/ls.jpg',
          genre: 'Technology',
        },
      ],
    });
    const createFeedSpy = vi.spyOn(apiClient, 'createFeed').mockResolvedValueOnce({
      ...CREATED_FEED,
      id: 11,
      title: 'Latent Space',
      view_type: 'audio',
      feed_kind: 'podcast',
    });

    render(
      <AddFeedModal
        open={true}
        initialTab="podcast"
        onClose={vi.fn()}
        onFeedAdded={vi.fn()}
        onFeedsReloadNeeded={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    await user.type(screen.getByPlaceholderText(/搜索 Apple Podcasts/i), 'Latent Space');
    await user.click(screen.getByRole('button', { name: '搜索' }));

    expect(await screen.findByText('Latent Space')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '订阅' }));

    await waitFor(() => {
      expect(createFeedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://api.substack.com/feed/podcast/1084089.rss',
          view_type: 'audio',
          feed_kind: 'podcast',
        }),
      );
    });
  });

  it('builds Social RSSHub route for X user', async () => {
    const user = userEvent.setup();
    const createFeedSpy = vi.spyOn(apiClient, 'createFeed').mockResolvedValueOnce({
      ...CREATED_FEED,
      id: 12,
      title: 'X · karpathy',
      view_type: 'social',
      feed_kind: 'rsshub',
    });

    render(
      <AddFeedModal
        open={true}
        initialTab="social"
        onClose={vi.fn()}
        onFeedAdded={vi.fn()}
        onFeedsReloadNeeded={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    await user.type(screen.getByPlaceholderText('karpathy'), '@karpathy');
    expect(
      screen.getByText(/http:\/\/localhost:1200\/twitter\/user\/karpathy/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /添加社媒订阅/ }));
    await waitFor(() => {
      expect(createFeedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://localhost:1200/twitter/user/karpathy',
          view_type: 'social',
          feed_kind: 'rsshub',
        }),
      );
    });
  });
});

describe('FiltersExportModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates batch-packed Markdown preview, displays 400k safe limit progress, and pushes to NotebookLM', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'getFilters').mockResolvedValueOnce([]);
    const exportSpy = vi.spyOn(apiClient, 'exportMarkdown').mockResolvedValueOnce({
      filename: 'rss-digest-2026-11-25.md',
      markdown: '---\ntitle: Weekly Digest\n---\n# Article 1',
      entry_count: 12,
      word_count: 40000,
      safe_limit: 400000,
      within_limit: true,
    });
    const nlmSpy = vi.spyOn(apiClient, 'exportNotebookLM').mockResolvedValueOnce({
      status: 'pushed',
      message: 'Uploaded successfully',
      filename: 'rss-digest-2026-11-25.md',
      word_count: 40000,
    });
    const onNotify = vi.fn();

    render(
      <FiltersExportModal
        open={true}
        nlmAvailable={true}
        onClose={vi.fn()}
        onNotify={onNotify}
      />,
    );

    await user.click(screen.getByLabelText(/仅导出已收藏/));
    await user.click(screen.getByRole('button', { name: /生成打包预览/ }));

    expect(await screen.findByTestId('export-preview-section')).toBeInTheDocument();
    expect(screen.getByText(/NotebookLM 安全范围内/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10');
    expect(exportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ starred_only: true, days: 7 }),
    );

    await user.type(
      screen.getByLabelText('NotebookLM Notebook ID'),
      'eeaf0373-3961-4cba-910f-8198ae2c809f',
    );
    await user.click(screen.getByRole('button', { name: /推送到 NotebookLM/ }));

    await waitFor(() => {
      expect(nlmSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          notebook_id: 'eeaf0373-3961-4cba-910f-8198ae2c809f',
          starred_only: true,
          days: 7,
        }),
      );
    });
    expect(await screen.findByText(/Uploaded successfully/)).toBeInTheDocument();
    expect(onNotify).toHaveBeenCalledWith('success', '已推送到 NotebookLM');
  });

  it('surfaces error instead of false success when NotebookLM push returns status=error or unavailable', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'getFilters').mockResolvedValueOnce([]);
    vi.spyOn(apiClient, 'exportNotebookLM').mockResolvedValueOnce({
      status: 'error',
      message: 'nlm CLI authentication expired',
      filename: 'rss-digest.md',
      word_count: 1000,
    });
    const onNotify = vi.fn();

    render(
      <FiltersExportModal
        open={true}
        nlmAvailable={true}
        onClose={vi.fn()}
        onNotify={onNotify}
      />,
    );

    await user.type(screen.getByLabelText('NotebookLM Notebook ID'), 'nb-123');
    await user.click(screen.getByRole('button', { name: /推送到 NotebookLM/ }));

    expect(await screen.findByText('nlm CLI authentication expired')).toBeInTheDocument();
    expect(onNotify).toHaveBeenCalledWith('error', 'nlm CLI authentication expired');
    expect(onNotify).not.toHaveBeenCalledWith('success', '已推送到 NotebookLM');
  });

  it('adds and deletes L1 keyword blacklist rules', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiClient, 'getFilters').mockResolvedValueOnce([
      { id: 1, keyword: 'Sponsored', match_field: 'both' },
    ]);
    const createFilterSpy = vi.spyOn(apiClient, 'createFilter').mockResolvedValueOnce({
      id: 2,
      keyword: '抽奖',
      match_field: 'title',
    });
    const deleteFilterSpy = vi
      .spyOn(apiClient, 'deleteFilter')
      .mockResolvedValueOnce({ deleted: true });

    render(
      <FiltersExportModal
        open={true}
        nlmAvailable={false}
        onClose={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /L1 关键词黑名单/ }));
    expect(await screen.findByText('Sponsored')).toBeInTheDocument();

    await user.type(screen.getByLabelText('黑名单关键词'), '抽奖');
    await user.selectOptions(screen.getByLabelText('匹配字段'), 'title');
    await user.click(screen.getByRole('button', { name: /添加规则/ }));

    await waitFor(() => {
      expect(createFilterSpy).toHaveBeenCalledWith({
        keyword: '抽奖',
        match_field: 'title',
      });
    });
    expect(await screen.findByText('抽奖')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '删除规则 Sponsored' }));
    await waitFor(() => {
      expect(deleteFilterSpy).toHaveBeenCalledWith(1);
    });
    expect(screen.queryByText('Sponsored')).not.toBeInTheDocument();
  });
});
