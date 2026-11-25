"""Tests for RSS parsing, L1 filters/dedup, HN Algolia, YouTube UULF, Podcasts, and Trafilatura."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import unquote

import httpx
import pytest
from fastapi.testclient import TestClient

from app.fetchers import (
    canonicalize_url,
    channel_id_to_youtube_feed_url,
    discover_podcasts,
    extract_entry_full_text,
    fetch_hn_algolia_feed,
    fetch_hn_comments,
    fetch_rss_feed,
    format_duration,
    resolve_youtube_feed_url,
)
from app.main import create_app


def _make_mock_client(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


SAMPLE_RSS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Mock Finance Feed</title>
    <link>https://finance.example.com</link>
    <item>
      <title>Fed Holds Rates Steady</title>
      <link>https://finance.example.com/fed-rates?utm_source=twitter&amp;id=42</link>
      <guid>item-1</guid>
      <description><![CDATA[<p>Central bank policy update.</p>]]></description>
      <pubDate>Tue, 24 Nov 2026 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Fed Holds Rates Steady</title>
      <link>https://finance.example.com/fed-rates?id=42&amp;fbclid=abc123</link>
      <guid>item-1-dup</guid>
      <description>Duplicate article with different tracking params.</description>
      <pubDate>Tue, 24 Nov 2026 12:05:00 GMT</pubDate>
    </item>
    <item>
      <title>SPONSORED: Buy Crypto Now!</title>
      <link>https://finance.example.com/promo-crypto</link>
      <guid>item-2</guid>
      <description>Promotional advertisement.</description>
      <pubDate>Tue, 24 Nov 2026 11:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
"""

SAMPLE_PODCAST_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Deep Tech Pod</title>
    <link>https://pod.example.com</link>
    <itunes:image href="https://cdn.example.com/pod-cover.jpg" />
    <item>
      <title>Ep 42: Distributed Systems</title>
      <link>https://pod.example.com/ep42</link>
      <guid>ep-42</guid>
      <enclosure url="https://cdn.example.com/ep42.mp3" length="51200000" type="audio/mpeg" />
      <itunes:duration>3665</itunes:duration>
      <description>00:00 Intro - 15:30 Consensus</description>
      <pubDate>Mon, 23 Nov 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
"""

SAMPLE_YOUTUBE_ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <title>Fireship</title>
  <entry>
    <id>yt:video:dQw4w9WgXcQ</id>
    <yt:videoId>dQw4w9WgXcQ</yt:videoId>
    <title>Rust in 100 Seconds</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"/>
    <author><name>Fireship</name></author>
    <published>2026-11-22T15:00:00+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"/>
      <media:description>A fast overview of Rust.</media:description>
    </media:group>
  </entry>
</feed>
"""


def test_canonicalize_url_strips_tracking_and_normalizes() -> None:
    url1 = "HTTPS://Example.COM:443/news/story/?utm_source=x&id=9&fbclid=123#section"
    url2 = "https://example.com/news/story?id=9&utm_medium=email"
    assert canonicalize_url(url1) == "https://example.com/news/story?id=9"
    assert canonicalize_url(url1) == canonicalize_url(url2)


def test_format_duration() -> None:
    assert format_duration("3665") == "1:01:05"
    assert format_duration("125") == "2:05"
    assert format_duration("01:12:30") == "01:12:30"
    assert format_duration("") is None


@pytest.mark.asyncio
async def test_rss_parsing_l1_keyword_filter_and_dedup() -> None:
    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app) as client:
        db = app.state.db
        feed = db.create_feed(
            title="Mock Finance",
            url="https://finance.example.com/rss.xml",
            view_type="article",
            feed_kind="rss",
        )
        # Add L1 keyword blacklist rule via API
        f_resp = client.post("/api/filters", json={"keyword": "sponsored", "match_field": "title"})
        assert f_resp.status_code == 200
        rule_id = f_resp.json()["id"]

        def handler(_req: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text=SAMPLE_RSS_XML)

        async with _make_mock_client(handler) as mock_client:
            added, filtered = await fetch_rss_feed(db, feed, client=mock_client)

        assert added == 1  # 2nd item deduped by canonical URL, 3rd filtered by "sponsored"
        assert filtered == 1

        entries, total = db.list_entries(feed_id=feed.id)
        assert total == 1
        assert entries[0].title == "Fed Holds Rates Steady"

        # Re-fetching the same feed adds 0 new entries and still counts 1 filtered
        async with _make_mock_client(handler) as mock_client:
            added2, filtered2 = await fetch_rss_feed(db, feed, client=mock_client)
        assert added2 == 0
        assert filtered2 == 1

        # Filter deletion works
        assert client.delete(f"/api/filters/{rule_id}").status_code == 200
        assert client.get("/api/filters").json() == []


