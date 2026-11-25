# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-11-25

### Fixed
- **SOCKS5 Proxy & Centralized HTTP Client**:
  - Added native SOCKS5 proxy support (`httpx[socks]` / `socksio`), centralized `RSS_PROXY_URL` configuration (`http`/`https`/`socks5`/`socks5h`/`direct`), and automatic localhost proxy bypass (`localhost`, `127.0.0.1`, `[::1]`) for local RSSHub/Ollama services.
- **SSRF Validation & Fake-IP Compatibility**:
  - Hardened SSRF URL validation (IDNA normalization, obfuscated IPv4 detection, internal/rebinding hostname blocking) with safe `RSS_ALLOW_FAKE_IP_DNS` (`auto`/`always`/`never`) compatibility for macOS Surge/Sing-box/Clash Fake-IP environments.
- **Feed Fetcher Resilience & Performance**:
  - Upgraded feed fetcher headers (browser-compatible User-Agent + `Accept-Language` + 403/406/429 fallback retry) fixing Reuters/Google News rate-limiting, and added pooled concurrent feed refreshes.
- **Feed Error Visibility & Recovery UX**:
  - Added visible collapsible `FeedErrorBanner` (with grouped error causes, actionable proxy hints, copy & retry), interactive Sidebar error badges, error-aware empty states, and accurate error/warning toasts on refresh failures.

### Changed
- Documented `RSS_PROXY_URL` and `RSS_ALLOW_FAKE_IP_DNS` in `.env.example`, `README.md`, and `deploy/docker-compose.yml`.

## [0.3.0] - 2026-11-25

### Changed
- **Task Runner Migration (`Makefile` → `justfile`)**:
  - Replaced `Makefile` with an idiomatic `justfile` using `bash -euo pipefail`, `dotenv-load`, `[working-directory(...)]`, and grouped recipes (`setup`, `dev`, `quality`, `maintenance`).
  - Added granular and composite recipes: `install` (`install-backend` using `uv sync --group dev`, `install-frontend`), `dev` (`dev-backend`, `dev-frontend`), `lint` (`lint-backend` covering `ruff` + `mypy app tests`, `lint-frontend`), `test` (`test-backend`, `test-frontend`), `build`, `check` (`lint` + `test` + `build`), and `clean` (safe cache/build cleanup preserving SQLite data).
  - Updated `README.md` with `just` commands, recipes table, and quick install note (`brew install just`).
  - Updated GitHub Actions `repo-checks` job in `.github/workflows/ci.yml` to install `just` (`extractions/setup-just@v3`) and validate `justfile` via `just --list --unsorted` and `just --evaluate`.

## [0.2.0] - 2026-11-25

### Added
- **GitHub Actions CI Pipeline (`.github/workflows/ci.yml`)**:
  - Added automated CI workflow triggered on `push` / `pull_request` to `main` and `workflow_dispatch`, with read-only `contents: read` permissions and branch concurrency cancellation.
  - **Backend job** (Python 3.11 + `uv` with lockfile caching): runs `uv sync --frozen --group dev`, `ruff check .`, `mypy app tests`, and `pytest -v`.
  - **Frontend job** (Node.js 22 + `pnpm` v10 with lockfile caching): runs `pnpm install --frozen-lockfile`, ESLint, TypeScript `tsc --noEmit`, Vitest unit tests, production Vite build, and uploads `frontend/dist` artifact (7-day retention).
  - **Repository checks job**: validates `start.sh` shell syntax (`bash -n`) and YAML validity of `deploy/docker-compose.yml` and `.github/workflows/ci.yml`.

## [0.1.0] - 2026-11-25

### Added
- **Local MVP Backend (FastAPI + SQLite)**:
  - Multi-source feed management with curated 2026 starter pack (Bloomberg, WSJ, FT, Reuters, CNBC, TechCrunch, The Verge, Ars Technica, Hacker News Algolia, YouTube, Podcasts).
  - Hacker News Algolia threshold adapter (`discovered_at` anti-delay timestamping + nested top comments).
  - YouTube smart URL resolver (`@handle` resolution + `UULF` Shorts exclusion).
  - Podcast enclosure parser and live iTunes Search discovery proxy.
  - L1 noise reduction pipeline (URL canonicalization, deduplication, keyword blacklist rules).
  - On-demand full-text extraction (`trafilatura`) and cached AI summaries (Gemini / OpenAI-compatible).
  - SSRF-hardened `/api/image-proxy` for external/social media images.
  - OPML import/export and Weekly Batch-Packed Markdown export with 400k-word NotebookLM cap tracking and optional `nlm` CLI push.
- **Local MVP Frontend (React + TypeScript + Tailwind CSS + Vite)**:
  - Folo-inspired 3-pane responsive layout with dark/light theme toggle and keyboard shortcuts (`j`/`k`/`s`/`m`/`o`).
  - Adaptive views for Articles, Hacker News, YouTube Videos (nocookie embed), Podcasts (clickable `MM:SS`/`HH:MM:SS` Shownotes timestamps), Social feeds, and Starred items.
  - Global persistent bottom audio player synced to backend playback progress.
  - DOMPurify HTML sanitization for all rendered feed content.
  - Modals for multi-source Add Feed, L1 Filters, and NotebookLM/Obsidian batch export.
- **Developer Experience & Deployment**:
  - One-command local launcher (`./start.sh`) and `Makefile` workflow (`install`, `dev`, `build`, `test`, `lint`).
  - Phase 2 VPS Docker Compose production template (`deploy/docker-compose.yml`) with PostgreSQL 16 (`pgvector`), Miniflux, ReactFlux, RSSHub, Redis 8, Browserless Chromium, and Cloudflare Tunnel.
  - Bilingual (CN/EN) documentation in `README.md`.
