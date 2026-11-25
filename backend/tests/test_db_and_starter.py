"""Tests for SQLite DB layer, starter pack seeding, feed/entry CRUD, and health endpoint."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.db import STARTER_FEEDS
from app.main import create_app


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app) as test_client:
        yield test_client


def test_health_endpoint_reflects_ai_and_nlm_config(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr("app.ai_export.shutil.which", lambda _name: None)

    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {
        "status": "ok",
        "version": "0.1.0",
        "ai_configured": False,
        "nlm_available": False,
    }

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr("app.ai_export.shutil.which", lambda _name: "/usr/local/bin/nlm")
    resp2 = client.get("/api/health")
    assert resp2.status_code == 200
    assert resp2.json()["ai_configured"] is True
    assert resp2.json()["nlm_available"] is True


def test_starter_pack_seeded_on_first_boot_and_idempotent(client: TestClient) -> None:
    resp = client.get("/api/feeds")
    assert resp.status_code == 200
    feeds = resp.json()
    assert len(feeds) == len(STARTER_FEEDS)

    urls = {f["url"] for f in feeds}
    assert "https://feeds.bloomberg.com/markets/news.rss" in urls
    assert "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain" in urls
    assert "algolia://hn?points=100" in urls
    assert any(f["view_type"] == "video" and f["feed_kind"] == "youtube" for f in feeds)
    assert any(f["view_type"] == "audio" and f["feed_kind"] == "podcast" for f in feeds)

    # Calling seed-starter again is idempotent (0 newly added)
    seed_resp = client.post("/api/feeds/seed-starter")
    assert seed_resp.status_code == 200
    seed_data = seed_resp.json()
    assert seed_data["added_feeds"] == 0
    assert len(seed_data["feeds"]) == len(STARTER_FEEDS)

    # Deleting one starter feed and re-seeding restores only the missing feed
    target_id = feeds[0]["id"]
    del_resp = client.delete(f"/api/feeds/{target_id}")
    assert del_resp.status_code == 200
    assert del_resp.json() == {"deleted": True}

    seed_again = client.post("/api/feeds/seed-starter")
    assert seed_again.status_code == 200
    assert seed_again.json()["added_feeds"] == 1
    assert len(seed_again.json()["feeds"]) == len(STARTER_FEEDS)


def test_feed_crud_and_duplicate_conflict(client: TestClient) -> None:
    create_resp = client.post(
        "/api/feeds",
        json={
            "url": "https://example.com/rss.xml",
            "title": "Example News",
            "view_type": "article",
            "category": "Custom",
        },
    )
    assert create_resp.status_code == 200
    feed = create_resp.json()
    assert feed["title"] == "Example News"
    assert feed["category"] == "Custom"
    assert feed["enabled"] is True

    # Duplicate URL returns 409
    dup_resp = client.post("/api/feeds", json={"url": "https://example.com/rss.xml"})
    assert dup_resp.status_code == 409

    # Reject non-http schemes
    bad_scheme = client.post("/api/feeds", json={"url": "file:///etc/passwd"})
    assert bad_scheme.status_code == 400

    # Update feed
    patch_resp = client.patch(
        f"/api/feeds/{feed['id']}",
        json={"title": "Renamed News", "category": "Renamed", "enabled": False},
    )
    assert patch_resp.status_code == 200
    updated = patch_resp.json()
    assert updated["title"] == "Renamed News"
    assert updated["category"] == "Renamed"
    assert updated["enabled"] is False

    # Delete feed
    del_resp = client.delete(f"/api/feeds/{feed['id']}")
    assert del_resp.status_code == 200
    assert del_resp.json() == {"deleted": True}
    assert client.delete(f"/api/feeds/{feed['id']}").status_code == 404


def test_entries_filtering_updates_and_mark_all_read(client: TestClient) -> None:
    db = client.app.state.db  # type: ignore[attr-defined]
    feed_article = db.create_feed(
        title="Custom Tech",
        url="https://tech.example.org/feed.xml",
        view_type="article",
        feed_kind="rss",
        category="Tech",
    )
    feed_audio = db.create_feed(
        title="Custom Pod",
        url="https://pod.example.org/feed.xml",
        view_type="audio",
        feed_kind="podcast",
        category="Podcasts",
    )

    e1 = db.insert_entry(
        feed_id=feed_article.id,
        guid="g1",
        canonical_url="https://tech.example.org/ai-chip",
        title="Next-Gen AI Chip Breakthrough",
        normalized_title="next gen ai chip breakthrough",
        url="https://tech.example.org/ai-chip",
        summary="Deep dive into silicon.",
        published_at="2026-11-20T10:00:00Z",
        discovered_at="2026-11-20T10:00:00Z",
    )
    e2 = db.insert_entry(
        feed_id=feed_audio.id,
        guid="g2",
        canonical_url="https://pod.example.org/ep-1",
        title="Episode 1: Macro Markets",
        normalized_title="episode 1 macro markets",
        url="https://pod.example.org/ep-1",
        audio_url="https://pod.example.org/ep1.mp3",
        audio_duration="45:10",
        published_at="2026-11-21T10:00:00Z",
        discovered_at="2026-11-21T10:00:00Z",
    )
    assert e1 is not None and e2 is not None

    # List all entries ordered by discovered_at DESC
    res = client.get("/api/entries")
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 2
    assert [item["id"] for item in data["items"]] == [e2, e1]

    # Search filter
    q_res = client.get("/api/entries", params={"q": "Breakthrough"})
    assert q_res.json()["total"] == 1
    assert q_res.json()["items"][0]["id"] == e1

    # View filter
    audio_res = client.get("/api/entries", params={"view_type": "audio"})
    assert audio_res.json()["total"] == 1
    assert audio_res.json()["items"][0]["audio_url"] == "https://pod.example.org/ep1.mp3"

    # Patch entry (star, read, playback_seconds)
    patch = client.patch(
        f"/api/entries/{e2}",
        json={"is_starred": True, "playback_seconds": 125.5},
    )
    assert patch.status_code == 200
    assert patch.json()["is_starred"] is True
    assert patch.json()["playback_seconds"] == pytest.approx(125.5)

    starred = client.get("/api/entries", params={"starred": "true"})
    assert starred.json()["total"] == 1
    assert starred.json()["items"][0]["id"] == e2

    # Unread count on feeds reflects unread entries
    feeds = {f["id"]: f for f in client.get("/api/feeds").json()}
    assert feeds[feed_article.id]["unread_count"] == 1
    assert feeds[feed_audio.id]["unread_count"] == 1

    # Mark all read scoped to article view_type
    mar = client.post("/api/entries/mark-all-read", json={"view_type": "article"})
    assert mar.status_code == 200
    assert mar.json() == {"updated": 1}

    unread = client.get("/api/entries", params={"unread_only": "true"})
    assert unread.json()["total"] == 1
    assert unread.json()["items"][0]["id"] == e2
