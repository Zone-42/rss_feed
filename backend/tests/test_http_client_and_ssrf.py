"""Tests for HTTP client proxy configuration, UA fallback retry, and SSRF/Fake-IP hardening."""

from __future__ import annotations

import socket
import ssl
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.ai_export import summarize_entry
from app.config import APP_VERSION, Settings
from app.fetchers import (
    ProxyError,
    _is_ip_blocked,
    _is_system_fake_ip_dns_active,
    extract_entry_full_text,
    fetch_proxied_image,
    fetch_rss_feed,
    reset_dns_canary_caches,
    validate_public_http_url,
)
from app.http_client import (
    AI_HTTP_TIMEOUT,
    BROWSER_USER_AGENT,
    FALLBACK_FEED_USER_AGENT,
    FEED_HEADERS,
    create_async_client,
    has_active_proxy_for_url,
    managed_async_client,
)
from app.main import _refresh_all_feeds_concurrently, create_app

MINIMAL_RSS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Reuters via Google News</title>
    <link>https://news.google.com</link>
    <item>
      <title>Global Markets Update</title>
      <link>https://reuters.com/markets/update-1</link>
      <guid>reuters-1</guid>
      <description>Equities rose slightly.</description>
    </item>
  </channel>
</rss>
"""


# ---------------------------------------------------------------------------
# Config & Settings Tests
# ---------------------------------------------------------------------------


def test_settings_proxy_url_normalization_and_validation() -> None:
    assert APP_VERSION == "0.3.1"

    assert Settings(rss_proxy_url=None).resolved_proxy_url() is None
    assert Settings(rss_proxy_url="").resolved_proxy_url() is None
    assert Settings(rss_proxy_url="   ").resolved_proxy_url() is None

    assert Settings(rss_proxy_url="direct").resolved_proxy_url() == "direct"
    assert Settings(rss_proxy_url="  DIRECT  ").resolved_proxy_url() == "direct"
    assert Settings(rss_proxy_url="None").resolved_proxy_url() == "direct"

    assert (
        Settings(rss_proxy_url="  http://127.0.0.1:6152  ").resolved_proxy_url()
        == "http://127.0.0.1:6152"
    )
    assert (
        Settings(rss_proxy_url="https://proxy.example.com:8443").resolved_proxy_url()
        == "https://proxy.example.com:8443"
    )
    assert (
        Settings(rss_proxy_url="socks5://127.0.0.1:6153").resolved_proxy_url()
        == "socks5://127.0.0.1:6153"
    )
    assert (
        Settings(rss_proxy_url="socks5h://user:pass@127.0.0.1:1080").resolved_proxy_url()
        == "socks5h://user:pass@127.0.0.1:1080"
    )

    for bad_proxy in (
        "socks4://127.0.0.1:1080",
        "ftp://127.0.0.1:21",
        "127.0.0.1:6152",
        "socks5://",
    ):
        with pytest.raises(ValueError, match="RSS_PROXY_URL"):
            Settings(rss_proxy_url=bad_proxy).resolved_proxy_url()


def test_settings_fake_ip_policy_validation() -> None:
    assert Settings().rss_allow_fake_ip_dns == "auto"
    assert Settings(rss_allow_fake_ip_dns="always").rss_allow_fake_ip_dns == "always"
    assert Settings(rss_allow_fake_ip_dns="never").rss_allow_fake_ip_dns == "never"
    assert Settings(rss_allow_fake_ip_dns="  NEVER ").rss_allow_fake_ip_dns == "never"  # type: ignore[arg-type]

    with pytest.raises(ValidationError):
        Settings(rss_allow_fake_ip_dns="sometimes")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Centralized AsyncClient Factory & Proxy Detection Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_async_client_honors_env_socks5_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("all_proxy", "socks5://127.0.0.1:6153")

    async with create_async_client(follow_redirects=True) as client:
        ext_transport = client._transport_for_url(httpx.URL("https://feeds.bloomberg.com/news.rss"))
        assert ext_transport is not client._transport
        assert client.follow_redirects is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "explicit_proxy",
    [
        "http://127.0.0.1:6152",
        "socks5://127.0.0.1:6153",
    ],
)
async def test_create_async_client_explicit_proxy_bypasses_localhost(
    monkeypatch: pytest.MonkeyPatch,
    explicit_proxy: str,
) -> None:
    monkeypatch.setenv("RSS_PROXY_URL", explicit_proxy)
    monkeypatch.setenv("all_proxy", "socks5://127.0.0.1:9999")

    async with create_async_client() as client:
        ext_transport = client._transport_for_url(httpx.URL("https://example.com/feed.xml"))
        assert ext_transport is not client._transport

        for local_url in (
            "http://localhost:1200/twitter/user/test",
            "http://127.0.0.1:11434/v1/chat/completions",
            "http://[::1]:1200/rsshub",
        ):
            local_transport = client._transport_for_url(httpx.URL(local_url))
            assert local_transport is client._transport


@pytest.mark.asyncio
async def test_create_async_client_direct_mode_ignores_env_proxies_and_preserves_ssl_cert(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("all_proxy", "socks5://127.0.0.1:6153")
    monkeypatch.setenv("RSS_PROXY_URL", "direct")

    ssl_calls: list[bool] = []
    real_create_ssl = httpx.create_ssl_context

    def spy_create_ssl(
        verify: ssl.SSLContext | str | bool = True,
        cert: Any = None,
        trust_env: bool = True,
    ) -> ssl.SSLContext:
        ssl_calls.append(trust_env)
        return real_create_ssl(verify=verify, cert=cert, trust_env=trust_env)

    monkeypatch.setattr("app.http_client.httpx.create_ssl_context", spy_create_ssl)

    # Set a real readable cert bundle (certifi's bundle copied to tmp_path) in SSL_CERT_FILE
    import certifi

    custom_ca = tmp_path / "custom-ca.pem"
    custom_ca.write_text(Path(certifi.where()).read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.setenv("SSL_CERT_FILE", str(custom_ca))

    async with create_async_client() as client:
        ext_transport = client._transport_for_url(httpx.URL("https://example.com/feed.xml"))
        assert ext_transport is client._transport
        assert client._trust_env is False
        assert ssl_calls == [True]


def test_create_async_client_rejects_invalid_proxy_scheme(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RSS_PROXY_URL", "socks4://127.0.0.1:1080")
    with pytest.raises(ValueError, match="Unsupported RSS_PROXY_URL scheme"):
        create_async_client()

    with pytest.raises(ValueError, match="Unsupported RSS_PROXY_URL scheme"):
        create_async_client(proxy_url="socks4://127.0.0.1:1080")


def test_has_active_proxy_for_url_respects_direct_localhost_and_no_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert has_active_proxy_for_url("https://example.com/feed.xml") is False

    monkeypatch.setenv("all_proxy", "socks5://127.0.0.1:6153")
    assert has_active_proxy_for_url("https://example.com/feed.xml") is True

    monkeypatch.setenv("no_proxy", "localhost,127.0.0.1,::1,*.local,example.com")
    assert has_active_proxy_for_url("https://example.com/feed.xml") is False
    assert has_active_proxy_for_url("https://sub.example.com/feed.xml") is False
    assert has_active_proxy_for_url("https://other.org/feed.xml") is True

    monkeypatch.setenv("no_proxy", "*")
    assert has_active_proxy_for_url("https://other.org/feed.xml") is False

    monkeypatch.delenv("no_proxy", raising=False)
    monkeypatch.setenv("RSS_PROXY_URL", "direct")
    assert has_active_proxy_for_url("https://other.org/feed.xml") is False

    monkeypatch.setenv("RSS_PROXY_URL", "http://127.0.0.1:6152")
    assert has_active_proxy_for_url("https://other.org/feed.xml") is True
    assert has_active_proxy_for_url("http://localhost:1200/rss") is False
    assert has_active_proxy_for_url("http://127.0.0.1:11434/v1") is False
    assert has_active_proxy_for_url("http://[::1]:1200/rss") is False


@pytest.mark.asyncio
async def test_managed_async_client_reuses_injected_and_closes_owned() -> None:
    injected = httpx.AsyncClient(transport=httpx.MockTransport(lambda _r: httpx.Response(200)))
    async with managed_async_client(injected) as yielded:
        assert yielded is injected
    assert not injected.is_closed
    await injected.aclose()

    async with managed_async_client(None) as owned:
        assert not owned.is_closed
    assert owned.is_closed


# ---------------------------------------------------------------------------
# Feed Fetcher UA Headers, 429/403/406 Fallback Retry & Pooled Refresh Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("retry_status", [403, 406, 429])
async def test_fetch_rss_feed_sends_browser_headers_and_retries_with_fallback_ua(
    retry_status: int,
) -> None:
    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app):
        db = app.state.db
        feed = db.create_feed(
            title="Reuters",
            url="https://news.google.com/rss/search?q=site:reuters.com",
            view_type="article",
            feed_kind="rss",
        )

        seen_headers: list[dict[str, str]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen_headers.append(dict(request.headers))
            if len(seen_headers) == 1:
                return httpx.Response(retry_status, text="Rate limited / blocked")
            return httpx.Response(200, text=MINIMAL_RSS_XML)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as mock_client:
            added, filtered = await fetch_rss_feed(db, feed, client=mock_client)

        assert added == 1
        assert filtered == 0
        assert len(seen_headers) == 2
        assert seen_headers[0]["user-agent"] == BROWSER_USER_AGENT
        assert seen_headers[0]["accept"] == FEED_HEADERS["Accept"]
        assert seen_headers[0]["accept-language"] == FEED_HEADERS["Accept-Language"]
        assert seen_headers[1]["user-agent"] == FALLBACK_FEED_USER_AGENT
        assert seen_headers[1]["accept"] == FEED_HEADERS["Accept"]


@pytest.mark.asyncio
async def test_fetch_rss_feed_raises_after_single_fallback_retry_and_no_retry_on_500() -> None:
    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app):
        db = app.state.db
        feed = db.create_feed(title="Failing Feed", url="https://broken.example.com/rss.xml")

        # Persistent 429 retries exactly once (2 attempts total) then raises
        attempts_429 = 0

        def always_429(_req: httpx.Request) -> httpx.Response:
            nonlocal attempts_429
            attempts_429 += 1
            return httpx.Response(429, text="Too Many Requests")

        async with httpx.AsyncClient(transport=httpx.MockTransport(always_429)) as mock_client:
            with pytest.raises(httpx.HTTPStatusError):
                await fetch_rss_feed(db, feed, client=mock_client)
        assert attempts_429 == 2

        # 500 error does NOT trigger UA fallback retry (1 attempt total)
        attempts_500 = 0

        def always_500(_req: httpx.Request) -> httpx.Response:
            nonlocal attempts_500
            attempts_500 += 1
            return httpx.Response(500, text="Internal Server Error")

        async with httpx.AsyncClient(transport=httpx.MockTransport(always_500)) as mock_client:
            with pytest.raises(httpx.HTTPStatusError):
                await fetch_rss_feed(db, feed, client=mock_client)
        assert attempts_500 == 1


@pytest.mark.asyncio
async def test_refresh_all_feeds_shares_single_pooled_async_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app):
        db = app.state.db
        seen_clients: list[httpx.AsyncClient] = []

        async def fake_refresh(
            _db: Any,
            _feed: Any,
            *,
            client: httpx.AsyncClient | None = None,
        ) -> tuple[int, int, str | None]:
            assert client is not None
            seen_clients.append(client)
            return 1, 0, None

        monkeypatch.setattr("app.main.refresh_feed", fake_refresh)
        res = await _refresh_all_feeds_concurrently(db)

        assert res.feeds_refreshed == len(seen_clients)
        assert res.feeds_refreshed > 1
        assert len({id(c) for c in seen_clients}) == 1
        assert seen_clients[0].is_closed is True


@pytest.mark.asyncio
async def test_ai_export_passes_settings_and_ai_timeout_to_http_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app):
        db = app.state.db
        feed = db.create_feed(title="AI", url="https://ai.example.org/rss")
        entry_id = db.insert_entry(
            feed_id=feed.id,
            guid="ai-proxy-1",
            canonical_url="https://ai.example.org/post",
            title="AI Post",
            normalized_title="ai post",
            url="https://ai.example.org/post",
            summary="Summary body",
        )
        assert entry_id is not None
        entry = db.get_entry(entry_id)
        assert entry is not None

        captured_kwargs: list[dict[str, Any]] = []

        def fake_create_client(**kwargs: Any) -> httpx.AsyncClient:
            captured_kwargs.append(kwargs)
            return httpx.AsyncClient(
                transport=httpx.MockTransport(
                    lambda _r: httpx.Response(
                        200,
                        json={
                            "candidates": [
                                {"content": {"parts": [{"text": "Concise summary"}]}}
                            ]
                        },
                    )
                )
            )

        monkeypatch.setattr("app.http_client.create_async_client", fake_create_client)
        custom_settings = Settings(
            gemini_api_key="test-key",
            rss_proxy_url="http://127.0.0.1:6152",
        )
        res = await summarize_entry(db, entry, custom_settings)
        assert res.ai_summary == "Concise summary"
        assert len(captured_kwargs) == 1
        assert captured_kwargs[0]["settings"] is custom_settings
        assert captured_kwargs[0]["timeout"] == AI_HTTP_TIMEOUT


# ---------------------------------------------------------------------------
# SSRF Hardening & Gated Fake-IP DNS Tests
# ---------------------------------------------------------------------------


def test_is_ip_blocked_remains_strict_for_fake_ip_ranges() -> None:
    for blocked in (
        "127.0.0.1",
        "10.0.0.1",
        "169.254.169.254",
        "198.18.0.1",
        "198.19.255.254",
        "::1",
        "::ffff:127.0.0.1",
        "::ffff:198.18.0.1",
        "fc00::1",
        "fd00::1",
    ):
        assert _is_ip_blocked(blocked) is True

    assert _is_ip_blocked("93.184.216.34") is False
    assert _is_ip_blocked("1.1.1.1") is False


@pytest.mark.parametrize(
    "blocked_url",
    [
        # Literal RFC 2544 Fake-IPs (canonical, short, integer, IPv4-mapped IPv6)
        "http://198.18.0.1/test.png",
        "https://198.19.255.254/test.png",
        "http://198.18.1/test.png",
        "http://3323068417/test.png",
        "http://[::ffff:198.18.0.1]/test.png",
        "http://[fc00::1]/test.png",
        # Obfuscated IPv4 literals (short, decimal, hex, octal, zero, non-canonical public)
        "http://127.1/test.png",
        "http://2130706433/test.png",
        "http://0x7f000001/test.png",
        "http://0177.0.0.1/test.png",
        "http://0/test.png",
        "http://16843009/test.png",
        # IDNA-obfuscated loopback / Fake-IP
        "http://127。0。0。1/test.png",
        "http://198。18。0。1/test.png",
        # Expanded internal hostnames & single-label hosts
        "http://router/pic.png",
        "http://instance-data/latest/meta-data/",
        "http://host.docker.internal:8000/api/health",
        "http://gateway.docker.internal/secret",
        # Internal domain suffixes
        "http://printer.local/pic.png",
        "http://app.localdomain/pic.png",
        "http://nas.home.arpa/pic.png",
        "http://gw.lan/pic.png",
        "http://box.home/pic.png",
        "http://int.corp/pic.png",
        "http://wiki.intranet/pic.png",
        "http://svc.private/pic.png",
        "http://1.0.0.127.in-addr.arpa/pic.png",
        # Wildcard-IP & loopback DNS-rebinding domains
        "http://127.0.0.1.nip.io/pic.png",
        "http://198.18.0.1.sslip.io/pic.png",
        "http://10.0.0.1.xip.io/pic.png",
        "http://app.traefik.me/pic.png",
        "http://7f000001.rbndr.us/pic.png",
        "http://localtest.me/pic.png",
        "http://sub.lvh.me/pic.png",
        "http://vcap.me/pic.png",
    ],
)
def test_validate_public_http_url_layer1_blocks_even_with_fake_ip_always_and_proxy(
    monkeypatch: pytest.MonkeyPatch,
    blocked_url: str,
) -> None:
    monkeypatch.setenv("all_proxy", "socks5://127.0.0.1:6153")
    monkeypatch.setattr(
        "app.fetchers.resolve_host_ips",
        lambda _h, _p: (_ for _ in ()).throw(AssertionError("DNS must not be called for Layer 1")),
    )

    with pytest.raises(ProxyError) as exc_info:
        validate_public_http_url(blocked_url, fake_ip_policy="always")
    assert exc_info.value.status_code == 403


def test_validate_public_http_url_rejects_invalid_idna_with_400() -> None:
    with pytest.raises(ProxyError) as exc_info:
        validate_public_http_url("https://a..b.example.com/pic.png")
    assert exc_info.value.status_code == 400


def test_validate_public_http_url_fake_ip_dns_gating(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.fetchers.resolve_host_ips", lambda _h, _p: ["198.18.0.42"])

    # 1) Blocked when policy="never" even if proxy is active
    monkeypatch.setenv("all_proxy", "socks5://127.0.0.1:6153")
    with pytest.raises(ProxyError) as never_exc:
        validate_public_http_url("https://cdn.example.com/pic.png", fake_ip_policy="never")
    assert never_exc.value.status_code == 403

    # 2) Blocked on non-80/443 ports even when policy="always"
    for bad_port_url in (
        "https://cdn.example.com:8443/pic.png",
        "http://cdn.example.com:8080/pic.png",
    ):
        with pytest.raises(ProxyError) as port_exc:
            validate_public_http_url(bad_port_url, fake_ip_policy="always")
        assert port_exc.value.status_code == 403

    # 3) Allowed on ports 80 and 443 when policy="auto" and proxy is active
    assert (
        validate_public_http_url("https://cdn.example.com/pic.png", fake_ip_policy="auto")
        == "https://cdn.example.com/pic.png"
    )
    assert (
        validate_public_http_url("http://cdn.example.com/pic.png", fake_ip_policy="auto")
        == "http://cdn.example.com/pic.png"
    )

    # 4) Blocked when policy="auto", no active proxy, and canary returns normal public IP
    monkeypatch.delenv("all_proxy", raising=False)
    with pytest.raises(ProxyError) as no_proxy_exc:
        validate_public_http_url("https://cdn.example.com/pic.png", fake_ip_policy="auto")
    assert no_proxy_exc.value.status_code == 403

    # 5) Blocked (fail-closed) when canary raises gaierror and no active proxy
    reset_dns_canary_caches()
    monkeypatch.setattr(
        "app.fetchers._resolve_canary_ips",
        lambda _d: (_ for _ in ()).throw(socket.gaierror("DNS failure")),
    )
    with pytest.raises(ProxyError) as canary_err_exc:
        validate_public_http_url("https://cdn.example.com/pic.png", fake_ip_policy="auto")
    assert canary_err_exc.value.status_code == 403

    # 6) Allowed when policy="auto" and canary confirms Surge/Sing-box TUN Fake-IP DNS (and cached)
    reset_dns_canary_caches()
    canary_calls = 0

    def fake_ip_canary(_domain: str) -> list[str]:
        nonlocal canary_calls
        canary_calls += 1
        return ["198.18.0.10"]

    monkeypatch.setattr("app.fetchers._resolve_canary_ips", fake_ip_canary)
    assert (
        validate_public_http_url("https://cdn.example.com/pic.png", fake_ip_policy="auto")
        == "https://cdn.example.com/pic.png"
    )
    assert _is_system_fake_ip_dns_active() is True
    assert canary_calls == 1  # Cached for 60s

    # 7) Allowed when policy="always" on port 443 even without proxy or canary
    reset_dns_canary_caches()
    monkeypatch.setattr("app.fetchers._resolve_canary_ips", lambda _d: ["93.184.216.34"])
    assert (
        validate_public_http_url("https://cdn.example.com/pic.png", fake_ip_policy="always")
        == "https://cdn.example.com/pic.png"
    )


def test_validate_public_http_url_mixed_ips_and_fake_ipv6_pairing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("all_proxy", "socks5://127.0.0.1:6153")

    # Paired 198.18.0.0/15 + fc00::/18 is allowed on 443
    monkeypatch.setattr("app.fetchers.resolve_host_ips", lambda _h, _p: ["198.18.0.42", "fc00::42"])
    assert (
        validate_public_http_url("https://cdn.example.com/pic.png", fake_ip_policy="auto")
        == "https://cdn.example.com/pic.png"
    )

    # Standalone fc00::1 (without 198.18.0.0/15) MUST be rejected
    monkeypatch.setattr("app.fetchers.resolve_host_ips", lambda _h, _p: ["fc00::1"])
    with pytest.raises(ProxyError) as standalone_v6:
        validate_public_http_url("https://cdn.example.com/pic.png", fake_ip_policy="always")
    assert standalone_v6.value.status_code == 403

    # Public + standalone fc00::1 MUST be rejected
    monkeypatch.setattr(
        "app.fetchers.resolve_host_ips", lambda _h, _p: ["93.184.216.34", "fc00::1"]
    )
    with pytest.raises(ProxyError) as pub_plus_v6:
        validate_public_http_url("https://cdn.example.com/pic.png", fake_ip_policy="always")
    assert pub_plus_v6.value.status_code == 403

    # Mixed Fake-IP + loopback / private / fd00:: MUST be rejected
    for mixed_ips in (
        ["198.18.0.42", "127.0.0.1"],
        ["198.18.0.42", "10.0.0.5"],
        ["198.18.0.42", "fd00::1"],
        ["::ffff:198.18.0.42"],
    ):
        monkeypatch.setattr("app.fetchers.resolve_host_ips", lambda _h, _p, ips=mixed_ips: ips)
        with pytest.raises(ProxyError) as mixed_exc:
            validate_public_http_url("https://cdn.example.com/pic.png", fake_ip_policy="always")
        assert mixed_exc.value.status_code == 403


def test_validate_public_http_url_proxy_only_dns_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def dns_fail(hostname: str, _port: int) -> list[str]:
        raise ProxyError(400, f"Could not resolve hostname: {hostname}")

    monkeypatch.setattr("app.fetchers.resolve_host_ips", dns_fail)
    monkeypatch.setenv("all_proxy", "socks5h://127.0.0.1:6153")

    # Local DNS works (canary resolves) -> do NOT defer; surface 400
    monkeypatch.setattr("app.fetchers._resolve_canary_ips", lambda _d: ["93.184.216.34"])
    with pytest.raises(ProxyError) as working_dns_exc:
        validate_public_http_url("https://missing.example.invalid/pic.png", fake_ip_policy="auto")
    assert working_dns_exc.value.status_code == 400

    # Local DNS is unreachable (canary fails too) -> defer on port 80/443 with active proxy
    reset_dns_canary_caches()
    monkeypatch.setattr(
        "app.fetchers._resolve_canary_ips",
        lambda _d: (_ for _ in ()).throw(socket.gaierror("offline local DNS")),
    )
    assert (
        validate_public_http_url("https://feeds.example.com/pic.png", fake_ip_policy="auto")
        == "https://feeds.example.com/pic.png"
    )

    # Disallowed when policy="never"
    with pytest.raises(ProxyError) as never_exc:
        validate_public_http_url("https://feeds.example.com/pic.png", fake_ip_policy="never")
    assert never_exc.value.status_code == 400

    # Disallowed on non-80/443 port
    with pytest.raises(ProxyError) as port_exc:
        validate_public_http_url("https://feeds.example.com:8443/pic.png", fake_ip_policy="auto")
    assert port_exc.value.status_code == 400

    # Disallowed when no active proxy
    monkeypatch.delenv("all_proxy", raising=False)
    with pytest.raises(ProxyError) as no_proxy_exc:
        validate_public_http_url("https://feeds.example.com/pic.png", fake_ip_policy="auto")
    assert no_proxy_exc.value.status_code == 400


@pytest.mark.asyncio
async def test_no_redundant_hop0_validation_in_image_proxy_and_extractor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dns_calls = 0

    def counting_resolver(_h: str, _p: int) -> list[str]:
        nonlocal dns_calls
        dns_calls += 1
        return ["93.184.216.34"]

    monkeypatch.setattr("app.fetchers.resolve_host_ips", counting_resolver)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _r: httpx.Response(200, headers={"Content-Type": "image/png"}, content=b"png")
        )
    ) as mock_client:
        await fetch_proxied_image("https://cdn.example.com/a.png", client=mock_client)
    assert dns_calls == 1

    dns_calls = 0
    app = create_app(db_path=":memory:", auto_refresh_minutes=0)
    with TestClient(app):
        db = app.state.db
        feed = db.create_feed(title="News", url="https://news.example.com/rss")
        entry_id = db.insert_entry(
            feed_id=feed.id,
            guid="hop0-1",
            canonical_url="https://news.example.com/story",
            title="Story",
            normalized_title="story",
            url="https://news.example.com/story",
            summary="Fallback",
        )
        assert entry_id is not None
        entry = db.get_entry(entry_id)
        assert entry is not None

        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _r: httpx.Response(200, text="<html><body><p>Hello world</p></body></html>")
            )
        ) as mock_client:
            await extract_entry_full_text(db, entry, client=mock_client)
    assert dns_calls == 1