@pytest.mark.asyncio
async def test_hn_algolia_threshold_discovery_timestamp_and_comments() -> None:
    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app):
        db = app.state.db
        feed = db.get_feed_by_url("algolia://hn?points=100")
        assert feed is not None
        old_published = (datetime.now(UTC) - timedelta(hours=21)).isoformat().replace(
            "+00:00", "Z"
        )
        captured_urls: list[str] = []
        points_value = 142

        def hn_handler(request: httpx.Request) -> httpx.Response:
            captured_urls.append(str(request.url))
            if "search_by_date" in str(request.url):
                return httpx.Response(
                    200,
                    json={
                        "hits": [
                            {
                                "objectID": "420001",
                                "title": "Show HN: Fast SQLite RSS Engine",
                                "url": "https://example.org/sqlite-rss",
                                "author": "pg",
                                "points": points_value,
                                "num_comments": 55,
                                "created_at": old_published,
                            }
                        ]
                    },
                )
            return httpx.Response(
                200,
                json={
                    "id": 420001,
                    "children": [
                        {
                            "id": 420010,
                            "author": "alice",
                            "text": "<p>Great architecture!</p>",
                            "created_at": "2026-11-24T10:00:00Z",
                            "children": [
                                {
                                    "id": 420011,
                                    "author": "bob",
                                    "text": "<p>Agreed, SQLite WAL is rock solid.</p>",
                                    "created_at": "2026-11-24T10:05:00Z",
                                    "children": [],
                                }
                            ],
                        },
                        {"id": 420012, "author": None, "text": None, "children": []},
                    ],
                },
            )

        async with _make_mock_client(hn_handler) as mock_client:
            added, filtered = await fetch_hn_algolia_feed(db, feed, client=mock_client)

        assert added == 1
        assert filtered == 0
        assert "numericFilters=points>=100" in unquote(captured_urls[0])

        entries, total = db.list_entries(feed_id=feed.id)
        assert total == 1
        entry = entries[0]
        assert entry.hn_item_id == "420001"
        assert entry.hn_points == 142
        assert entry.hn_comments_count == 55
        assert entry.published_at == old_published
        # Key anti-burial guarantee: discovered_at is NOW, much newer than 21h-old published_at!
        assert entry.discovered_at > old_published
        original_discovered_at = entry.discovered_at

        # Re-fetch updates points without overwriting discovered_at or duplicating entry
        points_value = 310
        async with _make_mock_client(hn_handler) as mock_client:
            added2, _ = await fetch_hn_algolia_feed(db, feed, client=mock_client)
        assert added2 == 0
        refreshed = db.get_entry(entry.id)
        assert refreshed is not None
        assert refreshed.hn_points == 310
        assert refreshed.discovered_at == original_discovered_at

        # Nested comments fetch
        async with _make_mock_client(hn_handler) as mock_client:
            comments = await fetch_hn_comments("420001", client=mock_client)
        assert len(comments) == 1
        assert comments[0].author == "alice"
        assert len(comments[0].children) == 1
        assert comments[0].children[0].author == "bob"


