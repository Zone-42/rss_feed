"""SQLite storage layer, schema definitions, and curated starter feed pack."""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app.models import EntryOut, FeedOut, FilterRuleOut


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class StarterFeedSpec:
    title: str
    url: str
    site_url: str
    view_type: str
    feed_kind: str
    category: str
    config: dict[str, Any]


STARTER_FEEDS: tuple[StarterFeedSpec, ...] = (
    # Finance (article)
    StarterFeedSpec(
        title="Bloomberg Markets",
        url="https://feeds.bloomberg.com/markets/news.rss",
        site_url="https://www.bloomberg.com/markets",
        view_type="article",
        feed_kind="rss",
        category="Finance",
        config={},
    ),
    StarterFeedSpec(
        title="Bloomberg Technology",
        url="https://feeds.bloomberg.com/technology/news.rss",
        site_url="https://www.bloomberg.com/technology",
        view_type="article",
        feed_kind="rss",
        category="Finance",
        config={},
    ),
    StarterFeedSpec(
        title="WSJ Markets",
        url="https://feeds.content.dowjones.io/public/rss/RSSMarketsMain",
        site_url="https://www.wsj.com/markets",
        view_type="article",
        feed_kind="rss",
        category="Finance",
        config={},
    ),
    StarterFeedSpec(
        title="Financial Times",
        url="https://www.ft.com/rss/home",
        site_url="https://www.ft.com",
        view_type="article",
        feed_kind="rss",
        category="Finance",
        config={},
    ),
    StarterFeedSpec(
        title="Reuters (via Google News)",
        url="https://news.google.com/rss/search?q=when:24h+site:reuters.com&hl=en-US&gl=US&ceid=US:en",
        site_url="https://www.reuters.com",
        view_type="article",
        feed_kind="rss",
        category="Finance",
        config={},
    ),
    StarterFeedSpec(
        title="CNBC Top News",
        url="https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
        site_url="https://www.cnbc.com",
        view_type="article",
        feed_kind="rss",
        category="Finance",
        config={},
    ),
    # Tech (article)
    StarterFeedSpec(
        title="TechCrunch AI",
        url="https://techcrunch.com/category/artificial-intelligence/feed/",
        site_url="https://techcrunch.com/category/artificial-intelligence/",
        view_type="article",
        feed_kind="rss",
        category="Tech",
        config={},
    ),
    StarterFeedSpec(
        title="The Verge",
        url="https://www.theverge.com/rss/index.xml",
        site_url="https://www.theverge.com",
        view_type="article",
        feed_kind="rss",
        category="Tech",
        config={},
    ),
    StarterFeedSpec(
        title="Ars Technica",
        url="https://feeds.arstechnica.com/arstechnica/index",
        site_url="https://arstechnica.com",
        view_type="article",
        feed_kind="rss",
        category="Tech",
        config={},
    ),
    # Hacker News (hn_algolia)
    StarterFeedSpec(
        title="Hacker News (100+ pts)",
        url="algolia://hn?points=100",
        site_url="https://news.ycombinator.com",
        view_type="hn",
        feed_kind="hn_algolia",
        category="Hacker News",
        config={"min_points": 100},
    ),
    # Sample YouTube (video)
    StarterFeedSpec(
        title="Andrej Karpathy",
        url="https://www.youtube.com/feeds/videos.xml?channel_id=UCXUPKJO5MZQN11PqgIvyuvQ",
        site_url="https://www.youtube.com/channel/UCXUPKJO5MZQN11PqgIvyuvQ",
        view_type="video",
        feed_kind="youtube",
        category="YouTube",
        config={"channel_id": "UCXUPKJO5MZQN11PqgIvyuvQ", "exclude_shorts": False},
    ),
    StarterFeedSpec(
        title="Fireship (No Shorts)",
        url="https://www.youtube.com/feeds/videos.xml?playlist_id=UULFsBjURrPoezykLs9EqgamOA",
        site_url="https://www.youtube.com/@Fireship",
        view_type="video",
        feed_kind="youtube",
        category="YouTube",
        config={"channel_id": "UCsBjURrPoezykLs9EqgamOA", "exclude_shorts": True},
    ),
    # Sample Podcast (audio)
    StarterFeedSpec(
        title="Acquired",
        url="https://feeds.transistor.fm/acquired",
        site_url="https://www.acquired.fm",
        view_type="audio",
        feed_kind="podcast",
        category="Podcasts",
        config={},
    ),
    StarterFeedSpec(
        title="Latent Space",
        url="https://api.substack.com/feed/podcast/1084089.rss",
        site_url="https://www.latent.space",
        view_type="audio",
        feed_kind="podcast",
        category="Podcasts",
        config={},
    ),
)


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS feeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    site_url TEXT,
    view_type TEXT NOT NULL DEFAULT 'article',
    feed_kind TEXT NOT NULL DEFAULT 'rss',
    category TEXT NOT NULL DEFAULT 'General',
    icon_url TEXT,
    last_fetched_at TEXT,
    last_error TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    guid TEXT,
    canonical_url TEXT NOT NULL,
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    author TEXT,
    summary TEXT,
    content_html TEXT,
    extracted_text TEXT,
    ai_summary TEXT,
    ai_model TEXT,
    image_url TEXT,
    audio_url TEXT,
    audio_duration TEXT,
    video_id TEXT,
    hn_item_id TEXT,
    hn_points INTEGER,
    hn_comments_count INTEGER,
    published_at TEXT,
    discovered_at TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    is_starred INTEGER NOT NULL DEFAULT 0,
    playback_seconds REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(feed_id, canonical_url)
);

