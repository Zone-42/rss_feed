export type ViewType = 'article' | 'hn' | 'video' | 'audio' | 'social';

export type NavView = 'all' | ViewType | 'starred';

export interface HealthStatus {
  status: string;
  version: string;
  ai_configured: boolean;
  nlm_available: boolean;
}

export interface Feed {
  id: number;
  title: string;
  url: string;
  site_url: string | null;
  view_type: ViewType;
  feed_kind: string;
  category: string | null;
  icon_url: string | null;
  unread_count: number;
  last_fetched_at: string | null;
  last_error: string | null;
  enabled: boolean;
  config_json: string | null;
}

export interface CreateFeedPayload {
  url: string;
  title?: string;
  view_type?: ViewType;
  feed_kind?: string;
  category?: string;
  exclude_shorts?: boolean;
}

export interface UpdateFeedPayload {
  title?: string;
  view_type?: ViewType;
  category?: string;
  enabled?: boolean;
}

export interface RefreshFeedResult {
  added: number;
  filtered: number;
  error?: string | null;
}

export interface RefreshAllResult {
  feeds_refreshed: number;
  total_added: number;
  total_filtered: number;
  errors: Array<{ feed_id: number; error: string }>;
}

export interface SeedStarterResult {
  added_feeds: number;
  feeds: Feed[];
}

export interface Entry {
  id: number;
  feed_id: number;
  feed_title: string | null;
  view_type: ViewType;
  title: string;
  url: string | null;
  author: string | null;
  summary: string | null;
  content_html: string | null;
  extracted_text: string | null;
  ai_summary: string | null;
  image_url: string | null;
  audio_url: string | null;
  audio_duration: number | string | null;
  video_id: string | null;
  hn_item_id: string | number | null;
  hn_points: number | null;
  hn_comments_count: number | null;
  published_at: string | null;
  discovered_at: string | null;
  is_read: boolean;
  is_starred: boolean;
  playback_seconds: number;
}

export interface EntriesQuery {
  view_type?: ViewType;
  feed_id?: number;
  starred?: boolean;
  unread_only?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface EntriesResponse {
  items: Entry[];
  total: number;
}

export interface UpdateEntryPayload {
  is_read?: boolean;
  is_starred?: boolean;
  playback_seconds?: number;
}

export interface SummarizeResponse {
  ai_summary: string;
  model: string;
  cached: boolean;
}

export interface HNComment {
  id: string | number;
  author: string | null;
  text: string | null;
  created_at: string | null;
  children?: HNComment[];
}

export interface HNCommentsResponse {
  comments: HNComment[];
}

export interface PodcastSearchResult {
  title: string;
  author: string | null;
  feed_url: string;
  artwork_url: string | null;
  genre: string | null;
}

export interface PodcastDiscoverResponse {
  results: PodcastSearchResult[];
}

export interface FilterRule {
  id: number;
  keyword: string;
  match_field: string;
  created_at?: string;
}

export interface ExportMarkdownPayload {
  entry_ids?: number[];
  starred_only?: boolean;
  view_type?: ViewType;
  days?: number;
  title?: string;
}

export interface ExportMarkdownResponse {
  filename: string;
  markdown: string;
  entry_count: number;
  word_count: number;
  safe_limit: number;
  within_limit: boolean;
}

export interface ExportNotebookLMPayload extends ExportMarkdownPayload {
  notebook_id: string;
}

export interface ExportNotebookLMResponse {
  status: string;
  message: string;
  filename?: string;
  word_count?: number;
}

export interface OpmlImportResponse {
  added?: number;
  added_feeds?: number;
  skipped?: number;
  feeds?: Feed[];
}
