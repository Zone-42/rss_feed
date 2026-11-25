"""FastAPI application and REST API endpoints for the Personal RSS Reader MVP."""

from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import parse_qsl, urlparse

from fastapi import Body, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.ai_export import (
    AIConfigError,
    AIProviderError,
    build_packed_markdown,
    export_opml,
    find_nlm_binary,
    import_opml,
    push_to_notebooklm,
    summarize_entry,
)
from app.config import APP_VERSION, REPO_ROOT, Settings, get_settings
from app.db import Database
from app.fetchers import (
    ProxyError,
    discover_podcasts,
    extract_entry_full_text,
    fetch_hn_comments,
    fetch_proxied_image,
    is_youtube_url,
    refresh_feed,
    resolve_youtube_feed_url,
)
from app.models import (
    EntryListResponse,
    EntryOut,
    EntryUpdate,
    ExportMarkdownRequest,
    ExportMarkdownResponse,
    ExportNotebookLMRequest,
    ExportNotebookLMResponse,
    FeedCreate,
    FeedDeleteResponse,
    FeedOut,
    FeedRefreshError,
    FeedRefreshResponse,
    FeedUpdate,
    FilterDeleteResponse,
    FilterRuleCreate,
    FilterRuleOut,
    HealthResponse,
    HNCommentsResponse,
    MarkAllReadRequest,
    MarkAllReadResponse,
    OpmlImportRequest,
    OpmlImportResponse,
    PodcastDiscoverResponse,
    RefreshAllResponse,
    SeedStarterResponse,
    SummarizeRequest,
    SummarizeResponse,
)

logger = logging.getLogger(__name__)


async def _refresh_all_feeds_concurrently(db: Database) -> RefreshAllResponse:
    feeds = db.list_feeds(enabled_only=True)
    sem = asyncio.Semaphore(6)

    async def _run_one(feed: FeedOut) -> tuple[int, int, int, str | None]:
        async with sem:
            added, filtered, err = await refresh_feed(db, feed)
            return feed.id, added, filtered, err

    results = await asyncio.gather(*(_run_one(feed) for feed in feeds))
    total_added = 0
    total_filtered = 0
    errors: list[FeedRefreshError] = []
    for feed_id, added, filtered, err in results:
        total_added += added
        total_filtered += filtered
        if err:
            errors.append(FeedRefreshError(feed_id=feed_id, error=err))

    return RefreshAllResponse(
        feeds_refreshed=len(feeds),
        total_added=total_added,
        total_filtered=total_filtered,
        errors=errors,
    )


def _should_enable_background_refresh(db_path: str, minutes: int) -> bool:
    if minutes <= 0:
        return False
    if db_path == ":memory:":
        return False
    return "PYTEST_CURRENT_TEST" not in os.environ


