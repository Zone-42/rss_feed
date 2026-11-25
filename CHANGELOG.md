# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