CREATE INDEX IF NOT EXISTS idx_entries_feed_id ON entries(feed_id);
CREATE INDEX IF NOT EXISTS idx_entries_discovered_at ON entries(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_hn_item_id ON entries(hn_item_id);
CREATE INDEX IF NOT EXISTS idx_entries_canonical_url ON entries(canonical_url);
CREATE INDEX IF NOT EXISTS idx_entries_is_read ON entries(is_read);
CREATE INDEX IF NOT EXISTS idx_entries_is_starred ON entries(is_starred);

CREATE TABLE IF NOT EXISTS filter_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL UNIQUE,
    match_field TEXT NOT NULL DEFAULT 'both',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class Database:
    """Thread-safe SQLite database wrapper supporting file paths and :memory:."""

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._is_memory = db_path == ":memory:"
        self._lock = threading.RLock()
        self._memory_conn: sqlite3.Connection | None = None

        if not self._is_memory and not db_path.startswith("file:"):
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    def _open_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(
            self.db_path,
            check_same_thread=False,
            timeout=30.0,
            uri=self.db_path.startswith("file:"),
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 5000")
        if not self._is_memory:
            conn.execute("PRAGMA journal_mode = WAL")
        return conn

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            if self._is_memory:
                if self._memory_conn is None:
                    self._memory_conn = self._open_connection()
                conn = self._memory_conn
                try:
                    yield conn
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
            else:
                conn = self._open_connection()
                try:
                    yield conn
                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
                finally:
                    conn.close()

    def close(self) -> None:
        with self._lock:
            if self._memory_conn is not None:
                self._memory_conn.close()
                self._memory_conn = None

    def init_db(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA_SQL)

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------
    def get_setting(self, key: str) -> str | None:
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
            return str(row["value"]) if row is not None else None

    def set_setting(self, key: str, value: str) -> None:
        now = utc_now_iso()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (key, value, now),
            )

    # ------------------------------------------------------------------
    # Feeds
    # ------------------------------------------------------------------
    @staticmethod
    def _row_to_feed(row: sqlite3.Row) -> FeedOut:
        return FeedOut(
            id=int(row["id"]),
            title=str(row["title"]),
            url=str(row["url"]),
            site_url=row["site_url"],
            view_type=str(row["view_type"]),
            feed_kind=str(row["feed_kind"]),
            category=str(row["category"]),
            icon_url=row["icon_url"],
            unread_count=(
                int(row["unread_count"]) if "unread_count" in tuple(row.keys()) else 0
            ),
            last_fetched_at=row["last_fetched_at"],
            last_error=row["last_error"],
            enabled=bool(row["enabled"]),
            config_json=str(row["config_json"] or "{}"),
        )

    def list_feeds(self, enabled_only: bool = False) -> list[FeedOut]:
        where = "WHERE f.enabled = 1" if enabled_only else ""
        sql = f"""
            SELECT
                f.*,
                COUNT(e.id) AS unread_count
            FROM feeds f
            LEFT JOIN entries e ON e.feed_id = f.id AND e.is_read = 0
            {where}
            GROUP BY f.id
            ORDER BY f.category ASC, f.title COLLATE NOCASE ASC, f.id ASC
        """
        with self.connect() as conn:
            rows = conn.execute(sql).fetchall()
            return [self._row_to_feed(row) for row in rows]

    def get_feed(self, feed_id: int) -> FeedOut | None:
        sql = """
            SELECT
                f.*,
                COUNT(e.id) AS unread_count
            FROM feeds f
            LEFT JOIN entries e ON e.feed_id = f.id AND e.is_read = 0
            WHERE f.id = ?
            GROUP BY f.id
        """
        with self.connect() as conn:
            row = conn.execute(sql, (feed_id,)).fetchone()
            return self._row_to_feed(row) if row is not None else None

    def get_feed_by_url(self, url: str) -> FeedOut | None:
        sql = """
            SELECT
                f.*,
                COUNT(e.id) AS unread_count
            FROM feeds f
            LEFT JOIN entries e ON e.feed_id = f.id AND e.is_read = 0
            WHERE f.url = ?
            GROUP BY f.id
        """
        with self.connect() as conn:
            row = conn.execute(sql, (url,)).fetchone()
            return self._row_to_feed(row) if row is not None else None

    def feed_count(self) -> int:
        with self.connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS cnt FROM feeds").fetchone()
            return int(row["cnt"]) if row is not None else 0

    def create_feed(
        self,
        *,
        title: str,
        url: str,
        site_url: str | None = None,
        view_type: str = "article",
        feed_kind: str = "rss",
        category: str = "General",
        icon_url: str | None = None,
        enabled: bool = True,
        config: dict[str, Any] | None = None,
    ) -> FeedOut:
        now = utc_now_iso()
        config_str = json.dumps(config or {}, ensure_ascii=False)
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO feeds (
                    title, url, site_url, view_type, feed_kind, category,
                    icon_url, enabled, config_json, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    title,
                    url,
                    site_url,
                    view_type,
                    feed_kind,
                    category,
                    icon_url,
                    1 if enabled else 0,
                    config_str,
                    now,
                ),
            )
            feed_id = int(cursor.lastrowid or 0)
        created = self.get_feed(feed_id)
        if created is None:
            raise RuntimeError("Failed to retrieve newly created feed")
        return created

    def update_feed(
        self,
        feed_id: int,
        *,
        title: str | None = None,
        view_type: str | None = None,
        category: str | None = None,
        enabled: bool | None = None,
        site_url: str | None = None,
        icon_url: str | None = None,
    ) -> FeedOut | None:
        fields: list[str] = []
        values: list[Any] = []
        if title is not None:
            fields.append("title = ?")
            values.append(title)
        if view_type is not None:
            fields.append("view_type = ?")
            values.append(view_type)
        if category is not None:
            fields.append("category = ?")
            values.append(category)
        if enabled is not None:
            fields.append("enabled = ?")
            values.append(1 if enabled else 0)
        if site_url is not None:
            fields.append("site_url = ?")
            values.append(site_url)
        if icon_url is not None:
            fields.append("icon_url = ?")
            values.append(icon_url)

        if not fields:
            return self.get_feed(feed_id)

        values.append(feed_id)
        with self.connect() as conn:
            cursor = conn.execute(
                f"UPDATE feeds SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            if cursor.rowcount == 0:
                return None
        return self.get_feed(feed_id)

    def mark_feed_fetched(
        self,
        feed_id: int,
        *,
        error: str | None = None,
        title: str | None = None,
        site_url: str | None = None,
        icon_url: str | None = None,
    ) -> None:
        now = utc_now_iso()
        fields = ["last_fetched_at = ?", "last_error = ?"]
        values: list[Any] = [now, error]
        if title is not None:
            fields.append("title = ?")
            values.append(title)
        if site_url is not None:
            fields.append("site_url = ?")
            values.append(site_url)
        if icon_url is not None:
            fields.append("icon_url = ?")
            values.append(icon_url)
        values.append(feed_id)
        with self.connect() as conn:
            conn.execute(f"UPDATE feeds SET {', '.join(fields)} WHERE id = ?", values)

    def delete_feed(self, feed_id: int) -> bool:
        with self.connect() as conn:
            cursor = conn.execute("DELETE FROM feeds WHERE id = ?", (feed_id,))
            return cursor.rowcount > 0

    def seed_starter_feeds(self) -> tuple[int, list[FeedOut]]:
        """Idempotently seed all curated starter feeds."""
        added = 0
        now = utc_now_iso()
        with self.connect() as conn:
            for spec in STARTER_FEEDS:
                cursor = conn.execute(
                    """
                    INSERT OR IGNORE INTO feeds (
                        title, url, site_url, view_type, feed_kind, category,
                        icon_url, enabled, config_json, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)
                    """,
                    (
                        spec.title,
                        spec.url,
                        spec.site_url,
                        spec.view_type,
                        spec.feed_kind,
                        spec.category,
                        json.dumps(spec.config, ensure_ascii=False),
                        now,
                    ),
                )
                if cursor.rowcount > 0:
                    added += 1
        self.set_setting("starter_seeded", "1")
        return added, self.list_feeds()

    def seed_starter_on_first_boot(self) -> int:
        """Seed starter feeds automatically on first boot when DB has 0 feeds."""
        if self.feed_count() == 0 and self.get_setting("starter_seeded") != "1":
            added, _ = self.seed_starter_feeds()
            return added
        return 0

    # ------------------------------------------------------------------
    # Entries
    # ------------------------------------------------------------------
    @staticmethod
    def _row_to_entry(row: sqlite3.Row) -> EntryOut:
        return EntryOut(
            id=int(row["id"]),
            feed_id=int(row["feed_id"]),
            feed_title=str(row["feed_title"]),
            view_type=str(row["view_type"]),
            title=str(row["title"]),
            url=str(row["url"]),
            author=row["author"],
            summary=row["summary"],
            content_html=row["content_html"],
            extracted_text=row["extracted_text"],
            ai_summary=row["ai_summary"],
            image_url=row["image_url"],
            audio_url=row["audio_url"],
            audio_duration=row["audio_duration"],
            video_id=row["video_id"],
            hn_item_id=row["hn_item_id"],
            hn_points=int(row["hn_points"]) if row["hn_points"] is not None else None,
            hn_comments_count=(
                int(row["hn_comments_count"]) if row["hn_comments_count"] is not None else None
            ),
            published_at=row["published_at"],
            discovered_at=str(row["discovered_at"]),
            is_read=bool(row["is_read"]),
            is_starred=bool(row["is_starred"]),
            playback_seconds=float(row["playback_seconds"] or 0.0),
        )

    def entry_exists(
        self,
        *,
        feed_id: int,
        canonical_url: str,
        guid: str | None = None,
        normalized_title: str = "",
    ) -> bool:
        """Check for duplicate entry by canonical URL, GUID, or normalized title."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM entries WHERE canonical_url = ? LIMIT 1",
                (canonical_url,),
            ).fetchone()
            if row is not None:
                return True

            if guid:
                row = conn.execute(
                    "SELECT 1 FROM entries WHERE feed_id = ? AND guid = ? LIMIT 1",
                    (feed_id, guid),
                ).fetchone()
                if row is not None:
                    return True

            if normalized_title:
                row = conn.execute(
                    "SELECT 1 FROM entries WHERE feed_id = ? AND normalized_title = ? LIMIT 1",
                    (feed_id, normalized_title),
                ).fetchone()
                if row is not None:
                    return True

        return False

    def insert_entry(
        self,
        *,
        feed_id: int,
        guid: str | None,
        canonical_url: str,
        title: str,
        normalized_title: str,
        url: str,
        author: str | None = None,
        summary: str | None = None,
        content_html: str | None = None,
        image_url: str | None = None,
        audio_url: str | None = None,
        audio_duration: str | None = None,
        video_id: str | None = None,
        hn_item_id: str | None = None,
        hn_points: int | None = None,
        hn_comments_count: int | None = None,
        published_at: str | None = None,
        discovered_at: str | None = None,
    ) -> int | None:
        now = utc_now_iso()
        disc = discovered_at or now
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT OR IGNORE INTO entries (
                    feed_id, guid, canonical_url, title, normalized_title, url,
                    author, summary, content_html, image_url, audio_url, audio_duration,
                    video_id, hn_item_id, hn_points, hn_comments_count,
                    published_at, discovered_at, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    feed_id,
                    guid,
                    canonical_url,
                    title,
                    normalized_title,
                    url,
                    author,
                    summary,
                    content_html,
                    image_url,
                    audio_url,
                    audio_duration,
                    video_id,
                    hn_item_id,
                    hn_points,
                    hn_comments_count,
                    published_at,
                    disc,
                    now,
                ),
            )
            if cursor.rowcount == 0:
                return None
            return int(cursor.lastrowid or 0)

    def upsert_hn_entry(
        self,
        *,
        feed_id: int,
        hn_item_id: str,
        canonical_url: str,
        title: str,
        normalized_title: str,
        url: str,
        author: str | None,
        summary: str | None,
        content_html: str | None,
        hn_points: int,
        hn_comments_count: int,
        published_at: str | None,
        discovered_at: str,
    ) -> bool:
        """Insert a new HN entry (setting discovered_at=NOW) or update points if already tracked.

        Returns True if a brand-new entry was inserted, False if an existing entry was updated.
        """
        with self.connect() as conn:
            existing = conn.execute(
                "SELECT id FROM entries WHERE feed_id = ? AND hn_item_id = ?",
                (feed_id, hn_item_id),
            ).fetchone()
            if existing is not None:
                conn.execute(
                    """
                    UPDATE entries
                    SET hn_points = ?, hn_comments_count = ?, title = ?
                    WHERE id = ?
                    """,
                    (hn_points, hn_comments_count, title, int(existing["id"])),
                )
                return False

            # Also check canonical_url within this feed in case of duplicate submissions
            existing_url = conn.execute(
                "SELECT id FROM entries WHERE feed_id = ? AND canonical_url = ?",
                (feed_id, canonical_url),
            ).fetchone()
            if existing_url is not None:
                conn.execute(
                    """
                    UPDATE entries
                    SET hn_points = ?, hn_comments_count = ?
                    WHERE id = ?
                    """,
                    (hn_points, hn_comments_count, int(existing_url["id"])),
                )
                return False

            now = utc_now_iso()
            conn.execute(
                """
                INSERT INTO entries (
                    feed_id, guid, canonical_url, title, normalized_title, url,
                    author, summary, content_html, hn_item_id, hn_points,
                    hn_comments_count, published_at, discovered_at, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    feed_id,
                    f"hn:{hn_item_id}",
                    canonical_url,
                    title,
                    normalized_title,
                    url,
                    author,
                    summary,
                    content_html,
                    hn_item_id,
                    hn_points,
                    hn_comments_count,
                    published_at,
                    discovered_at,
                    now,
                ),
            )
            return True

    def list_entries(
        self,
        *,
        view_type: str | None = None,
        feed_id: int | None = None,
        starred: bool | None = None,
        unread_only: bool | None = None,
        q: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[EntryOut], int]:
        conditions: list[str] = []
        params: list[Any] = []

        if view_type and view_type != "all":
            conditions.append("f.view_type = ?")
            params.append(view_type)
        if feed_id is not None:
            conditions.append("e.feed_id = ?")
            params.append(feed_id)
        if starred is True:
            conditions.append("e.is_starred = 1")
        if unread_only is True:
            conditions.append("e.is_read = 0")
        if q and q.strip():
            like = f"%{_escape_like(q.strip())}%"
            conditions.append(
                "("
                "e.title LIKE ? ESCAPE '\\' "
                "OR COALESCE(e.summary, '') LIKE ? ESCAPE '\\' "
                "OR COALESCE(e.extracted_text, '') LIKE ? ESCAPE '\\' "
                "OR COALESCE(e.author, '') LIKE ? ESCAPE '\\' "
                "OR f.title LIKE ? ESCAPE '\\'"
                ")"
            )
            params.extend([like, like, like, like, like])

        where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        count_sql = f"""
            SELECT COUNT(*) AS cnt
            FROM entries e
            JOIN feeds f ON f.id = e.feed_id
            {where_sql}
        """
        items_sql = f"""
            SELECT e.*, f.title AS feed_title, f.view_type AS view_type
            FROM entries e
            JOIN feeds f ON f.id = e.feed_id
            {where_sql}
            ORDER BY e.discovered_at DESC, e.id DESC
            LIMIT ? OFFSET ?
        """

        with self.connect() as conn:
            total_row = conn.execute(count_sql, params).fetchone()
            total = int(total_row["cnt"]) if total_row is not None else 0
            rows = conn.execute(items_sql, [*params, limit, offset]).fetchall()
            return [self._row_to_entry(row) for row in rows], total

    def get_entry(self, entry_id: int) -> EntryOut | None:
        sql = """
            SELECT e.*, f.title AS feed_title, f.view_type AS view_type
            FROM entries e
            JOIN feeds f ON f.id = e.feed_id
            WHERE e.id = ?
        """
        with self.connect() as conn:
            row = conn.execute(sql, (entry_id,)).fetchone()
            return self._row_to_entry(row) if row is not None else None

    def get_entry_ai_model(self, entry_id: int) -> str | None:
        with self.connect() as conn:
            row = conn.execute("SELECT ai_model FROM entries WHERE id = ?", (entry_id,)).fetchone()
            if row is None or row["ai_model"] is None:
                return None
            return str(row["ai_model"])

    def update_entry(
        self,
        entry_id: int,
        *,
        is_read: bool | None = None,
        is_starred: bool | None = None,
        playback_seconds: float | None = None,
        extracted_text: str | None = None,
        ai_summary: str | None = None,
        ai_model: str | None = None,
    ) -> EntryOut | None:
        fields: list[str] = []
        values: list[Any] = []
        if is_read is not None:
            fields.append("is_read = ?")
            values.append(1 if is_read else 0)
        if is_starred is not None:
            fields.append("is_starred = ?")
            values.append(1 if is_starred else 0)
        if playback_seconds is not None:
            fields.append("playback_seconds = ?")
            values.append(float(playback_seconds))
        if extracted_text is not None:
            fields.append("extracted_text = ?")
            values.append(extracted_text)
        if ai_summary is not None:
            fields.append("ai_summary = ?")
            values.append(ai_summary)
        if ai_model is not None:
            fields.append("ai_model = ?")
            values.append(ai_model)

        if not fields:
            return self.get_entry(entry_id)

        values.append(entry_id)
        with self.connect() as conn:
            cursor = conn.execute(
                f"UPDATE entries SET {', '.join(fields)} WHERE id = ?",
                values,
            )
            if cursor.rowcount == 0:
                return None
        return self.get_entry(entry_id)

    def mark_all_read(
        self,
        *,
        view_type: str | None = None,
        feed_id: int | None = None,
    ) -> int:
        conditions = ["is_read = 0"]
        params: list[Any] = []
        if feed_id is not None:
            conditions.append("feed_id = ?")
            params.append(feed_id)
        if view_type and view_type != "all":
            conditions.append("feed_id IN (SELECT id FROM feeds WHERE view_type = ?)")
            params.append(view_type)

        sql = f"UPDATE entries SET is_read = 1 WHERE {' AND '.join(conditions)}"
        with self.connect() as conn:
            cursor = conn.execute(sql, params)
            return int(cursor.rowcount)

    def list_entries_for_export(
        self,
        *,
        entry_ids: list[int] | None = None,
        starred_only: bool = False,
        view_type: str | None = None,
        days: int | None = 7,
    ) -> list[EntryOut]:
        conditions: list[str] = []
        params: list[Any] = []

        if entry_ids:
            placeholders = ", ".join("?" for _ in entry_ids)
            conditions.append(f"e.id IN ({placeholders})")
            params.extend(entry_ids)
        else:
            if starred_only:
                conditions.append("e.is_starred = 1")
            if view_type and view_type != "all":
                conditions.append("f.view_type = ?")
                params.append(view_type)
            if days is not None and days > 0:
                cutoff = (datetime.now(UTC) - timedelta(days=days)).isoformat().replace(
                    "+00:00", "Z"
                )
                conditions.append("e.discovered_at >= ?")
                params.append(cutoff)

        where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        sql = f"""
            SELECT e.*, f.title AS feed_title, f.view_type AS view_type
            FROM entries e
            JOIN feeds f ON f.id = e.feed_id
            {where_sql}
            ORDER BY e.discovered_at DESC, e.id DESC
        """
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
            return [self._row_to_entry(row) for row in rows]

    # ------------------------------------------------------------------
    # Filter rules (L1 keyword blacklist)
    # ------------------------------------------------------------------
    @staticmethod
    def _row_to_filter(row: sqlite3.Row) -> FilterRuleOut:
        return FilterRuleOut(
            id=int(row["id"]),
            keyword=str(row["keyword"]),
            match_field=str(row["match_field"]),
            created_at=str(row["created_at"]),
        )

    def list_filter_rules(self) -> list[FilterRuleOut]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM filter_rules ORDER BY created_at DESC, id DESC"
            ).fetchall()
            return [self._row_to_filter(row) for row in rows]

    def create_filter_rule(self, keyword: str, match_field: str = "both") -> FilterRuleOut:
        cleaned = keyword.strip()
        now = utc_now_iso()
        with self.connect() as conn:
            cursor = conn.execute(
                "INSERT INTO filter_rules (keyword, match_field, created_at) VALUES (?, ?, ?)",
                (cleaned, match_field, now),
            )
            rule_id = int(cursor.lastrowid or 0)
            row = conn.execute("SELECT * FROM filter_rules WHERE id = ?", (rule_id,)).fetchone()
        if row is None:
            raise RuntimeError("Failed to retrieve created filter rule")
        return self._row_to_filter(row)

    def delete_filter_rule(self, rule_id: int) -> bool:
        with self.connect() as conn:
            cursor = conn.execute("DELETE FROM filter_rules WHERE id = ?", (rule_id,))
            return cursor.rowcount > 0
