"""Feed fetchers (RSS/Atom, HN Algolia, YouTube, Podcasts), extractor, and SSRF-safe image proxy."""

from __future__ import annotations

import html
import ipaddress
import json
import re
import socket
import time
from calendar import timegm
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import feedparser
import httpx
import trafilatura

from app.config import FakeIPPolicy, Settings, get_settings
from app.db import Database, utc_now_iso
from app.http_client import (
    API_USER_AGENT,
    BROWSER_USER_AGENT,
    FALLBACK_FEED_USER_AGENT,
    FEED_HEADERS,
    HTML_HEADERS,
    has_active_proxy_for_url,
    managed_async_client,
)
from app.models import (
    EntryOut,
    FeedOut,
    FilterRuleOut,
    HNComment,
    PodcastSearchResult,
)

MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_REDIRECTS = 5

TRACKING_EXACT_PARAMS = frozenset(
    {
        "fbclid",
        "gclid",
        "dclid",
        "msclkid",
        "mc_cid",
        "mc_eid",
        "ref",
        "ref_src",
        "ocid",
        "cmpid",
        "taid",
        "guccounter",
        "guce_referrer",
        "guce_referrer_sig",
        "spm",
        "si",
        "feature",
        "igshid",
    }
)

BLOCKED_HOSTNAMES = frozenset(
    {
        "localhost",
        "localhost.localdomain",
        "ip6-localhost",
        "ip6-loopback",
        "metadata",
        "metadata.google.internal",
        "metadata.goog",
        "instance-data",
        "host.docker.internal",
        "gateway.docker.internal",
    }
)

BLOCKED_HOSTNAME_SUFFIXES = (
    ".localhost",
    ".local",
    ".internal",
    ".localdomain",
    ".home.arpa",
    ".lan",
    ".home",
    ".corp",
    ".intranet",
    ".private",
    ".arpa",
)

BLOCKED_REBINDING_DOMAINS = (
    "nip.io",
    "sslip.io",
    "xip.io",
    "traefik.me",
    "rbndr.us",
    "localtest.me",
    "lvh.me",
    "vcap.me",
)

_FAKE_IP_V4_NET = ipaddress.ip_network("198.18.0.0/15")
_FAKE_IP_V6_NET = ipaddress.ip_network("fc00::/18")
_FAKE_IP_CANARY_DOMAINS = ("example.com", "cloudflare.com")
_FAKE_IP_CANARY_TTL_SECONDS = 60.0
_fake_ip_canary_cache: tuple[float, bool] | None = None
_local_dns_canary_cache: tuple[float, bool] | None = None

AUDIO_EXTENSIONS = (".mp3", ".m4a", ".ogg", ".opus", ".wav", ".aac", ".flac")
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")
_NON_WORD_RE = re.compile(r"[^\w\s]+", re.UNICODE)
_IMG_SRC_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.IGNORECASE)
_YT_CHANNEL_ID_PATTERNS = (
    re.compile(r'"channelId"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"'),
    re.compile(r'itemprop="channelId"\s+content="(UC[a-zA-Z0-9_-]{22})"'),
    re.compile(r'content="(UC[a-zA-Z0-9_-]{22})"\s+itemprop="channelId"'),
    re.compile(r'youtube\.com/channel/(UC[a-zA-Z0-9_-]{22})'),
    re.compile(r'"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{22})"'),
)
_OG_TITLE_RE = re.compile(
    r'<meta\s+(?:property="og:title"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:title")',
    re.IGNORECASE,
)
_HTML_TITLE_RE = re.compile(r"<title>([^<]+)</title>", re.IGNORECASE)
_YT_VIDEO_ID_RE = re.compile(
    r"(?:v=|/shorts/|youtu\.be/|/embed/|yt:video:)([a-zA-Z0-9_-]{11})"
)


class ProxyError(Exception):
    """Error raised by the SSRF-safe image proxy or URL validator."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class YouTubeResolved:
    feed_url: str
    site_url: str
    title: str | None
    channel_id: str | None
    exclude_shorts: bool


# ---------------------------------------------------------------------------
# URL canonicalization, normalization & L1 keyword filtering
# ---------------------------------------------------------------------------


def canonicalize_url(url: str) -> str:
    """Canonicalize an article/entry URL by stripping tracking params and fragments."""
    raw = url.strip()
    if not raw:
        return ""
    parsed = urlparse(raw)
    scheme = parsed.scheme.lower()
    host = (parsed.hostname or "").lower()
    port = parsed.port
    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        port = None

    netloc = host
    if ":" in host and not host.startswith("["):
        netloc = f"[{host}]"
    if port is not None:
        netloc = f"{netloc}:{port}"

    path = parsed.path or "/"
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")

    filtered_params = [
        (k, v)
        for k, v in parse_qsl(parsed.query, keep_blank_values=False)
        if not k.lower().startswith("utm_") and k.lower() not in TRACKING_EXACT_PARAMS
    ]
    filtered_params.sort()
    query = urlencode(filtered_params, doseq=True)

    return urlunparse((scheme, netloc, path, "", query, ""))


def normalize_title(title: str) -> str:
    """Normalize a title for deduplication comparisons."""
    cleaned = html.unescape(title).lower()
    cleaned = _NON_WORD_RE.sub(" ", cleaned)
    return _WHITESPACE_RE.sub(" ", cleaned).strip()


def strip_html(raw_html: str | None) -> str:
    """Convert HTML markup to clean plain text."""
    if not raw_html:
        return ""
    text = _HTML_TAG_RE.sub(" ", raw_html)
    text = html.unescape(text)
    return _WHITESPACE_RE.sub(" ", text).strip()


def sanitize_http_url(raw_url: str | None) -> str | None:
    """Return URL only if it uses http:// or https:// with a valid hostname, else None."""
    if not raw_url:
        return None
    cleaned = raw_url.strip()
    if not cleaned:
        return None
    parsed = urlparse(cleaned)
    if parsed.scheme.lower() not in ("http", "https"):
        return None
    if not parsed.hostname:
        return None
    return cleaned


