"""Tests for SSRF image proxy protection, AI summarization, OPML, and Markdown/NotebookLM export."""

from __future__ import annotations

import subprocess
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai_export import NOTEBOOKLM_SAFE_WORD_LIMIT, count_words, summarize_entry
from app.config import Settings
from app.fetchers import ProxyError, fetch_proxied_image
from app.main import create_app


@pytest.fixture
def client() -> Iterator[TestClient]:
    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app) as test_client:
        yield test_client


@pytest.mark.parametrize(
    "blocked_url,expected_status",
    [
        ("http://127.0.0.1:8000/api/health", 403),
        ("http://localhost:8000/api/health", 403),
        ("http://sub.localhost/test.png", 403),
        ("http://169.254.169.254/latest/meta-data/", 403),
        ("http://10.0.0.1/private.png", 403),
        ("http://172.16.0.5/private.png", 403),
        ("http://192.168.1.10/router.png", 403),
        ("http://[::1]:8000/secret.png", 403),
        ("http://[::ffff:127.0.0.1]/secret.png", 403),
        ("http://0.0.0.0/secret.png", 403),
        ("http://metadata.google.internal/computeMetadata/v1/", 403),
        ("file:///etc/passwd", 400),
        ("ftp://example.com/image.png", 400),
        ("http://user:pass@example.com/image.png", 400),
    ],
)
def test_image_proxy_rejects_ssrf_targets(
    client: TestClient,
    blocked_url: str,
    expected_status: int,
) -> None:
    resp = client.get("/api/image-proxy", params={"url": blocked_url})
    assert resp.status_code == expected_status


@pytest.mark.asyncio
async def test_image_proxy_rejects_dns_private_ip_and_private_redirects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # DNS resolves public-looking domain to private RFC1918 IP
    monkeypatch.setattr("app.fetchers.resolve_host_ips", lambda _h, _p: ["10.20.30.40"])
    with pytest.raises(ProxyError) as exc_info:
        await fetch_proxied_image("https://sneaky.example.com/pic.png")
    assert exc_info.value.status_code == 403

    # Redirect from public host to loopback IP MUST be blocked before following
    def resolver(host: str, _port: int) -> list[str]:
        if host == "cdn.example.com":
            return ["93.184.216.34"]
        return ["127.0.0.1"]

    monkeypatch.setattr("app.fetchers.resolve_host_ips", resolver)

    def redirect_handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "cdn.example.com":
            return httpx.Response(
                302,
                headers={"Location": "http://127.0.0.1:8000/api/health"},
            )
        raise AssertionError("Should never follow redirect to loopback IP")

    async with httpx.AsyncClient(transport=httpx.MockTransport(redirect_handler)) as mock_client:
        with pytest.raises(ProxyError) as redir_exc:
            await fetch_proxied_image("https://cdn.example.com/avatar.png", client=mock_client)
        assert redir_exc.value.status_code == 403


@pytest.mark.asyncio
async def test_image_proxy_content_type_size_limit_and_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.fetchers.resolve_host_ips", lambda _h, _p: ["93.184.216.34"])

    # Reject non-image content-type
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _r: httpx.Response(200, headers={"Content-Type": "text/html"}, text="<html/>")
        )
    ) as mock_client:
        with pytest.raises(ProxyError) as ct_exc:
            await fetch_proxied_image("https://cdn.example.com/not-image", client=mock_client)
        assert ct_exc.value.status_code == 400

    # Reject oversized image
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _r: httpx.Response(
                200,
                headers={"Content-Type": "image/png"},
                content=b"x" * 2048,
            )
        )
    ) as mock_client:
        with pytest.raises(ProxyError) as size_exc:
            await fetch_proxied_image(
                "https://cdn.example.com/huge.png",
                client=mock_client,
                max_bytes=1024,
            )
        assert size_exc.value.status_code == 413

    # Valid image returns bytes and content-type
    png_bytes = b"\x89PNG\r\n\x1a\nfake-png"
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _r: httpx.Response(
                200,
                headers={"Content-Type": "image/png; charset=binary"},
                content=png_bytes,
            )
        )
    ) as mock_client:
        data, ct = await fetch_proxied_image("https://cdn.example.com/ok.png", client=mock_client)
    assert data == png_bytes
    assert ct == "image/png"