def create_app(
    *,
    db_path: str | None = None,
    auto_refresh_minutes: int | None = None,
    frontend_dist_dir: Path | None = None,
) -> FastAPI:
    """Create and configure the FastAPI application instance."""
    initial_settings: Settings = get_settings()
    resolved_db_path = db_path if db_path is not None else initial_settings.resolved_db_path()
    refresh_interval = (
        auto_refresh_minutes
        if auto_refresh_minutes is not None
        else initial_settings.rss_auto_refresh_minutes
    )

    db = Database(resolved_db_path)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        db.init_db()
        db.seed_starter_on_first_boot()

        refresh_task: asyncio.Task[None] | None = None
        if _should_enable_background_refresh(resolved_db_path, refresh_interval):
            async def _auto_refresh_loop() -> None:
                while True:
                    await asyncio.sleep(refresh_interval * 60)
                    try:
                        await _refresh_all_feeds_concurrently(db)
                    except Exception:
                        logger.exception("Background feed refresh failed")

            refresh_task = asyncio.create_task(_auto_refresh_loop())

        try:
            yield
        finally:
            if refresh_task is not None:
                refresh_task.cancel()
                with suppress(asyncio.CancelledError):
                    await refresh_task
            db.close()

    app = FastAPI(
        title="Personal RSS Reader API",
        version=APP_VERSION,
        lifespan=lifespan,
    )
    app.state.db = db

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ],
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------
    @app.get("/api/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        settings = get_settings()
        return HealthResponse(
            status="ok",
            version=APP_VERSION,
            ai_configured=settings.ai_configured,
            nlm_available=find_nlm_binary() is not None,
        )

    # ------------------------------------------------------------------
    # Feeds
    # ------------------------------------------------------------------
    @app.get("/api/feeds", response_model=list[FeedOut])
    async def list_feeds() -> list[FeedOut]:
        return db.list_feeds()

    @app.post("/api/feeds", response_model=FeedOut)
    async def create_feed(payload: FeedCreate) -> FeedOut:
        raw_url = payload.url.strip()
        if not raw_url:
            raise HTTPException(status_code=400, detail="Feed URL is required")

        # Handle shorthand YouTube @handle input
        if raw_url.startswith("@"):
            raw_url = f"https://www.youtube.com/{raw_url}"

        parsed = urlparse(raw_url)
        scheme = parsed.scheme.lower()
        if scheme not in ("http", "https", "algolia"):
            raise HTTPException(
                status_code=400,
                detail="Feed URL must use http://, https://, or algolia:// scheme",
            )

        feed_url = raw_url
        site_url: str | None = None
        title = (payload.title or "").strip() or None
        view_type = payload.view_type
        feed_kind = payload.feed_kind
        category = payload.category
        config: dict[str, Any] = {}

        if scheme == "algolia" or feed_kind == "hn_algolia":
            feed_kind = "hn_algolia"
            view_type = view_type or "hn"
            category = category or "Hacker News"
            params = dict(parse_qsl(parsed.query))
            min_pts = payload.min_points
            if min_pts is None and "points" in params:
                try:
                    min_pts = max(1, int(params["points"]))
                except ValueError:
                    min_pts = 100
            min_pts = min_pts or 100
            feed_url = f"algolia://hn?points={min_pts}"
            site_url = "https://news.ycombinator.com"
            config = {"min_points": min_pts}
            title = title or f"Hacker News ({min_pts}+ pts)"
        elif feed_kind == "youtube" or is_youtube_url(raw_url):
            feed_kind = "youtube"
            view_type = view_type or "video"
            category = category or "YouTube"
            try:
                resolved = await resolve_youtube_feed_url(
                    raw_url,
                    exclude_shorts=payload.exclude_shorts,
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            feed_url = resolved.feed_url
            site_url = resolved.site_url
            title = title or resolved.title or (parsed.hostname or feed_url)
            config = {
                "channel_id": resolved.channel_id,
                "exclude_shorts": resolved.exclude_shorts,
            }
        elif feed_kind == "podcast" or view_type == "audio":
            feed_kind = feed_kind or "podcast"
            view_type = view_type or "audio"
            category = category or "Podcasts"
        elif feed_kind == "rsshub" or view_type == "social" or "rsshub" in raw_url.lower():
            feed_kind = feed_kind or "rsshub"
            view_type = view_type or "social"
            category = category or "Social"
        else:
            feed_kind = feed_kind or "rss"
            view_type = view_type or "article"
            category = category or "General"

        final_title = title or (parsed.hostname or feed_url)

        try:
            return db.create_feed(
                title=final_title,
                url=feed_url,
                site_url=site_url,
                view_type=view_type,
                feed_kind=feed_kind,
                category=category,
                config=config,
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=409,
                detail="A feed with this URL already exists",
            ) from exc

    @app.post("/api/feeds/seed-starter", response_model=SeedStarterResponse)
    async def seed_starter() -> SeedStarterResponse:
        added_feeds, feeds = db.seed_starter_feeds()
        return SeedStarterResponse(added_feeds=added_feeds, feeds=feeds)

    @app.post("/api/feeds/refresh-all", response_model=RefreshAllResponse)
    async def refresh_all() -> RefreshAllResponse:
        return await _refresh_all_feeds_concurrently(db)

    @app.patch("/api/feeds/{feed_id}", response_model=FeedOut)
    async def update_feed(feed_id: int, payload: FeedUpdate) -> FeedOut:
        updated = db.update_feed(
            feed_id,
            title=payload.title,
            view_type=payload.view_type,
            category=payload.category,
            enabled=payload.enabled,
        )
        if updated is None:
            raise HTTPException(status_code=404, detail="Feed not found")
        return updated

    @app.delete("/api/feeds/{feed_id}", response_model=FeedDeleteResponse)
    async def delete_feed(feed_id: int) -> FeedDeleteResponse:
        if not db.delete_feed(feed_id):
            raise HTTPException(status_code=404, detail="Feed not found")
        return FeedDeleteResponse(deleted=True)

    @app.post("/api/feeds/{feed_id}/refresh", response_model=FeedRefreshResponse)
    async def refresh_single_feed(feed_id: int) -> FeedRefreshResponse:
        feed = db.get_feed(feed_id)
        if feed is None:
            raise HTTPException(status_code=404, detail="Feed not found")
        added, filtered, err = await refresh_feed(db, feed)
        return FeedRefreshResponse(added=added, filtered=filtered, error=err)

    # ------------------------------------------------------------------
    # Entries
    # ------------------------------------------------------------------
    @app.get("/api/entries", response_model=EntryListResponse)
    async def list_entries(
        view_type: str | None = Query(default=None),
        feed_id: int | None = Query(default=None),
        starred: bool | None = Query(default=None),
        unread_only: bool | None = Query(default=None),
        q: str | None = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> EntryListResponse:
        items, total = db.list_entries(
            view_type=view_type,
            feed_id=feed_id,
            starred=starred,
            unread_only=unread_only,
            q=q,
            limit=limit,
            offset=offset,
        )
        return EntryListResponse(items=items, total=total)

    @app.post("/api/entries/mark-all-read", response_model=MarkAllReadResponse)
    async def mark_all_read(
        payload: Annotated[MarkAllReadRequest | None, Body()] = None,
    ) -> MarkAllReadResponse:
        req = payload or MarkAllReadRequest()
        updated = db.mark_all_read(view_type=req.view_type, feed_id=req.feed_id)
        return MarkAllReadResponse(updated=updated)

    @app.get("/api/entries/{entry_id}", response_model=EntryOut)
    async def get_entry(entry_id: int) -> EntryOut:
        entry = db.get_entry(entry_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Entry not found")
        return entry

    @app.patch("/api/entries/{entry_id}", response_model=EntryOut)
    async def update_entry(entry_id: int, payload: EntryUpdate) -> EntryOut:
        updated = db.update_entry(
            entry_id,
            is_read=payload.is_read,
            is_starred=payload.is_starred,
            playback_seconds=payload.playback_seconds,
        )
        if updated is None:
            raise HTTPException(status_code=404, detail="Entry not found")
        return updated

    @app.post("/api/entries/{entry_id}/extract", response_model=EntryOut)
    async def extract_entry(entry_id: int) -> EntryOut:
        entry = db.get_entry(entry_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Entry not found")
        return await extract_entry_full_text(db, entry)

    @app.post("/api/entries/{entry_id}/summarize", response_model=SummarizeResponse)
    async def summarize_single_entry(
        entry_id: int,
        payload: Annotated[SummarizeRequest | None, Body()] = None,
    ) -> SummarizeResponse:
        entry = db.get_entry(entry_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Entry not found")
        req = payload or SummarizeRequest()
        settings = get_settings()
        try:
            return await summarize_entry(db, entry, settings, force=req.force)
        except AIConfigError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except AIProviderError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @app.get("/api/entries/{entry_id}/hn-comments", response_model=HNCommentsResponse)
    async def get_hn_comments(entry_id: int) -> HNCommentsResponse:
        entry = db.get_entry(entry_id)
        if entry is None:
            raise HTTPException(status_code=404, detail="Entry not found")
        if not entry.hn_item_id:
            return HNCommentsResponse(comments=[])
        try:
            comments = await fetch_hn_comments(entry.hn_item_id)
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to fetch Hacker News comments: {exc}",
            ) from exc
        return HNCommentsResponse(comments=comments)

    # ------------------------------------------------------------------
    # Discovery & Safe Image Proxy
    # ------------------------------------------------------------------
    @app.get("/api/discover/podcasts", response_model=PodcastDiscoverResponse)
    async def search_podcasts(q: str = Query(default="")) -> PodcastDiscoverResponse:
        if not q.strip():
            return PodcastDiscoverResponse(results=[])
        try:
            results = await discover_podcasts(q)
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Podcast search failed: {exc}",
            ) from exc
        return PodcastDiscoverResponse(results=results)

    @app.get("/api/image-proxy")
    async def image_proxy(url: str = Query(..., min_length=1)) -> Response:
        try:
            content, content_type = await fetch_proxied_image(url)
        except ProxyError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        return Response(
            content=content,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=3600",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox",
            },
        )

    # ------------------------------------------------------------------
    # L1 Keyword Filters
    # ------------------------------------------------------------------
    @app.get("/api/filters", response_model=list[FilterRuleOut])
    async def list_filters() -> list[FilterRuleOut]:
        return db.list_filter_rules()

    @app.post("/api/filters", response_model=FilterRuleOut)
    async def create_filter(payload: FilterRuleCreate) -> FilterRuleOut:
        kw = payload.keyword.strip()
        if not kw:
            raise HTTPException(status_code=400, detail="Filter keyword cannot be empty")
        try:
            return db.create_filter_rule(kw, match_field=payload.match_field)
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=409,
                detail="This filter keyword already exists",
            ) from exc

    @app.delete("/api/filters/{rule_id}", response_model=FilterDeleteResponse)
    async def delete_filter(rule_id: int) -> FilterDeleteResponse:
        if not db.delete_filter_rule(rule_id):
            raise HTTPException(status_code=404, detail="Filter rule not found")
        return FilterDeleteResponse(deleted=True)

    # ------------------------------------------------------------------
    # OPML Import / Export
    # ------------------------------------------------------------------
    @app.get("/api/opml/export")
    async def opml_export() -> Response:
        xml_str = export_opml(db.list_feeds())
        return Response(
            content=xml_str,
            media_type="application/xml; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="rss-subscriptions.opml"'},
        )

    @app.post("/api/opml/import", response_model=OpmlImportResponse)
    async def opml_import(payload: OpmlImportRequest) -> OpmlImportResponse:
        try:
            return import_opml(payload.opml_xml, db)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ------------------------------------------------------------------
    # Knowledge Export (Obsidian / NotebookLM)
    # ------------------------------------------------------------------
    @app.post("/api/export/markdown", response_model=ExportMarkdownResponse)
    async def export_markdown(
        payload: Annotated[ExportMarkdownRequest | None, Body()] = None,
    ) -> ExportMarkdownResponse:
        req = payload or ExportMarkdownRequest()
        return build_packed_markdown(db, req)

    @app.post("/api/export/notebooklm", response_model=ExportNotebookLMResponse)
    async def export_notebooklm(payload: ExportNotebookLMRequest) -> ExportNotebookLMResponse:
        settings = get_settings()
        return await push_to_notebooklm(db, payload, settings)

    # ------------------------------------------------------------------
    # Optional static serving of built frontend (`frontend/dist`)
    # ------------------------------------------------------------------
    dist_dir = frontend_dist_dir or (REPO_ROOT / "frontend" / "dist")
    index_file = dist_dir / "index.html"
    if dist_dir.is_dir() and index_file.is_file():
        assets_dir = dist_dir / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str) -> FileResponse:
            if full_path == "api" or full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="API endpoint not found")
            candidate = (dist_dir / full_path).resolve()
            try:
                candidate.relative_to(dist_dir.resolve())
            except ValueError as exc:
                raise HTTPException(status_code=404, detail="Not found") from exc
            if full_path and candidate.is_file():
                return FileResponse(str(candidate))
            return FileResponse(str(index_file))

    return app


app = create_app()