def matches_filter_rules(
    title: str,
    content: str,
    rules: list[FilterRuleOut],
) -> bool:
    """Return True if an entry matches any L1 keyword blacklist rule."""
    if not rules:
        return False
    title_low = title.lower()
    content_low = content.lower()
    for rule in rules:
        kw = rule.keyword.strip().lower()
        if not kw:
            continue
        field = rule.match_field
        if field == "title":
            if kw in title_low:
                return True
        elif field == "content":
            if kw in content_low:
                return True
        else:
            if kw in title_low or kw in content_low:
                return True
    return False


# ---------------------------------------------------------------------------
# SSRF protection & Safe Image Proxy
# ---------------------------------------------------------------------------


def _is_ip_blocked(ip_str: str) -> bool:
    """Return True if an IP address is private, loopback, link-local, or non-global."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True

    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped

    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or not ip.is_global
    )


def _is_fake_ip_v4(ip_str: str) -> bool:
    """Return True if ``ip_str`` is a native IPv4 address in RFC 2544 Fake-IP range."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return isinstance(ip, ipaddress.IPv4Address) and ip in _FAKE_IP_V4_NET


def _is_fake_ip_v6(ip_str: str) -> bool:
    """Return True if ``ip_str`` is an IPv6 address in the Sing-box/Surge Fake-IPv6 prefix."""
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return isinstance(ip, ipaddress.IPv6Address) and ip in _FAKE_IP_V6_NET


def _parse_literal_ip(
    hostname: str,
) -> tuple[ipaddress.IPv4Address | ipaddress.IPv6Address, bool] | None:
    """Parse canonical or obfuscated literal IP addresses.

    Returns ``(ip_address, is_obfuscated_ipv4)`` if ``hostname`` is an IP literal,
    or ``None`` if it is a regular domain name.
    """
    try:
        return ipaddress.ip_address(hostname), False
    except ValueError:
        pass

    try:
        packed = socket.inet_aton(hostname)
    except OSError:
        return None

    ip = ipaddress.IPv4Address(packed)
    return ip, str(ip) != hostname


def _normalize_hostname(raw_hostname: str) -> str:
    """Normalize a non-IPv6 hostname via IDNA or validate an IPv6 literal."""
    cleaned = raw_hostname.strip()
    if not cleaned:
        raise ProxyError(400, "URL must include a valid hostname")

    if ":" in cleaned:
        try:
            ipaddress.ip_address(cleaned)
        except ValueError as exc:
            raise ProxyError(400, f"Invalid IPv6 hostname: '{cleaned}'") from exc
        return cleaned.lower()

    try:
        ascii_host = cleaned.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ProxyError(400, f"Invalid IDNA hostname: '{cleaned}'") from exc

    normalized = ascii_host.strip().lower().rstrip(".")
    if not normalized:
        raise ProxyError(400, "URL must include a valid hostname")
    return normalized


def _resolve_canary_ips(domain: str) -> list[str]:
    """Resolve a trusted canary domain via system DNS."""
    infos = socket.getaddrinfo(domain, 443, type=socket.SOCK_STREAM)
    ips: list[str] = []
    for info in infos:
        sockaddr = info[4]
        if sockaddr:
            ip_str = str(sockaddr[0])
            if ip_str not in ips:
                ips.append(ip_str)
    return ips


def reset_dns_canary_caches() -> None:
    """Clear cached Fake-IP and local DNS canary probe results."""
    global _fake_ip_canary_cache, _local_dns_canary_cache
    _fake_ip_canary_cache = None
    _local_dns_canary_cache = None


def _is_system_fake_ip_dns_active() -> bool:
    """Return True if trusted canary domains resolve to RFC 2544 Fake-IP (198.18.0.0/15).

    Cached for 60s; fails closed (False) on DNS resolution errors.
    """
    global _fake_ip_canary_cache
    now = time.monotonic()
    if (
        _fake_ip_canary_cache is not None
        and (now - _fake_ip_canary_cache[0]) < _FAKE_IP_CANARY_TTL_SECONDS
    ):
        return _fake_ip_canary_cache[1]

    active = False
    for domain in _FAKE_IP_CANARY_DOMAINS:
        try:
            ips = _resolve_canary_ips(domain)
        except OSError:
            continue
        if ips and any(_is_fake_ip_v4(ip) for ip in ips):
            active = True
            break

    _fake_ip_canary_cache = (now, active)
    return active