@pytest.mark.asyncio
async def test_ai_summary_unconfigured_gemini_cache_and_openai(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    db = client.app.state.db  # type: ignore[attr-defined]
    feed = db.create_feed(title="AI Blog", url="https://ai.example.com/rss")
    entry_id = db.insert_entry(
        feed_id=feed.id,
        guid="ai-1",
        canonical_url="https://ai.example.com/post-1",
        title="Transformers in 2026",
        normalized_title="transformers in 2026",
        url="https://ai.example.com/post-1",
        summary="Key scaling results.",
    )
    assert entry_id is not None

    # Unconfigured returns HTTP 400 with setup instructions
    resp = client.post(f"/api/entries/{entry_id}/summarize", json={})
    assert resp.status_code == 400
    assert "GEMINI_API_KEY" in resp.json()["detail"]

    # Gemini call + cache hit
    entry = db.get_entry(entry_id)
    assert entry is not None
    gemini_calls = 0

    def gemini_handler(_r: httpx.Request) -> httpx.Response:
        nonlocal gemini_calls
        gemini_calls += 1
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {"content": {"parts": [{"text": "- **Takeaway**: Faster inference."}]}}
                ]
            },
        )

    gemini_settings = Settings(gemini_api_key="gem-key", gemini_model="gemini-2.5-flash")
    async with httpx.AsyncClient(transport=httpx.MockTransport(gemini_handler)) as mock_client:
        res1 = await summarize_entry(db, entry, gemini_settings, client=mock_client)
        assert res1.cached is False
        assert res1.model == "gemini-2.5-flash"
        assert "Faster inference" in res1.ai_summary
        assert gemini_calls == 1

        # Second call returns cached without hitting provider
        entry_cached = db.get_entry(entry_id)
        assert entry_cached is not None
        res2 = await summarize_entry(db, entry_cached, gemini_settings, client=mock_client)
        assert res2.cached is True
        assert gemini_calls == 1

    # OpenAI fallback with force=True
    def openai_handler(_r: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "OpenAI refreshed summary."}}]},
        )

    openai_settings = Settings(openai_api_key="oa-key", openai_model="gpt-4o-mini")
    entry_for_force = db.get_entry(entry_id)
    assert entry_for_force is not None
    async with httpx.AsyncClient(transport=httpx.MockTransport(openai_handler)) as mock_client:
        res3 = await summarize_entry(
            db, entry_for_force, openai_settings, force=True, client=mock_client
        )
    assert res3.cached is False
    assert res3.model == "gpt-4o-mini"
    assert res3.ai_summary == "OpenAI refreshed summary."


def test_opml_export_and_import_roundtrip(client: TestClient) -> None:
    export_resp = client.get("/api/opml/export")
    assert export_resp.status_code == 200
    assert "application/xml" in export_resp.headers["content-type"]
    opml_xml = export_resp.text
    assert "<opml" in opml_xml
    assert "feeds.bloomberg.com/markets/news.rss" in opml_xml

    # Re-importing into same DB skips duplicates
    dup_import = client.post("/api/opml/import", json={"opml_xml": opml_xml})
    assert dup_import.status_code == 200
    assert dup_import.json()["added"] == 0
    assert dup_import.json()["skipped"] > 0

    # Import new custom OPML feeds
    custom_opml = """<?xml version="1.0" encoding="UTF-8"?>
    <opml version="2.0">
      <head><title>Custom</title></head>
      <body>
        <outline text="Research" title="Research">
          <outline type="rss" text="Distill" title="Distill"
                   xmlUrl="https://distill.pub/rss.xml" htmlUrl="https://distill.pub" />
        </outline>
      </body>
    </opml>
    """
    imp = client.post("/api/opml/import", json={"opml_xml": custom_opml})
    assert imp.status_code == 200
    assert imp.json()["added"] == 1
    assert any(
        f["url"] == "https://distill.pub/rss.xml" and f["category"] == "Research"
        for f in imp.json()["feeds"]
    )

    # Malformed XML returns 400
    bad = client.post("/api/opml/import", json={"opml_xml": "<not-valid"})
    assert bad.status_code == 400


