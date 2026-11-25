import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { apiClient } from '../api/client';
import type { Entry, Feed } from '../types/api';

const MOCK_FEEDS: Feed[] = [
  {
    id: 1,
    title: 'Bloomberg Markets',
    url: 'https://feeds.bloomberg.com/markets/news.rss',
    site_url: 'https://bloomberg.com',
    view_type: 'article',
    feed_kind: 'rss',
    category: 'Finance',
    icon_url: null,
    unread_count: 2,
    last_fetched_at: '2026-11-25T09:00:00Z',
    last_error: null,
    enabled: true,
    config_json: '{}',
  },
  {
    id: 2,
    title: 'High-Signal HN',
    url: 'algolia://hn?points=100',
    site_url: 'https://news.ycombinator.com',
    view_type: 'hn',
    feed_kind: 'hn_algolia',
    category: 'Hacker News',
    icon_url: null,
    unread_count: 1,
    last_fetched_at: '2026-11-25T09:00:00Z',
    last_error: null,
    enabled: true,
    config_json: '{}',
  },
  {
    id: 3,
    title: 'Andrej Karpathy',
    url: 'https://www.youtube.com/feeds/videos.xml?playlist_id=UULF123',
    site_url: 'https://youtube.com/@AndrejKarpathy',
    view_type: 'video',
    feed_kind: 'youtube',
    category: 'YouTube',
    icon_url: null,
    unread_count: 1,
    last_fetched_at: '2026-11-25T09:00:00Z',
    last_error: null,
    enabled: true,
    config_json: '{}',
  },
  {
    id: 4,
    title: 'Acquired',
    url: 'https://feeds.transistor.fm/acquired',
    site_url: 'https://acquired.fm',
    view_type: 'audio',
    feed_kind: 'podcast',
    category: 'Podcast',
    icon_url: null,
    unread_count: 1,
    last_fetched_at: '2026-11-25T09:00:00Z',
    last_error: null,
    enabled: true,
    config_json: '{}',
  },
];

const MOCK_ENTRIES: Entry[] = [
  {
    id: 101,
    feed_id: 1,
    feed_title: 'Bloomberg Markets',
    view_type: 'article',
    title: 'Global Chip Demand Accelerates',
    url: 'https://bloomberg.com/news/chip-demand',
    author: 'Jane Doe',
    summary: 'Chipmakers see strong orders.',
    content_html: '<p>Full article body.</p><script>window.__xss=1</script>',
    extracted_text: null,
    ai_summary: null,
    image_url: null,
    audio_url: null,
    audio_duration: null,
    video_id: null,
    hn_item_id: null,
    hn_points: null,
    hn_comments_count: null,
    published_at: '2026-11-25T08:00:00Z',
    discovered_at: '2026-11-25T08:05:00Z',
    is_read: false,
    is_starred: false,
    playback_seconds: 0,
  },
  {
    id: 102,
    feed_id: 2,
    feed_title: 'High-Signal HN',
    view_type: 'hn',
    title: 'Show HN: Fast SQLite RSS Engine',
    url: 'https://example.com/sqlite-rss',
    author: 'pg',
    summary: 'Built in Python and React.',
    content_html: '<p>HN post details</p>',
    extracted_text: null,
    ai_summary: null,
    image_url: null,
    audio_url: null,
    audio_duration: null,
    video_id: null,
    hn_item_id: '420001',
    hn_points: 312,
    hn_comments_count: 89,
    published_at: '2026-11-25T06:00:00Z',
    discovered_at: '2026-11-25T09:00:00Z',
    is_read: false,
    is_starred: false,
    playback_seconds: 0,
  },
  {
    id: 103,
    feed_id: 3,
    feed_title: 'Andrej Karpathy',
    view_type: 'video',
    title: 'Deep Dive into LLMs',
    url: 'https://www.youtube.com/watch?v=7xTGNNLPyMI',
    author: 'Andrej Karpathy',
    summary: 'A general audience deep dive.',
    content_html: '<p>Video notes</p>',
    extracted_text: null,
    ai_summary: null,
    image_url: 'https://i.ytimg.com/vi/7xTGNNLPyMI/hqdefault.jpg',
    audio_url: null,
    audio_duration: null,
    video_id: '7xTGNNLPyMI',
    hn_item_id: null,
    hn_points: null,
    hn_comments_count: null,
    published_at: '2026-11-24T12:00:00Z',
    discovered_at: '2026-11-24T12:10:00Z',
    is_read: false,
    is_starred: false,
    playback_seconds: 0,
  },
  {
    id: 104,
    feed_id: 4,
    feed_title: 'Acquired',
    view_type: 'audio',
    title: 'TSMC: The Complete History',
    url: 'https://acquired.fm/episodes/tsmc',
    author: 'Ben & David',
    summary: '05:30 Founding story and 1:10:00 modern fabs.',
    content_html: '<p>Chapters: 05:30 Founding story, 1:10:00 Modern fabs.</p>',
    extracted_text: null,
    ai_summary: null,
    image_url: 'https://cdn.acquired.fm/cover.jpg',
    audio_url: 'https://cdn.acquired.fm/tsmc.mp3',
    audio_duration: '3:40:00',
    video_id: null,
    hn_item_id: null,
    hn_points: null,
    hn_comments_count: null,
    published_at: '2026-11-23T12:00:00Z',
    discovered_at: '2026-11-23T12:10:00Z',
    is_read: false,
    is_starred: true,
    playback_seconds: 0,
  },
];