def _is_local_dns_available() -> bool:
    """Return True if local system DNS can resolve at least one trusted canary domain."""
    global _local_dns_canary_cache
    now = time.monotonic()
    if (
        _local_dns_canary_cache is not None
        and (now - _local_dns_canary_cache[0]) < _FAKE_IP_CANARY_TTL_SECONDS
    ):
        return _local_dns_canary_cache[1]

    available = False
    for domain in _FAKE_IP_CANARY_DOMAINS:
        try:
            ips = _resolve_canary_ips(domain)
        except OSError:
            continue
        if ips:
            available = True
            break

    _local_dns_canary_cache = (now, available)
    return available


def resolve_host_ips(hostname: str, port: int) -> list[str]:
    """Resolve a hostname to a deduplicated list of IP address strings."""
    try:
        infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ProxyError(400, f"Could not resolve hostname: {hostname}") from exc

    ips: list[str] = []
    for info in infos:
        sockaddr = info[4]
        if sockaddr:
            ip_str = str(sockaddr[0])
            if ip_str not in ips:
                ips.append(ip_str)
    if not ips:
        raise ProxyError(400, f"No IP addresses resolved for hostname: {hostname}")
    return ips


def validate_public_http_url(
    url: str,
    *,
    fake_ip_policy: FakeIPPolicy | None = None,
    settings: Settings | None = None,
) -> str:
    """Validate URL scheme and reject localhost, private, loopback, link-local, or reserved IPs.

    Supports gated acceptance of DNS-resolved Surge/Sing-box Fake-IPs (198.18.0.0/15, and
    paired fc00::/18 only when 198.18.0.0/15 is also present) on ports 80/443, while keeping
    all literal IPs and internal/rebinding hostnames unconditionally blocked.
    """
    raw = url.strip()
    if not raw:
        raise ProxyError(400, "URL is required")

    try:
        parsed = urlparse(raw)
    except ValueError as exc:
        raise ProxyError(400, f"Malformed URL: {exc}") from exc

    scheme = parsed.scheme.lower()
    if scheme not in ("http", "https"):
        raise ProxyError(400, f"Unsupported URL scheme: {parsed.scheme or 'none'}")

    if parsed.username is not None or parsed.password is not None:
        raise ProxyError(400, "Credentials in URL are not allowed")

    try:
        port = parsed.port or (443 if scheme == "https" else 80)
    except ValueError as exc:
        raise ProxyError(400, f"Invalid port in URL: {exc}") from exc

    # Layer 1: unconditional pre-DNS hostname & literal IP checks
    hostname = _normalize_hostname(parsed.hostname or "")

    parsed_literal = _parse_literal_ip(hostname)
    if parsed_literal is not None:
        literal_ip, is_obfuscated = parsed_literal
        if is_obfuscated or _is_ip_blocked(str(literal_ip)):
            raise ProxyError(
                403,
                f"Access to non-public or obfuscated IP '{hostname}' is forbidden",
            )
        return raw

    if (
        hostname in BLOCKED_HOSTNAMES
        or any(hostname.endswith(suffix) for suffix in BLOCKED_HOSTNAME_SUFFIXES)
        or any(
            hostname == domain or hostname.endswith(f".{domain}")
            for domain in BLOCKED_REBINDING_DOMAINS
        )
    ):
        raise ProxyError(403, f"Access to internal or blocked host '{hostname}' is forbidden")

    if "." not in hostname:
        raise ProxyError(403, f"Access to single-label internal host '{hostname}' is forbidden")

    def _effective_policy_and_settings() -> tuple[FakeIPPolicy, Settings | None]:
        if fake_ip_policy is not None:
            return fake_ip_policy, settings
        resolved_settings = settings if settings is not None else get_settings()
        return resolved_settings.rss_allow_fake_ip_dns, resolved_settings

    # Layer 2: DNS resolution with gated Fake-IP acceptance and proxy-only DNS fallback
    try:
        resolved_ips = resolve_host_ips(hostname, port)
    except ProxyError as exc:
        if exc.status_code == 400:
            policy, effective_settings = _effective_policy_and_settings()
            if (
                policy != "never"
                and port in (80, 443)
                and has_active_proxy_for_url(raw, settings=effective_settings)
                and not _is_local_dns_available()
            ):
                return raw
        raise

    if not any(_is_ip_blocked(ip_str) for ip_str in resolved_ips):
        return raw

    has_fake_v4 = any(_is_fake_ip_v4(ip_str) for ip_str in resolved_ips)
    for ip_str in resolved_ips:
        if not _is_ip_blocked(ip_str):
            continue
        if _is_fake_ip_v4(ip_str):
            continue
        if has_fake_v4 and _is_fake_ip_v6(ip_str):
            continue
        raise ProxyError(
            403,
            f"Hostname '{hostname}' resolved to non-public IP '{ip_str}'",
        )

    if port not in (80, 443):
        raise ProxyError(
            403,
            f"Hostname '{hostname}' resolved to Fake-IP on disallowed port {port}",
        )

    policy, effective_settings = _effective_policy_and_settings()
    if policy == "never":
        raise ProxyError(
            403,
            f"Hostname '{hostname}' resolved to Fake-IP while RSS_ALLOW_FAKE_IP_DNS=never",
        )
    if policy == "always":
        return raw

    if (
        has_active_proxy_for_url(raw, settings=effective_settings)
        or _is_system_fake_ip_dns_active()
    ):
        return raw

    raise ProxyError(
        403,
        f"Hostname '{hostname}' resolved to non-public Fake-IP without an active proxy "
        "or Fake-IP DNS",
    )


