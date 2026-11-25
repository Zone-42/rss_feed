import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '../api/client';

describe('apiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds query parameters accurately for getEntries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await apiClient.getEntries({
      view_type: 'hn',
      unread_only: true,
      q: 'LLM',
      limit: 25,
      offset: 10,
    });

    expect(res).toEqual({ items: [], total: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/api/entries?');
    expect(calledUrl).toContain('view_type=hn');
    expect(calledUrl).toContain('unread_only=true');
    expect(calledUrl).toContain('q=LLM');
    expect(calledUrl).toContain('limit=25');
    expect(calledUrl).toContain('offset=10');
  });

  it('sends JSON bodies for createFeed, exportMarkdown, and createFilter', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 1,
            title: 'Karpathy',
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
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            filename: 'digest.md',
            markdown: '# Digest',
            entry_count: 3,
            word_count: 1500,
            safe_limit: 400000,
            within_limit: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    await apiClient.createFeed({
      url: 'https://www.youtube.com/@AndrejKarpathy',
      view_type: 'video',
      feed_kind: 'youtube',
      exclude_shorts: true,
    });

    const exportRes = await apiClient.exportMarkdown({
      starred_only: true,
      days: 7,
    });

    expect(exportRes.within_limit).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"exclude_shorts":true');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/export/markdown');
  });

  it('throws ApiError with backend detail message on error status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'GEMINI_API_KEY not configured' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(apiClient.summarizeEntry(99)).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      detail: 'GEMINI_API_KEY not configured',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal error', { status: 500 }),
    );
    await expect(apiClient.getHealth()).rejects.toBeInstanceOf(ApiError);
  });
});
