"""Shared pytest fixtures isolating proxy environment variables and DNS canary caches."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from app.fetchers import reset_dns_canary_caches

_PROXY_ENV_KEYS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
)


@pytest.fixture(autouse=True)
def isolate_proxy_and_dns_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Ensure deterministic proxy & canary DNS state on macOS (Surge/Sing-box) and Linux CI."""
    for key in _PROXY_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("RSS_PROXY_URL", "")
    monkeypatch.setenv("RSS_ALLOW_FAKE_IP_DNS", "auto")
    monkeypatch.setattr("urllib.request.getproxies_macosx_sysconf", lambda: {}, raising=False)
    monkeypatch.setattr("app.fetchers._resolve_canary_ips", lambda _domain: ["93.184.216.34"])
    reset_dns_canary_caches()
    yield
    reset_dns_canary_caches()