@pytest.mark.asyncio
async def test_youtube_handle_resolution_uulf_shorts_filter_and_atom_parsing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.fetchers.resolve_host_ips", lambda _h, _p: ["142.250.190.46"])
    channel_id = "UCsBjURrPoezykLs9EqgamOA"
    assert (
        channel_id_to_youtube_feed_url(channel_id, exclude_shorts=True)
        == "https://www.youtube.com/feeds/videos.xml?playlist_id=UULFsBjURrPoezykLs9EqgamOA"
    )
    assert (
        channel_id_to_youtube_feed_url(channel_id, exclude_shorts=False)
        == "https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA"
    )

    fake_yt_html = (
        '<html><head><meta property="og:title" content="Fireship"></head>'
        f'<body><script>var x = {{"channelId":"{channel_id}"}};</script></body></html>'
    )

    def yt_handler(_req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=fake_yt_html)

    async with _make_mock_client(yt_handler) as mock_client:
        resolved = await resolve_youtube_feed_url(
            "https://www.youtube.com/@Fireship",
            exclude_shorts=True,
            client=mock_client,
        )
    assert resolved.channel_id == channel_id
    assert resolved.title == "Fireship"
    assert resolved.feed_url == (
        "https://www.youtube.com/feeds/videos.xml?playlist_id=UULFsBjURrPoezykLs9EqgamOA"
    )

    # Also test YouTube Atom feed parsing extracts video_id & thumbnail
    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app):
        db = app.state.db
        yt_feed = db.get_feed_by_url(resolved.feed_url)
        assert yt_feed is not None
        async with _make_mock_client(
            lambda _r: httpx.Response(200, text=SAMPLE_YOUTUBE_ATOM)
        ) as mock_client:
            added, _ = await fetch_rss_feed(db, yt_feed, client=mock_client)
        assert added == 1
        items, _ = db.list_entries(feed_id=yt_feed.id)
        assert items[0].video_id == "dQw4w9WgXcQ"
        assert items[0].image_url == "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"


@pytest.mark.asyncio
async def test_podcast_enclosure_parsing_and_itunes_discovery() -> None:
    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app):
        db = app.state.db
        pod_feed = db.create_feed(
            title="Deep Tech Pod",
            url="https://pod.example.com/rss.xml",
            view_type="audio",
            feed_kind="podcast",
        )
        async with _make_mock_client(
            lambda _r: httpx.Response(200, text=SAMPLE_PODCAST_RSS)
        ) as mock_client:
            added, _ = await fetch_rss_feed(db, pod_feed, client=mock_client)

        assert added == 1
        items, _ = db.list_entries(feed_id=pod_feed.id)
        assert items[0].audio_url == "https://cdn.example.com/ep42.mp3"
        assert items[0].audio_duration == "1:01:05"

    # iTunes Search discovery proxy
    itunes_payload = {
        "resultCount": 2,
        "results": [
            {
                "collectionName": "Acquired",
                "artistName": "Ben Gilbert and David Rosenthal",
                "feedUrl": "https://feeds.transistor.fm/acquired",
                "artworkUrl600": "https://cdn.example.com/acquired.jpg",
                "primaryGenreName": "Business",
            },
            {
                "collectionName": "No Feed URL Entry",
                "artistName": "Ignored",
            },
        ],
    }
    async with _make_mock_client(
        lambda _r: httpx.Response(200, json=itunes_payload)
    ) as mock_client:
        results = await discover_podcasts("acquired", client=mock_client)
    assert len(results) == 1
    assert results[0].title == "Acquired"
    assert results[0].feed_url == "https://feeds.transistor.fm/acquired"
    assert results[0].genre == "Business"


@pytest.mark.asyncio
async def test_full_text_extraction_success_and_paywall_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.fetchers.resolve_host_ips", lambda _h, _p: ["93.184.216.34"])

    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app):
        db = app.state.db
        feed = db.create_feed(title="News", url="https://news.example.com/rss")
        entry_id = db.insert_entry(
            feed_id=feed.id,
            guid="e-ext",
            canonical_url="https://news.example.com/article-1",
            title="Article One",
            normalized_title="article one",
            url="https://news.example.com/article-1",
            summary="Fallback RSS summary text.",
            content_html="<p>Fallback RSS summary text.</p>",
        )
        assert entry_id is not None
        entry = db.get_entry(entry_id)
        assert entry is not None

        # 1) Paywalled 403 -> graceful fallback preserving RSS summary
        async with _make_mock_client(
            lambda _r: httpx.Response(403, text="Paywall")
        ) as mock_client:
            fallback_entry = await extract_entry_full_text(db, entry, client=mock_client)
        assert fallback_entry.extracted_text is not None
        assert "HTTP 403" in fallback_entry.extracted_text
        assert "Fallback RSS summary text." in fallback_entry.extracted_text

        # 2) Successful extraction via trafilatura
        article_html = (
            "<html><body><article><h1>Article One</h1>"
            "<p>This is a full-length extracted paragraph with rich analytical detail "
            "about semiconductor supply chains and global capital expenditure trends.</p>"
            "</article></body></html>"
        )
        async with _make_mock_client(
            lambda _r: httpx.Response(200, text=article_html)
        ) as mock_client:
            extracted_entry = await extract_entry_full_text(db, entry, client=mock_client)
        assert extracted_entry.extracted_text is not None
        assert "semiconductor supply chains" in extracted_entry.extracted_text


