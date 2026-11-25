"""Application configuration loaded from environment variables and optional .env files."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

APP_VERSION = "0.1.0"
BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
DEFAULT_DB_PATH = str(BACKEND_DIR / "data" / "rss_reader.db")


class Settings(BaseSettings):
    """Runtime settings configurable via environment variables."""

    model_config = SettingsConfigDict(
        env_file=(str(REPO_ROOT / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    rss_db_path: str = DEFAULT_DB_PATH
    rss_auto_refresh_minutes: int = 30

    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"

    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"

    rsshub_base_url: str = "http://localhost:1200"
    notebooklm_default_id: str | None = None

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

    @property
    def ai_configured(self) -> bool:
        return bool(
            (self.gemini_api_key and self.gemini_api_key.strip())
            or (self.openai_api_key and self.openai_api_key.strip())
        )


def get_settings() -> Settings:
    """Return current settings reflecting live environment variables."""
    return Settings()