async def fetch_proxied_image(
    url: str,
    *,
    client: httpx.AsyncClient | None = None,
    max_bytes: int = MAX_IMAGE_BYTES,
) -> tuple[bytes, str]:
    """Fetch a remote image safely with SSRF validation on every redirect hop."""
    current_url = validate_public_http_url(url)

    async with managed_async_client(client, follow_redirects=False) as http_client:
        try:
            for hop in range(MAX_REDIRECTS + 1):
                parsed = urlparse(current_url)
                headers = {
                    "User-Agent": BROWSER_USER_AGENT,
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                    "Referer": f"{parsed.scheme}://{parsed.netloc}/",
                }
                async with http_client.stream(
                    "GET",
                    current_url,
                    headers=headers,
                    follow_redirects=False,
                ) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        location = response.headers.get("location")
                        if not location:
                            raise ProxyError(502, "Upstream redirect missing Location header")
                        if hop == MAX_REDIRECTS:
                            break
                        current_url = validate_public_http_url(urljoin(current_url, location))
                        continue

                    if response.status_code >= 400:
                        raise ProxyError(
                            502,
                            f"Upstream image server returned HTTP {response.status_code}",
                        )

                    raw_ct = response.headers.get("content-type", "")
                    content_type = raw_ct.split(";", 1)[0].strip().lower()
                    if not content_type.startswith("image/"):
                        ct_label = content_type or "none"
                        raise ProxyError(
                            400,
                            f"Upstream resource is not an image (content-type: {ct_label})",
                        )

                    content_length_hdr = response.headers.get("content-length")
                    if content_length_hdr:
                        try:
                            if int(content_length_hdr) > max_bytes:
                                raise ProxyError(
                                    413,
                                    f"Image exceeds maximum allowed size of {max_bytes} bytes",
                                )
                        except ValueError:
                            pass

                    buf = bytearray()
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        buf.extend(chunk)
                        if len(buf) > max_bytes:
                            raise ProxyError(
                                413,
                                f"Image exceeds maximum allowed size of {max_bytes} bytes",
                            )

                    return bytes(buf), content_type

            raise ProxyError(400, "Too many redirects while fetching image")
        except httpx.HTTPError as exc:
            raise ProxyError(502, f"Failed to fetch upstream image: {exc}") from exc


# ---------------------------------------------------------------------------
# YouTube smart URL resolver & helpers
# ---------------------------------------------------------------------------


def is_youtube_url(url: str) -> bool:
    parsed = urlparse(url.strip())
    if parsed.scheme.lower() not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    return host in {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be",
    }


def _is_allowed_youtube_redirect_url(url: str) -> bool:
    parsed = urlparse(url.strip())
    if parsed.scheme.lower() not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    return host in {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be",
        "consent.youtube.com",
    }


def channel_id_to_youtube_feed_url(channel_id: str, exclude_shorts: bool = False) -> str:
    """Convert a UC... YouTube channel ID to a standard or UULF (no-Shorts) RSS feed URL."""
    cid = channel_id.strip()
    if exclude_shorts and cid.startswith("UC") and len(cid) > 2:
        playlist_id = "UULF" + cid[2:]
        return f"https://www.youtube.com/feeds/videos.xml?playlist_id={playlist_id}"
    return f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}"


def extract_youtube_channel_id_from_html(page_html: str) -> str | None:
    for pattern in _YT_CHANNEL_ID_PATTERNS:
        match = pattern.search(page_html)
        if match:
            return match.group(1)
    return None


def extract_youtube_title_from_html(page_html: str) -> str | None:
    og_match = _OG_TITLE_RE.search(page_html)
    if og_match:
        title = html.unescape(og_match.group(1) or og_match.group(2) or "").strip()
        if title:
            return title
    title_match = _HTML_TITLE_RE.search(page_html)
    if title_match:
        raw_title = html.unescape(title_match.group(1)).strip()
        if raw_title.endswith(" - YouTube"):
            raw_title = raw_title[: -len(" - YouTube")].strip()
        if raw_title:
            return raw_title
    return None