def test_batch_packed_markdown_export_word_count_and_notebooklm_push(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = client.app.state.db  # type: ignore[attr-defined]
    feed = db.create_feed(title="Research Digest", url="https://res.example.com/rss")
    e1 = db.insert_entry(
        feed_id=feed.id,
        guid="exp-1",
        canonical_url="https://res.example.com/1",
        title="Weekly Macro Note",
        normalized_title="weekly macro note",
        url="https://res.example.com/1",
        author="Analyst A",
        summary="Inflation cooled modestly this week.",
        content_html="<p>Inflation cooled modestly this week. 宏观经济综述。</p>",
    )
    assert e1 is not None
    db.update_entry(e1, is_starred=True, ai_summary="- Key point: inflation easing.")

    resp = client.post(
        "/api/export/markdown",
        json={"starred_only": True, "days": 7, "title": "Weekly Research Pack"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["entry_count"] == 1
    assert data["safe_limit"] == NOTEBOOKLM_SAFE_WORD_LIMIT
    assert data["within_limit"] is True
    assert data["word_count"] > 20
    assert data["filename"].endswith("-weekly-research-pack.md")
    assert data["markdown"].startswith("---\n")
    assert "tags:\n  - rss-digest" in data["markdown"]
    assert "### AI Summary" in data["markdown"]
    assert "Analyst A" in data["markdown"]

    # Word counter handles CJK + English and flags >400k limit
    assert count_words("Hello world 测试文本") == 6
    huge_id = db.insert_entry(
        feed_id=feed.id,
        guid="exp-huge",
        canonical_url="https://res.example.com/huge",
        title="Massive Corpus",
        normalized_title="massive corpus",
        url="https://res.example.com/huge",
        content_html="word " * 400_050,
    )
    assert huge_id is not None
    huge_resp = client.post("/api/export/markdown", json={"entry_ids": [huge_id]})
    assert huge_resp.status_code == 200
    assert huge_resp.json()["word_count"] > NOTEBOOKLM_SAFE_WORD_LIMIT
    assert huge_resp.json()["within_limit"] is False

    # NotebookLM push when nlm is unavailable
    monkeypatch.setattr("app.ai_export.shutil.which", lambda _name: None)
    nlm_unavail = client.post(
        "/api/export/notebooklm",
        json={"notebook_id": "nb-123", "starred_only": True},
    )
    assert nlm_unavail.status_code == 200
    assert nlm_unavail.json()["status"] == "unavailable"

    # NotebookLM push when nlm is installed (mocked subprocess)
    monkeypatch.setattr("app.ai_export.shutil.which", lambda _name: "/usr/local/bin/nlm")
    captured_cmd: list[str] = []

    def fake_run(cmd: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[str]:
        captured_cmd.extend(cmd)
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr("app.ai_export.subprocess.run", fake_run)
    nlm_ok = client.post(
        "/api/export/notebooklm",
        json={"notebook_id": "nb-123", "starred_only": True, "title": "Weekly Digest"},
    )
    assert nlm_ok.status_code == 200
    assert nlm_ok.json()["status"] == "pushed"
    assert captured_cmd[:4] == ["/usr/local/bin/nlm", "source", "add", "nb-123"]
    assert "--file" in captured_cmd