def test_api_endpoints_youtube_create_refresh_comments_and_discover(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.fetchers import YouTubeResolved
    from app.models import HNComment, PodcastSearchResult

    async def fake_resolve_yt(
        _url: str,
        *,
        exclude_shorts: bool = False,
        client: Any = None,
    ) -> YouTubeResolved:
        _ = client
        return YouTubeResolved(
            feed_url="https://www.youtube.com/feeds/videos.xml?playlist_id=UULF1234567890123456789012",
            site_url="https://www.youtube.com/@CustomDev",
            title="CustomDev",
            channel_id="UC1234567890123456789012",
            exclude_shorts=exclude_shorts,
        )

    async def fake_refresh(
        _db: Any,
        feed: Any,
        *,
        client: Any = None,
    ) -> tuple[int, int, str | None]:
        _ = client
        if feed.feed_kind == "youtube":
            return 3, 1, None
        return 0, 0, None

    async def fake_comments(_hn_id: str, *, client: Any = None) -> list[HNComment]:
        _ = client
        return [HNComment(id="10", author="alice", text="Insightful", children=[])]

    async def fake_discover(_q: str, *, client: Any = None) -> list[PodcastSearchResult]:
        _ = client
        return [
            PodcastSearchResult(
                title="Latent Space",
                author="swyx",
                feed_url="https://api.substack.com/feed/podcast/1084089.rss",
                artwork_url="https://cdn.example.com/ls.jpg",
                genre="Technology",
            )
        ]

    monkeypatch.setattr("app.main.resolve_youtube_feed_url", fake_resolve_yt)
    monkeypatch.setattr("app.main.refresh_feed", fake_refresh)
    monkeypatch.setattr("app.main.fetch_hn_comments", fake_comments)
    monkeypatch.setattr("app.main.discover_podcasts", fake_discover)

    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app) as client:
        yt_resp = client.post(
            "/api/feeds",
            json={"url": "https://www.youtube.com/@CustomDev", "exclude_shorts": True},
        )
        assert yt_resp.status_code == 200
        yt_feed = yt_resp.json()
        assert yt_feed["feed_kind"] == "youtube"
        assert yt_feed["view_type"] == "video"
        assert "playlist_id=UULF" in yt_feed["url"]

        ref_resp = client.post(f"/api/feeds/{yt_feed['id']}/refresh")
        assert ref_resp.status_code == 200
        assert ref_resp.json() == {"added": 3, "filtered": 1, "error": None}

        all_resp = client.post("/api/feeds/refresh-all")
        assert all_resp.status_code == 200
        assert all_resp.json()["feeds_refreshed"] >= 1
        assert all_resp.json()["total_added"] >= 3

        # HN comments endpoint
        db = app.state.db
        hn_feed = db.get_feed_by_url("algolia://hn?points=100")
        assert hn_feed is not None
        eid = db.insert_entry(
            feed_id=hn_feed.id,
            guid="hn:999",
            canonical_url="https://example.org/hn-story",
            title="HN Story",
            normalized_title="hn story",
            url="https://example.org/hn-story",
            hn_item_id="999",
            hn_points=200,
            hn_comments_count=40,
        )
        assert eid is not None
        comm_resp = client.get(f"/api/entries/{eid}/hn-comments")
        assert comm_resp.status_code == 200
        assert comm_resp.json()["comments"][0]["author"] == "alice"

        # Podcast discovery endpoint
        disc_resp = client.get("/api/discover/podcasts", params={"q": "latent"})
        assert disc_resp.status_code == 200
        assert disc_resp.json()["results"][0]["title"] == "Latent Space"