async def resolve_youtube_feed_url(
    url: str,
    *,
    exclude_shorts: bool = False,
    client: httpx.AsyncClient | None = None,
) -> YouTubeResolved:
    """Resolve YouTube @handle, /channel/UC..., or XML feed URL into an RSS feed URL."""
    raw = url.strip()
    target_url = f"https://www.youtube.com/{raw}" if raw.startswith("@") else raw
    if not is_youtube_url(target_url):
        raise ValueError("YouTube feed URL must use http(s) on youtube.com or youtu.be")

    parsed = urlparse(target_url)
    query_params = dict(parse_qsl(parsed.query))

    # Case 1: Already a YouTube XML feed URL
    if "/feeds/videos.xml" in parsed.path:
        if "channel_id" in query_params:
            cid = query_params["channel_id"]
            feed_url = channel_id_to_youtube_feed_url(cid, exclude_shorts=exclude_shorts)
            return YouTubeResolved(
                feed_url=feed_url,
                site_url=f"https://www.youtube.com/channel/{cid}",
                title=None,
                channel_id=cid,
                exclude_shorts=exclude_shorts,
            )
        if "playlist_id" in query_params:
            pid = query_params["playlist_id"]
            cid_guess = f"UC{pid[4:]}" if pid.startswith("UULF") else None
            is_uulf = pid.startswith("UULF")
            return YouTubeResolved(
                feed_url=target_url,
                site_url=(
                    f"https://www.youtube.com/channel/{cid_guess}"
                    if cid_guess
                    else f"https://www.youtube.com/playlist?list={pid}"
                ),
                title=None,
                channel_id=cid_guess,
                exclude_shorts=exclude_shorts or is_uulf,
            )

    # Case 2: Direct /channel/UC... URL
    channel_match = re.search(r"/channel/(UC[a-zA-Z0-9_-]{22})", parsed.path)
    if channel_match:
        cid = channel_match.group(1)
        return YouTubeResolved(
            feed_url=channel_id_to_youtube_feed_url(cid, exclude_shorts=exclude_shorts),
            site_url=f"https://www.youtube.com/channel/{cid}",
            title=None,
            channel_id=cid,
            exclude_shorts=exclude_shorts,
        )

    # Case 3: @handle, /c/..., /user/... -> safely fetch YouTube channel page HTML
    page_html: str | None = None
    current_url = target_url
    async with managed_async_client(client, follow_redirects=False) as http_client:
        try:
            for _ in range(MAX_REDIRECTS + 1):
                if not _is_allowed_youtube_redirect_url(current_url):
                    raise ValueError(
                        f"Refusing to follow non-YouTube redirect target '{current_url}'"
                    )
                try:
                    validate_public_http_url(current_url)
                except ProxyError as exc:
                    raise ValueError(
                        f"Blocked unsafe YouTube resolution target: {exc.detail}"
                    ) from exc

                response = await http_client.get(
                    current_url,
                    headers={
                        "User-Agent": BROWSER_USER_AGENT,
                        "Accept-Language": "en-US,en;q=0.9",
                        "Cookie": "CONSENT=YES+cb.20210328-17-p0.en+FX+417",
                    },
                    follow_redirects=False,
                )
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise ValueError("YouTube redirect response missing Location header")
                    current_url = urljoin(current_url, location)
                    continue

                response.raise_for_status()
                page_html = response.text
                break
        except httpx.HTTPError as exc:
            raise ValueError(f"Failed to fetch YouTube channel page '{target_url}': {exc}") from exc

    if page_html is None:
        raise ValueError(f"Too many redirects while resolving YouTube channel '{target_url}'")

    extracted_cid = extract_youtube_channel_id_from_html(page_html)
    if not extracted_cid:
        raise ValueError(f"Could not extract YouTube channel_id from '{target_url}'")

    title = extract_youtube_title_from_html(page_html)
    return YouTubeResolved(
        feed_url=channel_id_to_youtube_feed_url(extracted_cid, exclude_shorts=exclude_shorts),
        site_url=target_url,
        title=title,
        channel_id=extracted_cid,
        exclude_shorts=exclude_shorts,
    )


def extract_youtube_video_id(entry: Any) -> str | None:
    """Extract an 11-character YouTube video_id from a feedparser entry."""
    yt_vid = entry.get("yt_videoid")
    if isinstance(yt_vid, str) and yt_vid.strip():
        return yt_vid.strip()

    for candidate in (entry.get("link"), entry.get("id")):
        if isinstance(candidate, str):
            match = _YT_VIDEO_ID_RE.search(candidate)
            if match:
                return match.group(1)
    return None


# ---------------------------------------------------------------------------
# Podcast helpers & iTunes Search discovery proxy
# ---------------------------------------------------------------------------


def format_duration(raw_duration: str | None) -> str | None:
    """Normalize iTunes duration strings (seconds or HH:MM:SS) into a readable format."""
    if not raw_duration:
        return None
    val = raw_duration.strip()
    if not val:
        return None
    if ":" in val:
        return val
    if val.isdigit():
        total_secs = int(val)
        hours, rem = divmod(total_secs, 3600)
        minutes, seconds = divmod(rem, 60)
        if hours > 0:
            return f"{hours}:{minutes:02d}:{seconds:02d}"
        return f"{minutes}:{seconds:02d}"
    return val


def extract_audio_enclosure(entry: Any) -> str | None:
    """Extract safe http(s) podcast audio enclosure URL from a feedparser entry."""
    for enclosure in entry.get("enclosures") or []:
        href = sanitize_http_url(str(enclosure.get("href") or enclosure.get("url") or ""))
        enc_type = str(enclosure.get("type") or "").lower()
        if not href:
            continue
        if enc_type.startswith("audio/") or urlparse(href).path.lower().endswith(AUDIO_EXTENSIONS):
            return href

    for link in entry.get("links") or []:
        if link.get("rel") == "enclosure":
            href = sanitize_http_url(str(link.get("href") or ""))
            link_type = str(link.get("type") or "").lower()
            if href and (
                link_type.startswith("audio/")
                or urlparse(href).path.lower().endswith(AUDIO_EXTENSIONS)
            ):
                return href
    return None


