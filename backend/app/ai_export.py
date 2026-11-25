"""On-demand AI summarization, Weekly Batch-Packed Markdown export, NotebookLM push, and OPML."""

from __future__ import annotations

import asyncio
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import Settings
from app.db import Database, utc_now_iso
from app.fetchers import is_youtube_url, sanitize_http_url, strip_html
from app.models import (
    EntryOut,
    ExportMarkdownRequest,
    ExportMarkdownResponse,
    ExportNotebookLMRequest,
    ExportNotebookLMResponse,
    FeedOut,
    OpmlImportResponse,
    SummarizeResponse,
)

NOTEBOOKLM_SAFE_WORD_LIMIT = 400_000
MAX_AI_INPUT_CHARS = 16_000

_WORD_OR_CJK_RE = re.compile(
    r"[A-Za-z0-9_'-]+|[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]"
)
_FILENAME_SLUG_RE = re.compile(r"[^a-zA-Z0-9_-]+")


class AIConfigError(Exception):
    """Raised when no AI provider key is configured."""


class AIProviderError(Exception):
    """Raised when the upstream AI provider fails."""


def find_nlm_binary() -> str | None:
    """Return path to `nlm` CLI if installed on PATH."""
    return shutil.which("nlm")


def count_words(text: str) -> int:
    """Count English/alphanumeric words plus CJK characters for NotebookLM sizing."""
    return len(_WORD_OR_CJK_RE.findall(text))


# ---------------------------------------------------------------------------
# On-demand AI Summary
# ---------------------------------------------------------------------------


def _build_summary_prompt(entry: EntryOut) -> str:
    body = entry.extracted_text or strip_html(entry.content_html) or entry.summary or ""
    body = body.strip()[:MAX_AI_INPUT_CHARS]
    return (
        "You are a concise research analyst summarizing an item from a personal RSS reader.\n"
        "Respond in clear Markdown with:\n"
        "1. **One-line takeaway**\n"
        "2. **Key points** (3-5 concise bullets)\n"
        "3. **Why it matters** (1-2 sentences)\n"
        "Match the language of the source article (or use concise bilingual terms if helpful).\n\n"
        f"Title: {entry.title}\n"
        f"Source: {entry.feed_title}\n"
        f"URL: {entry.url}\n"
        f"Content:\n{body or '(No body text available — summarize based on title and metadata.)'}"
    )


async def _call_gemini(
    prompt: str,
    *,
    api_key: str,
    model: str,
    client: httpx.AsyncClient | None = None,
) -> str:
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    owns_client = client is None
    http_client = httpx.AsyncClient(timeout=45.0) if client is None else client
    try:
        response = await http_client.post(
            endpoint,
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
            },
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.2},
            },
        )
        response.raise_for_status()
        data: dict[str, Any] = response.json()
    except httpx.HTTPError as exc:
        raise AIProviderError(f"Gemini API request failed: {exc}") from exc
    finally:
        if owns_client:
            await http_client.aclose()

    candidates = data.get("candidates") or []
    if candidates:
        parts = (candidates[0].get("content") or {}).get("parts") or []
        texts = [str(p.get("text") or "") for p in parts if isinstance(p, dict)]
        joined = "\n".join(t for t in texts if t).strip()
        if joined:
            return joined
    raise AIProviderError("Gemini API returned an empty summary response")


async def _call_openai_compatible(
    prompt: str,
    *,
    api_key: str,
    base_url: str,
    model: str,
    client: httpx.AsyncClient | None = None,
) -> str:
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    owns_client = client is None
    http_client = httpx.AsyncClient(timeout=45.0) if client is None else client
    try:
        response = await http_client.post(
            endpoint,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": model,
                "temperature": 0.2,
                "messages": [
                    {
                        "role": "system",
                        "content": "You produce concise, high-signal Markdown summaries.",
                    },
                    {"role": "user", "content": prompt},
                ],
            },
        )
        response.raise_for_status()
        data: dict[str, Any] = response.json()
    except httpx.HTTPError as exc:
        raise AIProviderError(f"OpenAI-compatible API request failed: {exc}") from exc
    finally:
        if owns_client:
            await http_client.aclose()

    choices = data.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        content = str(message.get("content") or "").strip()
        if content:
            return content
    raise AIProviderError("OpenAI-compatible API returned an empty summary response")