@pytest.mark.asyncio
async def test_youtube_resolver_blocks_ssrf_and_off_youtube_redirects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 1) API rejects localhost/internal URL even when feed_kind="youtube" is explicitly passed
    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app) as client:
        resp = client.post(
            "/api/feeds",
            json={"url": "http://127.0.0.1:8000/api/health", "feed_kind": "youtube"},
        )
        assert resp.status_code == 400
        assert "youtube" in resp.json()["detail"].lower()

    # 2) Direct resolver rejects non-YouTube host
    with pytest.raises(ValueError, match="youtube"):
        await resolve_youtube_feed_url("https://evil.example.com/@channel")

    # 3) Direct resolver blocks redirect from YouTube to loopback IP or off-YouTube domain
    monkeypatch.setattr("app.fetchers.resolve_host_ips", lambda _h, _p: ["142.250.190.46"])

    def private_redirect_handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "www.youtube.com":
            return httpx.Response(
                302,
                headers={"Location": "http://127.0.0.1:8000/api/health"},
            )
        raise AssertionError("Should never follow redirect to loopback IP")

    async with _make_mock_client(private_redirect_handler) as mock_client:
        with pytest.raises(ValueError, match="non-YouTube"):
            await resolve_youtube_feed_url(
                "https://www.youtube.com/@redirected",
                client=mock_client,
            )

    def offsite_redirect_handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "www.youtube.com":
            return httpx.Response(
                302,
                headers={"Location": "https://attacker.example.com/phish"},
            )
        raise AssertionError("Should never follow redirect off YouTube")

    async with _make_mock_client(offsite_redirect_handler) as mock_client:
        with pytest.raises(ValueError, match="non-YouTube"):
            await resolve_youtube_feed_url(
                "https://www.youtube.com/@offsite",
                client=mock_client,
            )

    # 4) DNS resolving youtube.com to private IP is also blocked
    monkeypatch.setattr("app.fetchers.resolve_host_ips", lambda _h, _p: ["127.0.0.1"])
    async with _make_mock_client(
        lambda _r: (_ for _ in ()).throw(AssertionError("Must not connect to private IP"))
    ) as mock_client:
        with pytest.raises(ValueError, match="unsafe"):
            await resolve_youtube_feed_url(
                "https://www.youtube.com/@rebind",
                client=mock_client,
            )


@pytest.mark.asyncio
async def test_rss_and_hn_parsers_reject_non_http_schemes() -> None:
    malicious_rss = """<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
      <channel>
        <title>Untrusted Feed</title>
        <link>javascript:alert(0)</link>
        <image><url>javascript:alert('icon')</url></image>
        <item>
          <title>XSS Link Entry</title>
          <link>javascript:alert(1)</link>
          <guid>xss-1</guid>
          <description>Bad link scheme</description>
        </item>
        <item>
          <title>Data Link Entry</title>
          <link>data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;</link>
          <guid>xss-2</guid>
          <description>Bad data scheme</description>
        </item>
        <item>
          <title>Safe Link With Malicious Media</title>
          <link>https://safe.example.com/article-ok</link>
          <guid>ok-1</guid>
          <enclosure url="javascript:alert('audio')" type="audio/mpeg" length="10" />
          <media:thumbnail url="javascript:alert('thumb')" />
          <description><![CDATA[
            <p>Body</p><img src="data:image/svg+xml;base64,PHN2Zz4="/>
          ]]></description>
        </item>
      </channel>
    </rss>
    """

    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app):
        db = app.state.db
        feed = db.create_feed(
            title="Untrusted",
            url="https://untrusted.example.com/rss.xml",
            view_type="article",
            feed_kind="rss",
        )
        async with _make_mock_client(
            lambda _r: httpx.Response(200, text=malicious_rss)
        ) as mock_client:
            added, _ = await fetch_rss_feed(db, feed, client=mock_client)

        assert added == 1
        entries, total = db.list_entries(feed_id=feed.id)
        assert total == 1
        assert entries[0].url == "https://safe.example.com/article-ok"
        assert entries[0].audio_url is None
        assert entries[0].image_url is None

        updated_feed = db.get_feed(feed.id)
        assert updated_feed is not None
        assert updated_feed.site_url is None
        assert updated_feed.icon_url is None

        # HN Algolia rejects javascript: URL and falls back to HN item URL
        hn_feed = db.get_feed_by_url("algolia://hn?points=100")
        assert hn_feed is not None
        async with _make_mock_client(
            lambda _r: httpx.Response(
                200,
                json={
                    "hits": [
                        {
                            "objectID": "777777",
                            "title": "Malicious HN URL",
                            "url": "javascript:alert(1)",
                            "author": "mallory",
                            "points": 150,
                            "num_comments": 10,
                            "created_at": "2026-11-24T10:00:00Z",
                        }
                    ]
                },
            )
        ) as mock_client:
            hn_added, _ = await fetch_hn_algolia_feed(db, hn_feed, client=mock_client)
        assert hn_added == 1
        hn_entries, _ = db.list_entries(feed_id=hn_feed.id)
        assert hn_entries[0].url == "https://news.ycombinator.com/item?id=777777"