describe('Multi-view rendering, sanitization, and persistent audio player', () => {
  beforeEach(() => {
    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({
      status: 'ok',
      version: '0.3.0',
      ai_configured: true,
      nlm_available: false,
    });
    vi.spyOn(apiClient, 'getFeeds').mockResolvedValue(MOCK_FEEDS);
    vi.spyOn(apiClient, 'getEntries').mockImplementation(async (query) => {
      let items = [...MOCK_ENTRIES];
      if (query?.view_type) {
        items = items.filter((e) => e.view_type === query.view_type);
      }
      if (query?.starred) {
        items = items.filter((e) => e.is_starred);
      }
      return { items, total: items.length };
    });
    vi.spyOn(apiClient, 'updateEntry').mockImplementation(async (id, payload) => {
      const existing = MOCK_ENTRIES.find((e) => e.id === id) ?? MOCK_ENTRIES[0];
      return { ...existing, ...payload };
    });
    vi.spyOn(apiClient, 'getHNComments').mockResolvedValue({
      comments: [
        {
          id: 'c1',
          author: 'dang',
          text: '<p>Great technical breakdown!</p>',
          created_at: '2026-11-25T08:30:00Z',
          children: [
            {
              id: 'c2',
              author: 'alice',
              text: '<p>Agreed, SQLite FTS is super fast.</p>',
              created_at: '2026-11-25T08:45:00Z',
              children: [],
            },
          ],
        },
      ],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sanitizes article HTML with DOMPurify and strips script tags', async () => {
    const user = userEvent.setup();
    render(<App />);

    const articleTitle = await screen.findByText('Global Chip Demand Accelerates');
    await user.click(articleTitle);

    const readerContent = await screen.findByTestId('reader-content');
    expect(readerContent.textContent).toContain('Full article body.');
    expect(readerContent.querySelector('script')).toBeNull();
  });

  it('renders Hacker News points and loads nested Algolia comments', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByTestId('nav-view-hn'));
    expect(await screen.findByText('312')).toBeInTheDocument();

    await user.click(screen.getByText('Show HN: Fast SQLite RSS Engine'));
    const loadBtn = await screen.findByRole('button', { name: /Load Top Comments/i });
    await user.click(loadBtn);

    expect(await screen.findByText('Great technical breakdown!')).toBeInTheDocument();
    expect(screen.getByText('Agreed, SQLite FTS is super fast.')).toBeInTheDocument();
  });

  it('renders YouTube 16:9 grid and youtube-nocookie iframe player', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByTestId('nav-view-video'));
    const videoCard = await screen.findByText('Deep Dive into LLMs');
    await user.click(videoCard);

    const iframe = await screen.findByTitle('Deep Dive into LLMs');
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.getAttribute('src')).toBe(
      'https://www.youtube-nocookie.com/embed/7xTGNNLPyMI',
    );
  });

  it('seeks persistent global audio player from podcast shownotes timestamps and survives view switches', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Open Podcasts view
    await user.click(await screen.findByTestId('nav-view-audio'));
    const epTitle = await screen.findByText('TSMC: The Complete History');
    await user.click(epTitle);

    // Click 05:30 timestamp inside shownotes
    const tsLink = await screen.findByText('05:30');
    expect(tsLink.getAttribute('data-seek-seconds')).toBe('330');
    await user.click(tsLink);

    // Persistent bottom audio player appears at 05:30 and parses string audio_duration "3:40:00"
    const playerBar = await screen.findByTestId('global-audio-player');
    expect(playerBar).toBeInTheDocument();
    expect(screen.getByTestId('audio-current-time')).toHaveTextContent('05:30');
    expect(playerBar).toHaveTextContent('3:40:00');

    // Switch to Articles view: audio player MUST remain mounted!
    await user.click(screen.getByTestId('nav-view-article'));
    await screen.findByText('Global Chip Demand Accelerates');
    expect(screen.getByTestId('global-audio-player')).toBeInTheDocument();

    // Simulate pause event on <audio> and verify playback_seconds sync call
    const audioEl = screen.getByTestId('global-audio-element') as HTMLAudioElement;
    Object.defineProperty(audioEl, 'currentTime', { value: 330, writable: true });
    fireEvent.pause(audioEl);

    await waitFor(() => {
      expect(apiClient.updateEntry).toHaveBeenCalledWith(104, {
        playback_seconds: 330,
      });
    });
  });

  it('displays Social RSSHub / MediaCrawler quick-add guidance banner', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByTestId('nav-view-social'));
    expect(await screen.findByText(/RSSHub \/ MediaCrawler 接入/)).toBeInTheDocument();
  });

  it('blocks javascript: entry URLs in ReaderPane links and on keyboard shortcut o', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    vi.spyOn(apiClient, 'getEntries').mockResolvedValue({
      items: [
        {
          ...MOCK_ENTRIES[0],
          id: 999,
          title: 'Untrusted Feed Entry',
          url: 'javascript:alert(1)',
        },
      ],
      total: 1,
    });

    render(<App />);
    const item = await screen.findByText('Untrusted Feed Entry');
    await user.click(item);

    const reader = await screen.findByTestId('reader-pane');
    expect(reader.querySelector('a[href^="javascript:"]')).toBeNull();

    // Pressing 'o' must NOT invoke window.open for unsafe schemes
    fireEvent.keyDown(window, { key: 'o' });
    expect(openSpy).not.toHaveBeenCalled();
  });
});