def extract_entry_image(
    entry: Any,
    feed_image: str | None = None,
    content_html: str = "",
) -> str | None:
    """Extract best safe http(s) thumbnail/cover image URL for an entry."""
    media_thumbs = entry.get("media_thumbnail") or []
    for thumb in media_thumbs:
        url = sanitize_http_url(str(thumb.get("url") or ""))
        if url:
            return url

    media_contents = entry.get("media_content") or []
    for item in media_contents:
        url = sanitize_http_url(str(item.get("url") or ""))
        medium = str(item.get("medium") or "").lower()
        mtype = str(item.get("type") or "").lower()
        if url and (
            medium == "image"
            or mtype.startswith("image/")
            or urlparse(url).path.lower().endswith(IMAGE_EXTENSIONS)
        ):
            return url

    entry_image = entry.get("image")
    if isinstance(entry_image, dict):
        href = sanitize_http_url(str(entry_image.get("href") or entry_image.get("url") or ""))
        if href:
            return href

    for enclosure in entry.get("enclosures") or []:
        href = sanitize_http_url(str(enclosure.get("href") or enclosure.get("url") or ""))
        enc_type = str(enclosure.get("type") or "").lower()
        if href and enc_type.startswith("image/"):
            return href

    if content_html:
        match = _IMG_SRC_RE.search(content_html)
        if match:
            img_url = sanitize_http_url(html.unescape(match.group(1)))
            if img_url:
                return img_url

    return sanitize_http_url(feed_image)


