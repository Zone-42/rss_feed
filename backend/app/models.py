"""Pydantic models for the Personal RSS Reader REST API contract."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ViewType = Literal["article", "hn", "video", "audio", "social"]
FeedKind = Literal["rss", "hn_algolia", "youtube", "podcast", "rsshub"]
MatchField = Literal["both", "title", "content"]


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.2.0"
    ai_configured: bool
    nlm_available: bool


class FeedOut(BaseModel):
    id: int
    title: str
    url: str
    site_url: str | None = None
    view_type: str
    feed_kind: str
    category: str
    icon_url: str | None = None
    unread_count: int = 0
    last_fetched_at: str | None = None
    last_error: str | None = None
    enabled: bool = True
    config_json: str = "{}"


class FeedCreate(BaseModel):
    url: str = Field(min_length=1)
    title: str | None = None
    view_type: str | None = None
    feed_kind: str | None = None
    category: str | None = None
    exclude_shorts: bool = False
    min_points: int | None = Field(default=None, ge=1)


class FeedUpdate(BaseModel):
    title: str | None = None
    view_type: str | None = None
    category: str | None = None
    enabled: bool | None = None


class FeedDeleteResponse(BaseModel):
    deleted: bool = True


class FeedRefreshResponse(BaseModel):
    added: int
    filtered: int
    error: str | None = None


class FeedRefreshError(BaseModel):
    feed_id: int
    error: str


class RefreshAllResponse(BaseModel):
    feeds_refreshed: int
    total_added: int
    total_filtered: int
    errors: list[FeedRefreshError] = Field(default_factory=list)


class SeedStarterResponse(BaseModel):
    added_feeds: int
    feeds: list[FeedOut]


class EntryOut(BaseModel):
    id: int
    feed_id: int
    feed_title: str
    view_type: str
    title: str
    url: str
    author: str | None = None
    summary: str | None = None
    content_html: str | None = None
    extracted_text: str | None = None
    ai_summary: str | None = None
    image_url: str | None = None
    audio_url: str | None = None
    audio_duration: str | None = None
    video_id: str | None = None
    hn_item_id: str | None = None
    hn_points: int | None = None
    hn_comments_count: int | None = None
    published_at: str | None = None
    discovered_at: str
    is_read: bool = False
    is_starred: bool = False
    playback_seconds: float = 0.0


class EntryListResponse(BaseModel):
    items: list[EntryOut]
    total: int


class EntryUpdate(BaseModel):
    is_read: bool | None = None
    is_starred: bool | None = None
    playback_seconds: float | None = Field(default=None, ge=0.0)


class MarkAllReadRequest(BaseModel):
    view_type: str | None = None
    feed_id: int | None = None


class MarkAllReadResponse(BaseModel):
    updated: int


class SummarizeRequest(BaseModel):
    force: bool = False


class SummarizeResponse(BaseModel):
    ai_summary: str
    model: str
    cached: bool


class HNComment(BaseModel):
    id: str
    author: str
    text: str
    created_at: str | None = None
    children: list[HNComment] = Field(default_factory=list)


class HNCommentsResponse(BaseModel):
    comments: list[HNComment]


class PodcastSearchResult(BaseModel):
    title: str
    author: str
    feed_url: str
    artwork_url: str | None = None
    genre: str | None = None


class PodcastDiscoverResponse(BaseModel):
    results: list[PodcastSearchResult]


class FilterRuleOut(BaseModel):
    id: int
    keyword: str
    match_field: str
    created_at: str


class FilterRuleCreate(BaseModel):
    keyword: str = Field(min_length=1)
    match_field: MatchField = "both"


class FilterDeleteResponse(BaseModel):
    deleted: bool = True


class OpmlImportRequest(BaseModel):
    opml_xml: str = Field(min_length=1)


class OpmlImportResponse(BaseModel):
    added: int
    skipped: int
    feeds: list[FeedOut]


class ExportMarkdownRequest(BaseModel):
    entry_ids: list[int] | None = None
    starred_only: bool = False
    view_type: str | None = None
    days: int | None = Field(default=7, ge=0)
    title: str | None = None


class ExportMarkdownResponse(BaseModel):
    filename: str
    markdown: str
    entry_count: int
    word_count: int
    safe_limit: int = 400_000
    within_limit: bool


class ExportNotebookLMRequest(BaseModel):
    notebook_id: str | None = None
    title: str | None = None
    entry_ids: list[int] | None = None
    starred_only: bool = False
    view_type: str | None = None
    days: int | None = Field(default=7, ge=0)


class ExportNotebookLMResponse(BaseModel):
    status: str
    message: str
    filename: str
    word_count: int
