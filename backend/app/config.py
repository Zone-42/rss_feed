"""Application configuration loaded from environment variables and optional .env files."""

from __future__ import annotations

from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_VERSION = "0.3.1"
BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
DEFAULT_DB_PATH = str(BACKEND_DIR / "data" / "rss_reader.db")

FakeIPPolicy = Literal["auto", "always", "never"]
SUPPORTED_PROXY_SCHEMES = frozenset({"http", "https", "socks5", "socks5h"})


def normalize_proxy_url(raw_url: str | None) -> str | None:
    """Validate and normalize a proxy URL setting.

    Returns ``None`` when empty, ``"direct"`` when set to ``direct`` or ``none``
    (case-insensitive), or the stripped URL when it uses a supported scheme.
    Raises ``ValueError`` on unsupported schemes or missing hostnames.
    """
    raw = (raw_url or "").strip()
    if not raw:
        return None
    if raw.lower() in ("direct", "none"):
        return "direct"

    parsed = urlparse(raw)
    scheme = parsed.scheme.lower()
    if scheme not in SUPPORTED_PROXY_SCHEMES:
        supported = ", ".join(sorted(SUPPORTED_PROXY_SCHEMES))
        raise ValueError(
            f"Unsupported RSS_PROXY_URL scheme '{parsed.scheme or 'none'}'. "
            f"Supported schemes: {supported}, or 'direct'."
        )
    if not parsed.hostname:
        raise ValueError(f"RSS_PROXY_URL must include a valid hostname: '{raw}'")
    return raw


class Settings(BaseSettings):
    """Runtime settings configurable via environment variables."""

    model_config = SettingsConfigDict(
        env_file=(str(REPO_ROOT / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    rss_db_path: str = DEFAULT_DB_PATH
    rss_auto_refresh_minutes: int = 30
    rss_proxy_url: str | None = None
    rss_allow_fake_ip_dns: FakeIPPolicy = "auto"

    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"

    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"

    rsshub_base_url: str = "http://localhost:1200"
    notebooklm_default_id: str | None = None

    @field_validator("rss_allow_fake_ip_dns", mode="before")
    @classmethod
    def _normalize_fake_ip_policy(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value

    def resolved_db_path(self) -> str:
        """Resolve DB path reliably whether launched from repo root or backend/."""
        raw = self.rss_db_path.strip()
        if raw == ":memory:" or raw.startswith("file:"):
            return raw
        path = Path(raw)
        if path.is_absolute():
            return str(path)
        if raw.startswith("backend/"):
            return str((REPO_ROOT / path).resolve())
        return str(path.resolve())

    def resolved_proxy_url(self) -> str | None:
        """Return normalized proxy URL, 'direct', or None for system/env auto-detection."""
        return normalize_proxy_url(self.rss_proxy_url)

    @property
    def ai_configured(self) -> bool:
        return bool(
            (self.gemini_api_key and self.gemini_api_key.strip())
            or (self.openai_api_key and self.openai_api_key.strip())
        )


def get_settings() -> Settings:
    """Return current settings reflecting live environment variables."""
    return Settings()