async def discover_podcasts(
    query: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> list[PodcastSearchResult]:
    """Search podcasts via the Apple iTunes Search API."""
    term = query.strip()
    if not term:
        return []

    async with managed_async_client(client, follow_redirects=True) as http_client:
        response = await http_client.get(
            "https://itunes.apple.com/search",
            params={
                "term": term,
                "media": "podcast",
                "entity": "podcast",
                "limit": 10,
            },
            headers={"User-Agent": API_USER_AGENT},
        )
        response.raise_for_status()
        payload = response.json()

    results: list[PodcastSearchResult] = []
    for item in payload.get("results") or []:
        feed_url = str(item.get("feedUrl") or "").strip()
        if not feed_url:
            continue
        title = str(item.get("collectionName") or item.get("trackName") or feed_url).strip()
        author = str(item.get("artistName") or "Unknown").strip()
        artwork = item.get("artworkUrl600") or item.get("artworkUrl100")
        genre = item.get("primaryGenreName")
        results.append(
            PodcastSearchResult(
                title=title,
                author=author,
                feed_url=feed_url,
                artwork_url=str(artwork) if artwork else None,
                genre=str(genre) if genre else None,
            )
        )
    return results


# ---------------------------------------------------------------------------
# Standard RSS / Atom / YouTube / Podcast Feed Fetcher
# ---------------------------------------------------------------------------


def _parse_entry_timestamp(entry: Any) -> str | None:
    for attr in ("published_parsed", "updated_parsed", "created_parsed"):
        parsed_time = entry.get(attr)
        if parsed_time is not None:
            try:
                ts = timegm(parsed_time)
                return datetime.fromtimestamp(ts, tz=UTC).isoformat().replace("+00:00", "Z")
            except (TypeError, ValueError, OverflowError):
                continue
    return None


def parse_rss_xml_into_db(
    *,
    db: Database,
    feed: FeedOut,
    xml_text: str,
) -> tuple[int, int]:
    """Parse RSS/Atom XML text and ingest entries with L1 dedup + keyword filtering."""
    parsed = feedparser.parse(xml_text)
    entries = list(parsed.get("entries") or [])
    feed_meta = parsed.get("feed") or {}

    if parsed.get("bozo") and not entries and not feed_meta.get("title"):
        bozo_exc = parsed.get("bozo_exception")
        raise ValueError(f"Invalid RSS/Atom feed XML: {bozo_exc}")

    # Extract optional feed-level metadata
    feed_image: str | None = None
    meta_image = feed_meta.get("image")
    if isinstance(meta_image, dict):
        feed_image = sanitize_http_url(str(meta_image.get("href") or meta_image.get("url") or ""))
    elif feed_meta.get("icon"):
        feed_image = sanitize_http_url(str(feed_meta.get("icon")))

    rules = db.list_filter_rules()
    added = 0
    filtered = 0
    now_iso = utc_now_iso()

    for raw_entry in entries:
        title = html.unescape(str(raw_entry.get("title") or "Untitled")).strip()
        link = sanitize_http_url(str(raw_entry.get("link") or ""))
        audio_url = extract_audio_enclosure(raw_entry)
        if not link and audio_url:
            link = audio_url
        if not link:
            continue

        canonical = canonicalize_url(link)
        norm_title = normalize_title(title)
        guid = str(raw_entry.get("id") or raw_entry.get("guid") or "").strip() or None

        content_html = ""
        raw_contents = raw_entry.get("content") or []
        if raw_contents and isinstance(raw_contents, list):
            first_content = raw_contents[0]
            if isinstance(first_content, dict):
                content_html = str(first_content.get("value") or "")

        raw_summary = str(raw_entry.get("summary") or raw_entry.get("description") or "")
        if not content_html:
            content_html = raw_summary
        elif len(raw_summary) > len(content_html):
            # Prefer richer body when summary is longer than stub content
            content_html = raw_summary

        plain_summary = strip_html(raw_summary or content_html)
        if len(plain_summary) > 500:
            plain_summary = plain_summary[:497].rstrip() + "..."

        # L1 Keyword Blacklist
        if matches_filter_rules(title, strip_html(content_html) + " " + plain_summary, rules):
            filtered += 1
            continue

        # L1 URL + Title Deduplication
        if db.entry_exists(
            feed_id=feed.id,
            canonical_url=canonical,
            guid=guid,
            normalized_title=norm_title,
        ):
            continue

        video_id = extract_youtube_video_id(raw_entry) if feed.feed_kind == "youtube" else None
        image_url = extract_entry_image(raw_entry, feed_image=feed_image, content_html=content_html)
        if video_id and not image_url:
            image_url = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

        audio_duration = format_duration(
            str(raw_entry.get("itunes_duration") or "")
        )
        author = str(raw_entry.get("author") or raw_entry.get("dc_creator") or "").strip() or None
        published_at = _parse_entry_timestamp(raw_entry)

        # For regular feeds, use published_at (clamped to now) so feed items stay chronological
        discovered_at = published_at if (published_at and published_at <= now_iso) else now_iso

        inserted_id = db.insert_entry(
            feed_id=feed.id,
            guid=guid,
            canonical_url=canonical,
            title=title,
            normalized_title=norm_title,
            url=link,
            author=author,
            summary=plain_summary or None,
            content_html=content_html or None,
            image_url=image_url,
            audio_url=audio_url,
            audio_duration=audio_duration,
            video_id=video_id,
            published_at=published_at,
            discovered_at=discovered_at,
        )
        if inserted_id is not None:
            added += 1

    # Update feed metadata if previously missing
    new_site_url = sanitize_http_url(str(feed_meta.get("link") or ""))
    new_title: str | None = None
    parsed_title = str(feed_meta.get("title") or "").strip()
    if parsed_title and feed.title in (feed.url, urlparse(feed.url).hostname or ""):
        new_title = parsed_title

    db.mark_feed_fetched(
        feed.id,
        error=None,
        title=new_title,
        site_url=new_site_url if not feed.site_url else None,
        icon_url=feed_image if not feed.icon_url else None,
    )
    return added, filtered


async def fetch_rss_feed(
    db: Database,
    feed: FeedOut,
    *,
    client: httpx.AsyncClient | None = None,
) -> tuple[int, int]:
    """Fetch a standard RSS/Atom/YouTube/Podcast feed over HTTP and persist entries."""
    async with managed_async_client(client, follow_redirects=True) as http_client:
        response = await http_client.get(feed.url, headers=FEED_HEADERS)
        if response.status_code in (403, 406, 429):
            fallback_headers = {**FEED_HEADERS, "User-Agent": FALLBACK_FEED_USER_AGENT}
            response = await http_client.get(feed.url, headers=fallback_headers)
        response.raise_for_status()
        xml_text = response.text

    return parse_rss_xml_into_db(db=db, feed=feed, xml_text=xml_text)


# ---------------------------------------------------------------------------
# Hacker News Algolia Adapter (threshold discovery timestamp + comments)
# ---------------------------------------------------------------------------


def parse_hn_min_points(feed: FeedOut) -> int:
    """Extract minimum points threshold from feed URL or config_json."""
    parsed = urlparse(feed.url)
    params = dict(parse_qsl(parsed.query))
    if "points" in params:
        try:
            return max(1, int(params["points"]))
        except ValueError:
            pass
    try:
        cfg = json.loads(feed.config_json or "{}")
        if isinstance(cfg, dict) and "min_points" in cfg:
            return max(1, int(cfg["min_points"]))
    except (ValueError, TypeError):
        pass
    return 100


async def fetch_hn_algolia_feed(
    db: Database,
    feed: FeedOut,
    *,
    client: httpx.AsyncClient | None = None,
) -> tuple[int, int]:
    """Fetch high-signal Hacker News stories from Algolia API.

    Solves the 21h timeline burial problem by setting `discovered_at` to NOW when
    a story first crosses `min_points`, while preserving original `published_at`.
    Re-fetches update points & comment counts without altering `discovered_at`.
    """
    min_points = parse_hn_min_points(feed)
    api_url = (
        f"https://hn.algolia.com/api/v1/search_by_date"
        f"?tags=story&numericFilters=points>={min_points}&hitsPerPage=50"
    )

    async with managed_async_client(client, follow_redirects=True) as http_client:
        response = await http_client.get(api_url, headers={"User-Agent": API_USER_AGENT})
        response.raise_for_status()
        payload = response.json()

    hits = payload.get("hits") or []
    rules = db.list_filter_rules()
    added = 0
    filtered = 0
    discovery_now = utc_now_iso()

    for hit in hits:
        hn_item_id = str(hit.get("objectID") or "").strip()
        if not hn_item_id:
            continue
        title = str(hit.get("title") or hit.get("story_title") or "").strip()
        if not title:
            continue

        story_url = sanitize_http_url(str(hit.get("url") or ""))
        if not story_url:
            story_url = f"https://news.ycombinator.com/item?id={hn_item_id}"

        story_text = str(hit.get("story_text") or "").strip()
        plain_story = strip_html(story_text)

        if matches_filter_rules(title, plain_story, rules):
            filtered += 1
            continue

        points = int(hit.get("points") or 0)
        comments_count = int(hit.get("num_comments") or 0)
        author = str(hit.get("author") or "").strip() or None
        published_at = str(hit.get("created_at") or "").strip() or None

        summary = (
            plain_story[:500]
            if plain_story
            else f"{points} points · {comments_count} comments on Hacker News"
        )
        content_html = story_text or (
            f'<p><a href="https://news.ycombinator.com/item?id={hn_item_id}">'
            f"Discuss on Hacker News ({points} points, {comments_count} comments)</a></p>"
        )

        is_new = db.upsert_hn_entry(
            feed_id=feed.id,
            hn_item_id=hn_item_id,
            canonical_url=canonicalize_url(story_url),
            title=title,
            normalized_title=normalize_title(title),
            url=story_url,
            author=author,
            summary=summary,
            content_html=content_html,
            hn_points=points,
            hn_comments_count=comments_count,
            published_at=published_at,
            discovered_at=discovery_now,
        )
        if is_new:
            added += 1

    db.mark_feed_fetched(feed.id, error=None)
    return added, filtered


def _parse_hn_comment_nodes(
    raw_children: list[dict[str, Any]],
    *,
    depth: int = 0,
    max_depth: int = 3,
    max_children: int = 10,
) -> list[HNComment]:
    if depth > max_depth:
        return []
    result: list[HNComment] = []
    for node in raw_children:
        if len(result) >= max_children:
            break
        text = node.get("text")
        author = node.get("author")
        if not text or not author:
            continue
        child_nodes = node.get("children") or []
        nested = (
            _parse_hn_comment_nodes(
                child_nodes,
                depth=depth + 1,
                max_depth=max_depth,
                max_children=max(3, max_children // 2),
            )
            if isinstance(child_nodes, list) and depth < max_depth
            else []
        )
        result.append(
            HNComment(
                id=str(node.get("id") or ""),
                author=str(author),
                text=str(text),
                created_at=str(node.get("created_at")) if node.get("created_at") else None,
                children=nested,
            )
        )
    return result


async def fetch_hn_comments(
    hn_item_id: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> list[HNComment]:
    """Fetch nested top comments for a Hacker News item via Algolia Items API."""
    api_url = f"https://hn.algolia.com/api/v1/items/{hn_item_id}"
    async with managed_async_client(client, follow_redirects=True) as http_client:
        response = await http_client.get(api_url, headers={"User-Agent": API_USER_AGENT})
        response.raise_for_status()
        payload = response.json()

    raw_children = payload.get("children") or []
    if not isinstance(raw_children, list):
        return []
    return _parse_hn_comment_nodes(raw_children)


# ---------------------------------------------------------------------------
# Unified Feed Refresh Dispatcher
# ---------------------------------------------------------------------------


async def refresh_feed(
    db: Database,
    feed: FeedOut,
    *,
    client: httpx.AsyncClient | None = None,
) -> tuple[int, int, str | None]:
    """Refresh a single feed by kind, recording any error cleanly on the feed row."""
    try:
        if feed.feed_kind == "hn_algolia" or feed.url.startswith("algolia://"):
            added, filtered = await fetch_hn_algolia_feed(db, feed, client=client)
        else:
            added, filtered = await fetch_rss_feed(db, feed, client=client)
        return added, filtered, None
    except Exception as exc:
        err_msg = str(exc) or exc.__class__.__name__
        db.mark_feed_fetched(feed.id, error=err_msg)
        return 0, 0, err_msg


# ---------------------------------------------------------------------------
# Full-text Extraction (Trafilatura with graceful fallback)
# ---------------------------------------------------------------------------


async def extract_entry_full_text(
    db: Database,
    entry: EntryOut,
    *,
    client: httpx.AsyncClient | None = None,
) -> EntryOut:
    """Extract clean article full text using Trafilatura with graceful paywall/error fallback."""
    fallback_text = strip_html(entry.content_html or entry.summary)
    extracted: str | None = None
    failure_note: str | None = None

    try:
        current_url = validate_public_http_url(entry.url)
        async with managed_async_client(client, follow_redirects=False) as http_client:
            response: httpx.Response | None = None
            for hop in range(MAX_REDIRECTS + 1):
                resp = await http_client.get(
                    current_url,
                    headers=HTML_HEADERS,
                    follow_redirects=False,
                )
                if resp.status_code in (301, 302, 303, 307, 308):
                    location = resp.headers.get("location")
                    if not location or hop == MAX_REDIRECTS:
                        break
                    current_url = validate_public_http_url(urljoin(current_url, location))
                    continue
                response = resp
                break

            if response is None:
                failure_note = "Too many redirects while fetching article."
            elif response.status_code in (401, 402, 403, 451):
                failure_note = (
                    f"Source blocked automated extraction (HTTP {response.status_code}, "
                    "likely paywalled or anti-bot protected)."
                )
            else:
                response.raise_for_status()
                extracted = trafilatura.extract(
                    response.text,
                    url=current_url,
                    include_comments=False,
                    include_tables=True,
                )
    except ProxyError as exc:
        failure_note = f"Extraction skipped for safety: {exc.detail}"
    except Exception as exc:
        failure_note = f"Could not fetch article for full-text extraction ({exc})."

    if extracted and extracted.strip():
        final_text = extracted.strip()
    elif fallback_text:
        prefix = f"[{failure_note} Showing RSS feed content below.]\n\n" if failure_note else ""
        final_text = f"{prefix}{fallback_text}"
    else:
        final_text = failure_note or "Full-text extraction returned no readable content."

    updated = db.update_entry(entry.id, extracted_text=final_text)
    return updated if updated is not None else entry
