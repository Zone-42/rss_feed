import type {
  CreateFeedPayload,
  EntriesQuery,
  EntriesResponse,
  Entry,
  ExportMarkdownPayload,
  ExportMarkdownResponse,
  ExportNotebookLMPayload,
  ExportNotebookLMResponse,
  Feed,
  FilterRule,
  HNCommentsResponse,
  HealthStatus,
  OpmlImportResponse,
  PodcastDiscoverResponse,
  RefreshAllResult,
  RefreshFeedResult,
  SeedStarterResult,
  SummarizeResponse,
  UpdateEntryPayload,
  UpdateFeedPayload,
  ViewType,
} from '../types/api';

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as { detail?: unknown; message?: unknown };
      if (typeof data.detail === 'string') return data.detail;
      if (typeof data.message === 'string') return data.message;
      if (data.detail) return JSON.stringify(data.detail);
    }
    const text = await res.text();
    if (text.trim()) return text.trim();
  } catch {
    // ignore parse errors
  }
  return `HTTP ${res.status} ${res.statusText}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const detail = await parseErrorDetail(res);
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const apiClient = {
  getHealth(): Promise<HealthStatus> {
    return requestJson<HealthStatus>('/api/health');
  },

  getFeeds(): Promise<Feed[]> {
    return requestJson<Feed[]>('/api/feeds');
  },

  createFeed(payload: CreateFeedPayload): Promise<Feed> {
    return requestJson<Feed>('/api/feeds', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateFeed(id: number, payload: UpdateFeedPayload): Promise<Feed> {
    return requestJson<Feed>(`/api/feeds/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  deleteFeed(id: number): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/feeds/${id}`, {
      method: 'DELETE',
    });
  },

  refreshFeed(id: number): Promise<RefreshFeedResult> {
    return requestJson<RefreshFeedResult>(`/api/feeds/${id}/refresh`, {
      method: 'POST',
    });
  },

  refreshAllFeeds(): Promise<RefreshAllResult> {
    return requestJson<RefreshAllResult>('/api/feeds/refresh-all', {
      method: 'POST',
    });
  },

  seedStarterFeeds(): Promise<SeedStarterResult> {
    return requestJson<SeedStarterResult>('/api/feeds/seed-starter', {
      method: 'POST',
    });
  },

  getEntries(query: EntriesQuery = {}): Promise<EntriesResponse> {
    const params = new URLSearchParams();
    if (query.view_type) params.set('view_type', query.view_type);
    if (query.feed_id !== undefined) params.set('feed_id', String(query.feed_id));
    if (query.starred !== undefined) params.set('starred', String(query.starred));
    if (query.unread_only !== undefined) params.set('unread_only', String(query.unread_only));
    if (query.q && query.q.trim()) params.set('q', query.q.trim());
    params.set('limit', String(query.limit ?? 50));
    params.set('offset', String(query.offset ?? 0));
    return requestJson<EntriesResponse>(`/api/entries?${params.toString()}`);
  },

  getEntry(id: number): Promise<Entry> {
    return requestJson<Entry>(`/api/entries/${id}`);
  },

  updateEntry(id: number, payload: UpdateEntryPayload): Promise<Entry> {
    return requestJson<Entry>(`/api/entries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  markAllRead(payload: { view_type?: ViewType; feed_id?: number }): Promise<{ updated: number }> {
    return requestJson<{ updated: number }>('/api/entries/mark-all-read', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  extractEntry(id: number): Promise<Entry> {
    return requestJson<Entry>(`/api/entries/${id}/extract`, {
      method: 'POST',
    });
  },

  summarizeEntry(id: number, force = false): Promise<SummarizeResponse> {
    return requestJson<SummarizeResponse>(`/api/entries/${id}/summarize`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    });
  },

  getHNComments(id: number): Promise<HNCommentsResponse> {
    return requestJson<HNCommentsResponse>(`/api/entries/${id}/hn-comments`);
  },

  discoverPodcasts(q: string): Promise<PodcastDiscoverResponse> {
    const params = new URLSearchParams({ q: q.trim() });
    return requestJson<PodcastDiscoverResponse>(`/api/discover/podcasts?${params.toString()}`);
  },

  getFilters(): Promise<FilterRule[]> {
    return requestJson<FilterRule[]>('/api/filters');
  },

  createFilter(payload: { keyword: string; match_field?: string }): Promise<FilterRule> {
    return requestJson<FilterRule>('/api/filters', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  deleteFilter(id: number): Promise<{ deleted?: boolean } | void> {
    return requestJson<{ deleted?: boolean }>(`/api/filters/${id}`, {
      method: 'DELETE',
    });
  },

  async exportOpml(): Promise<string> {
    const res = await fetch('/api/opml/export');
    if (!res.ok) {
      throw new ApiError(res.status, await parseErrorDetail(res));
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as { opml_xml?: string };
      return data.opml_xml ?? '';
    }
    return res.text();
  },

  importOpml(opmlXml: string): Promise<OpmlImportResponse> {
    return requestJson<OpmlImportResponse>('/api/opml/import', {
      method: 'POST',
      body: JSON.stringify({ opml_xml: opmlXml }),
    });
  },

  exportMarkdown(payload: ExportMarkdownPayload): Promise<ExportMarkdownResponse> {
    return requestJson<ExportMarkdownResponse>('/api/export/markdown', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  exportNotebookLM(payload: ExportNotebookLMPayload): Promise<ExportNotebookLMResponse> {
    return requestJson<ExportNotebookLMResponse>('/api/export/notebooklm', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