async def summarize_entry(
    db: Database,
    entry: EntryOut,
    settings: Settings,
    *,
    force: bool = False,
    client: httpx.AsyncClient | None = None,
) -> SummarizeResponse:
    """Return a cached or freshly generated AI summary for an entry."""
    if entry.ai_summary and not force:
        cached_model = db.get_entry_ai_model(entry.id) or "cached"
        return SummarizeResponse(
            ai_summary=entry.ai_summary,
            model=cached_model,
            cached=True,
        )

    gemini_key = (settings.gemini_api_key or "").strip()
    openai_key = (settings.openai_api_key or "").strip()

    if not gemini_key and not openai_key:
        raise AIConfigError(
            "AI summarization is not configured. Set GEMINI_API_KEY (recommended, "
            "default model: gemini-2.5-flash) or OPENAI_API_KEY in your .env file "
            "and restart the backend server."
        )

    prompt = _build_summary_prompt(entry)
    if gemini_key:
        model = settings.gemini_model.strip() or "gemini-2.5-flash"
        summary_text = await _call_gemini(
            prompt,
            api_key=gemini_key,
            model=model,
            client=client,
        )
    else:
        model = settings.openai_model.strip() or "gpt-4o-mini"
        summary_text = await _call_openai_compatible(
            prompt,
            api_key=openai_key,
            base_url=settings.openai_base_url,
            model=model,
            client=client,
        )

    db.update_entry(entry.id, ai_summary=summary_text, ai_model=model)
    return SummarizeResponse(
        ai_summary=summary_text,
        model=model,
        cached=False,
    )


# ---------------------------------------------------------------------------
# Weekly Batch-Packed Markdown Export (Obsidian + NotebookLM 400k-word cap)
# ---------------------------------------------------------------------------


