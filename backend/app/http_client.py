"""Centralized httpx AsyncClient factory with SOCKS5/HTTP proxy and TLS env support."""

from __future__ import annotations

import ipaddress
import urllib.request
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from urllib.parse import urlparse

import httpx

from app.config import Settings, get_settings, normalize_proxy_url

BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/136.0.0.0 Safari/537.36"
)
FALLBACK_FEED_USER_AGENT = "Mozilla/5.0 (compatible; FolioRSS/0.3)"

FEED_HEADERS: dict[str, str] = {
    "User-Agent": BROWSER_USER_AGENT,
    "Accept": (
        "application/rss+xml, application/atom+xml, "
        "application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

HTML_HEADERS: dict[str, str] = {
    "User-Agent": BROWSER_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

API_USER_AGENT = BROWSER_USER_AGENT

DEFAULT_HTTP_TIMEOUT = httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=10.0)
AI_HTTP_TIMEOUT = httpx.Timeout(connect=10.0, read=45.0, write=10.0, pool=10.0)
DEFAULT_HTTP_LIMITS = httpx.Limits(max_connections=20, max_keepalive_connections=10)

_LOCAL_BYPASS_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_LOCAL_BYPASS_MOUNTS: dict[str, httpx.AsyncBaseTransport | None] = {
    "all://localhost": None,
    "all://127.0.0.1": None,
    "all://[::1]": None,
}


def create_async_client(
    *,
    timeout: httpx.Timeout | float = DEFAULT_HTTP_TIMEOUT,
    follow_redirects: bool = False,
    headers: Mapping[str, str] | None = None,
    proxy_url: str | None = None,
    settings: Settings | None = None,
) -> httpx.AsyncClient:
    """Create a configured ``httpx.AsyncClient`` honoring explicit or system proxies.

    Proxy precedence:
    1. Explicit ``proxy_url`` argument (if provided).
    2. ``RSS_PROXY_URL`` from ``settings`` (or ``get_settings()``).
    3. Environment and OS system proxies via ``trust_env=True`` (supports HTTP/HTTPS/SOCKS5).

    In all modes, custom CA bundles configured via ``SSL_CERT_FILE`` / ``SSL_CERT_DIR``
    are preserved. When an explicit proxy URL is active, localhost targets remain direct
    so local services such as RSSHub or Ollama are never routed through the proxy.
    """
    if proxy_url is not None:
        effective_proxy = normalize_proxy_url(proxy_url)
    else:
        effective_settings = settings if settings is not None else get_settings()
        effective_proxy = effective_settings.resolved_proxy_url()

    if effective_proxy == "direct":
        return httpx.AsyncClient(
            timeout=timeout,
            limits=DEFAULT_HTTP_LIMITS,
            follow_redirects=follow_redirects,
            headers=headers,
            verify=httpx.create_ssl_context(trust_env=True),
            trust_env=False,
        )

    if effective_proxy is not None:
        return httpx.AsyncClient(
            timeout=timeout,
            limits=DEFAULT_HTTP_LIMITS,
            follow_redirects=follow_redirects,
            headers=headers,
            proxy=effective_proxy,
            mounts=dict(_LOCAL_BYPASS_MOUNTS),
            trust_env=True,
        )

    return httpx.AsyncClient(
        timeout=timeout,
        limits=DEFAULT_HTTP_LIMITS,
        follow_redirects=follow_redirects,
        headers=headers,
        trust_env=True,
    )


@asynccontextmanager
async def managed_async_client(
    client: httpx.AsyncClient | None,
    *,
    timeout: httpx.Timeout | float = DEFAULT_HTTP_TIMEOUT,
    follow_redirects: bool = False,
    headers: Mapping[str, str] | None = None,
    proxy_url: str | None = None,
    settings: Settings | None = None,
) -> AsyncIterator[httpx.AsyncClient]:
    """Yield an injected test/pooled client as-is, or create and close a new client."""
    if client is not None:
        yield client
        return

    http_client = create_async_client(
        timeout=timeout,
        follow_redirects=follow_redirects,
        headers=headers,
        proxy_url=proxy_url,
        settings=settings,
    )
    try:
        yield http_client
    finally:
        await http_client.aclose()


def _host_matches_no_proxy(hostname: str, port: int, scheme: str, no_proxy_raw: str) -> bool:
    """Return True if ``hostname`` matches any entry in a comma-separated NO_PROXY list."""
    if not no_proxy_raw:
        return False

    host_ip: ipaddress.IPv4Address | ipaddress.IPv6Address | None = None
    try:
        host_ip = ipaddress.ip_address(hostname)
    except ValueError:
        host_ip = None

    for raw_entry in no_proxy_raw.split(","):
        entry = raw_entry.strip().lower()
        if not entry:
            continue
        if entry == "*":
            return True

        if "://" in entry:
            entry_scheme, entry = entry.split("://", 1)
            if entry_scheme not in ("all", scheme):
                continue
            entry = entry.split("/", 1)[0]

        if "/" in entry:
            if host_ip is not None:
                try:
                    if host_ip in ipaddress.ip_network(entry, strict=False):
                        return True
                except ValueError:
                    pass
            continue

        entry_host = entry
        entry_port: int | None = None
        if entry.startswith("["):
            end_bracket = entry.find("]")
            if end_bracket != -1:
                entry_host = entry[1:end_bracket]
                rest = entry[end_bracket + 1 :]
                if rest.startswith(":") and rest[1:].isdigit():
                    entry_port = int(rest[1:])
        elif entry.count(":") == 1:
            host_part, port_part = entry.rsplit(":", 1)
            if port_part.isdigit():
                entry_host = host_part
                entry_port = int(port_part)

        if entry_port is not None and entry_port != port:
            continue

        entry_host = entry_host.rstrip(".")
        if not entry_host:
            continue

        if entry_host.startswith("*."):
            if hostname.endswith(entry_host[1:]):
                return True
            continue

        if entry_host.startswith("."):
            if hostname.endswith(entry_host):
                return True
            continue

        if hostname == entry_host or hostname.endswith(f".{entry_host}"):
            return True

    return False


def has_active_proxy_for_url(url: str, *, settings: Settings | None = None) -> bool:
    """Return True if requests to ``url`` will route through a configured or system proxy."""
    try:
        parsed = urlparse(url.strip())
    except ValueError:
        return False

    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        return False

    hostname = (parsed.hostname or "").strip().lower().rstrip(".")
    if not hostname:
        return False

    try:
        port = parsed.port or (443 if scheme == "https" else 80)
    except ValueError:
        return False

    effective_settings = settings if settings is not None else get_settings()
    try:
        effective_proxy = effective_settings.resolved_proxy_url()
    except ValueError:
        return False

    if effective_proxy == "direct":
        return False

    if effective_proxy is not None:
        return hostname not in _LOCAL_BYPASS_HOSTS

    proxies = urllib.request.getproxies()
    no_proxy = proxies.get("no", "")
    if _host_matches_no_proxy(hostname, port, scheme, no_proxy):
        return False

    return bool(proxies.get(scheme) or proxies.get("all"))