def _safe_yaml_str(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")
    return f'"{escaped}"'


def _build_export_filename(title: str) -> str:
    date_prefix = datetime.now(UTC).strftime("%Y-%m-%d")
    slug = _FILENAME_SLUG_RE.sub("-", title.lower()).strip("-")[:48] or "rss-digest"
    return f"{date_prefix}-{slug}.md"


def build_packed_markdown(
    db: Database,
    req: ExportMarkdownRequest,
) -> ExportMarkdownResponse:
    """Pack selected entries into a single Obsidian & NotebookLM-ready Markdown file."""
    entries = db.list_entries_for_export(
        entry_ids=req.entry_ids,
        starred_only=req.starred_only,
        view_type=req.view_type,
        days=req.days,
    )

    date_str = datetime.now(UTC).strftime("%Y-%m-%d")
    export_title = (req.title or "").strip() or f"RSS Weekly Digest ({date_str})"
    exported_at = utc_now_iso()

    body_sections: list[str] = []
    for idx, entry in enumerate(entries, start=1):
        meta_lines = [
            f"- **Source**: {entry.feed_title}",
            f"- **View**: `{entry.view_type}`",
            f"- **URL**: {entry.url}",
        ]
        if entry.author:
            meta_lines.append(f"- **Author**: {entry.author}")
        if entry.published_at:
            meta_lines.append(f"- **Published**: {entry.published_at}")
        meta_lines.append(f"- **Discovered**: {entry.discovered_at}")
        if entry.hn_points is not None:
            meta_lines.append(
                f"- **Hacker News**: {entry.hn_points} points, "
                f"{entry.hn_comments_count or 0} comments "
                f"(https://news.ycombinator.com/item?id={entry.hn_item_id})"
            )
        if entry.video_id:
            meta_lines.append(f"- **YouTube Video**: https://www.youtube.com/watch?v={entry.video_id}")
        if entry.audio_url:
            dur = f" ({entry.audio_duration})" if entry.audio_duration else ""
            meta_lines.append(f"- **Audio**: {entry.audio_url}{dur}")

        section_parts = [
            f"## {idx}. {entry.title}",
            "",
            "\n".join(meta_lines),
            "",
        ]
        if entry.ai_summary:
            section_parts.extend(["### AI Summary", "", entry.ai_summary.strip(), ""])

        main_text = (
            (entry.extracted_text or "").strip()
            or strip_html(entry.content_html)
            or (entry.summary or "").strip()
        )
        if main_text:
            section_parts.extend(["### Content", "", main_text, ""])

        section_parts.append("---")
        body_sections.append("\n".join(section_parts))

    body_markdown = "\n\n".join(body_sections) if body_sections else "_No matching entries found._"

    # Compute word count including title and body, then assemble YAML frontmatter
    preliminary_markdown = f"# {export_title}\n\n{body_markdown}\n"
    word_count = count_words(preliminary_markdown)
    within_limit = word_count <= NOTEBOOKLM_SAFE_WORD_LIMIT

    frontmatter_lines = [
        "---",
        f"title: {_safe_yaml_str(export_title)}",
        f"exported_at: {_safe_yaml_str(exported_at)}",
        f"entry_count: {len(entries)}",
        f"word_count: {word_count}",
        f"notebooklm_safe_limit: {NOTEBOOKLM_SAFE_WORD_LIMIT}",
        f"within_notebooklm_limit: {'true' if within_limit else 'false'}",
        f"view_filter: {_safe_yaml_str(req.view_type or 'all')}",
        f"starred_only: {'true' if req.starred_only else 'false'}",
        "tags:",
        "  - rss-digest",
        "  - notebooklm-batch",
        "---",
    ]

    full_markdown = "\n".join(frontmatter_lines) + "\n\n" + preliminary_markdown
    final_word_count = count_words(full_markdown)

    return ExportMarkdownResponse(
        filename=_build_export_filename(export_title),
        markdown=full_markdown,
        entry_count=len(entries),
        word_count=final_word_count,
        safe_limit=NOTEBOOKLM_SAFE_WORD_LIMIT,
        within_limit=final_word_count <= NOTEBOOKLM_SAFE_WORD_LIMIT,
    )


async def push_to_notebooklm(
    db: Database,
    req: ExportNotebookLMRequest,
    settings: Settings,
) -> ExportNotebookLMResponse:
    """Pack matching entries into Markdown and push to NotebookLM via `nlm` CLI if installed."""
    md_export = build_packed_markdown(
        db,
        ExportMarkdownRequest(
            entry_ids=req.entry_ids,
            starred_only=req.starred_only,
            view_type=req.view_type,
            days=req.days,
            title=req.title,
        ),
    )

    nlm_bin = find_nlm_binary()
    if not nlm_bin:
        return ExportNotebookLMResponse(
            status="unavailable",
            message=(
                "NotebookLM CLI (`nlm`) is not installed on PATH. Download the packed "
                "Markdown file and upload it manually to NotebookLM."
            ),
            filename=md_export.filename,
            word_count=md_export.word_count,
        )

    notebook_id = (req.notebook_id or settings.notebooklm_default_id or "").strip()
    if not notebook_id:
        return ExportNotebookLMResponse(
            status="error",
            message="A NotebookLM notebook_id is required (or set NOTEBOOKLM_DEFAULT_ID in .env).",
            filename=md_export.filename,
            word_count=md_export.word_count,
        )

    if not md_export.within_limit:
        return ExportNotebookLMResponse(
            status="error",
            message=(
                f"Packed digest has {md_export.word_count:,} words, exceeding NotebookLM's "
                f"{NOTEBOOKLM_SAFE_WORD_LIMIT:,}-word safe limit. "
                "Narrow your date range or selection."
            ),
            filename=md_export.filename,
            word_count=md_export.word_count,
        )

    if md_export.entry_count == 0:
        return ExportNotebookLMResponse(
            status="error",
            message="No entries matched the selected export filters.",
            filename=md_export.filename,
            word_count=md_export.word_count,
        )

    export_title = (req.title or "").strip() or md_export.filename.removesuffix(".md")

    def _run_nlm_upload() -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(prefix="rss-nlm-") as tmp_dir:
            tmp_path = Path(tmp_dir) / md_export.filename
            tmp_path.write_text(md_export.markdown, encoding="utf-8")
            return subprocess.run(
                [
                    nlm_bin,
                    "source",
                    "add",
                    notebook_id,
                    "--file",
                    str(tmp_path),
                    "--title",
                    export_title,
                ],
                capture_output=True,
                text=True,
                timeout=90,
                check=False,
            )

    try:
        proc = await asyncio.to_thread(_run_nlm_upload)
    except subprocess.TimeoutExpired:
        return ExportNotebookLMResponse(
            status="error",
            message="Timed out while pushing source to NotebookLM via `nlm` CLI.",
            filename=md_export.filename,
            word_count=md_export.word_count,
        )
    except OSError as exc:
        return ExportNotebookLMResponse(
            status="error",
            message=f"Failed to execute `nlm` CLI: {exc}",
            filename=md_export.filename,
            word_count=md_export.word_count,
        )

    if proc.returncode != 0:
        err_output = (proc.stderr or proc.stdout or "").strip() or "unknown error"
        return ExportNotebookLMResponse(
            status="error",
            message=f"`nlm` CLI exited with code {proc.returncode}: {err_output}",
            filename=md_export.filename,
            word_count=md_export.word_count,
        )

    return ExportNotebookLMResponse(
        status="pushed",
        message=(
            f"Pushed {md_export.entry_count} entries ({md_export.word_count:,} words) "
            f"to NotebookLM notebook {notebook_id}."
        ),
        filename=md_export.filename,
        word_count=md_export.word_count,
    )


# ---------------------------------------------------------------------------
# OPML 2.0 Export & Import
# ---------------------------------------------------------------------------


def export_opml(feeds: list[FeedOut]) -> str:
    """Serialize all subscribed feeds into an OPML 2.0 XML document grouped by category."""
    opml = ET.Element("opml", {"version": "2.0"})
    head = ET.SubElement(opml, "head")
    title_el = ET.SubElement(head, "title")
    title_el.text = "Personal RSS Reader Subscriptions"
    date_el = ET.SubElement(head, "dateCreated")
    date_el.text = utc_now_iso()

    body = ET.SubElement(opml, "body")

    grouped: dict[str, list[FeedOut]] = {}
    for feed in feeds:
        cat = feed.category or "General"
        grouped.setdefault(cat, []).append(feed)

    for category, cat_feeds in grouped.items():
        folder = ET.SubElement(body, "outline", {"text": category, "title": category})
        for feed in cat_feeds:
            attrs: dict[str, str] = {
                "type": "rss",
                "text": feed.title,
                "title": feed.title,
                "xmlUrl": feed.url,
                "viewType": feed.view_type,
                "feedKind": feed.feed_kind,
            }
            if feed.site_url:
                attrs["htmlUrl"] = feed.site_url
            ET.SubElement(folder, "outline", attrs)

    ET.indent(opml, space="  ")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(opml, encoding="unicode")


def _infer_kind_and_view_from_url(
    url: str,
    explicit_view: str | None = None,
    explicit_kind: str | None = None,
) -> tuple[str, str]:
    if url.startswith("algolia://"):
        return explicit_kind or "hn_algolia", explicit_view or "hn"
    if is_youtube_url(url):
        return explicit_kind or "youtube", explicit_view or "video"
    if "rsshub" in url.lower():
        return explicit_kind or "rsshub", explicit_view or "social"
    if explicit_view == "audio" or explicit_kind == "podcast":
        return explicit_kind or "podcast", explicit_view or "audio"
    return explicit_kind or "rss", explicit_view or "article"


def import_opml(opml_xml: str, db: Database) -> OpmlImportResponse:
    """Import feeds from an OPML XML string into the database (idempotent)."""
    try:
        root = ET.fromstring(opml_xml.strip())
    except ET.ParseError as exc:
        raise ValueError(f"Malformed OPML XML: {exc}") from exc

    body = root.find("body")
    if body is None:
        raise ValueError("OPML document is missing a <body> element")

    added = 0
    skipped = 0

    def _walk(parent: ET.Element, current_category: str) -> None:
        nonlocal added, skipped
        for outline in parent.findall("outline"):
            xml_url = (
                outline.attrib.get("xmlUrl")
                or outline.attrib.get("xmlurl")
                or outline.attrib.get("url")
                or ""
            ).strip()
            label = (
                outline.attrib.get("title")
                or outline.attrib.get("text")
                or ""
            ).strip()

            if xml_url:
                parsed = urlparse(xml_url)
                if parsed.scheme.lower() not in ("http", "https", "algolia"):
                    skipped += 1
                    continue
                if db.get_feed_by_url(xml_url) is not None:
                    skipped += 1
                    continue

                html_url = sanitize_http_url(
                    outline.attrib.get("htmlUrl") or outline.attrib.get("htmlurl") or ""
                )
                view_attr = outline.attrib.get("viewType") or None
                kind_attr = outline.attrib.get("feedKind") or None
                feed_kind, view_type = _infer_kind_and_view_from_url(
                    xml_url,
                    explicit_view=view_attr,
                    explicit_kind=kind_attr,
                )
                title = label or (parsed.hostname or xml_url)
                db.create_feed(
                    title=title,
                    url=xml_url,
                    site_url=html_url,
                    view_type=view_type,
                    feed_kind=feed_kind,
                    category=current_category or "General",
                )
                added += 1
            else:
                next_cat = label or current_category
                _walk(outline, next_cat)

    _walk(body, "General")
    return OpmlImportResponse(added=added, skipped=skipped, feeds=db.list_feeds())
