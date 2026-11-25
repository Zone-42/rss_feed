import DOMPurify from 'dompurify';
import { TIMESTAMP_PATTERN, parseTimestampToSeconds } from './time';

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{6,20}$/;

const FORBID_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'textarea',
  'select',
  'button',
  'meta',
  'link',
  'base',
];

const FORBID_ATTR = [
  'onerror',
  'onload',
  'onclick',
  'onmouseover',
  'onfocus',
  'onblur',
  'style',
];

/**
 * Validate and return a safe `http://` or `https://` URL, rejecting `javascript:`, `data:`, `file:`, etc.
 */
export function getSafeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Route external http/https image URLs through the backend SSRF-safe image proxy.
 */
export function getProxiedImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('/api/image-proxy')) return trimmed;
  const safe = getSafeHttpUrl(trimmed);
  if (safe) {
    return `/api/image-proxy?url=${encodeURIComponent(safe)}`;
  }
  return null;
}

export function isValidYouTubeVideoId(id: string | null | undefined): id is string {
  return typeof id === 'string' && YOUTUBE_ID_RE.test(id.trim());
}

export function extractYouTubeVideoId(input: {
  video_id?: string | null;
  url?: string | null;
}): string | null {
  if (isValidYouTubeVideoId(input.video_id)) {
    return input.video_id.trim();
  }
  if (!input.url) return null;
  try {
    const parsed = new URL(input.url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const candidate = parsed.pathname.slice(1).split('/')[0];
      return isValidYouTubeVideoId(candidate) ? candidate : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      const v = parsed.searchParams.get('v');
      if (isValidYouTubeVideoId(v)) return v;
      const parts = parsed.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && isValidYouTubeVideoId(parts[1])) {
        return parts[1];
      }
    }
  } catch {
    return null;
  }
  return null;
}

export interface SanitizeOptions {
  proxyImages?: boolean;
  linkifyTimestamps?: boolean;
}

function linkifyTimestampsInNode(doc: Document, root: Node): void {
  const skippedTags = new Set(['A', 'CODE', 'PRE', 'SCRIPT', 'STYLE']);

  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (skippedTags.has(el.tagName)) return;
      // Copy children list because we may replace text nodes
      const children = Array.from(node.childNodes);
      for (const child of children) {
        walk(child);
      }
      return;
    }

    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent ?? '';
    const regex = new RegExp(TIMESTAMP_PATTERN.source, 'g');
    if (!regex.test(text)) return;

    regex.lastIndex = 0;
    const fragment = doc.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const label = match[1];
      const matchStart = match.index;
      // Avoid ISO date-time substrings like "2026-11-25 12:30:00"
      const preceding = text.slice(Math.max(0, matchStart - 12), matchStart);
      if (/\d{4}-\d{2}-\d{2}\s+$/.test(preceding)) {
        continue;
      }

      const seconds = parseTimestampToSeconds(label);
      if (seconds === null) continue;

      if (matchStart > lastIndex) {
        fragment.appendChild(doc.createTextNode(text.slice(lastIndex, matchStart)));
      }

      const anchor = doc.createElement('a');
      anchor.setAttribute('href', `#seek-${seconds}`);
      anchor.setAttribute('data-seek-seconds', String(seconds));
      anchor.setAttribute('class', 'timestamp-link');
      anchor.setAttribute('title', `跳转到 ${label}`);
      anchor.textContent = label;
      fragment.appendChild(anchor);

      lastIndex = matchStart + label.length;
    }

    if (lastIndex === 0) return;
    if (lastIndex < text.length) {
      fragment.appendChild(doc.createTextNode(text.slice(lastIndex)));
    }
    node.parentNode?.replaceChild(fragment, node);
  };

  walk(root);
}

/**
 * Sanitize untrusted HTML with DOMPurify, harden external links,
 * optionally route images through `/api/image-proxy`, and optionally auto-link timestamps.
 */
export function sanitizeHtml(
  dirtyHtml: string | null | undefined,
  options: SanitizeOptions = {},
): string {
  if (!dirtyHtml) return '';

  const initialClean = DOMPurify.sanitize(dirtyHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    FORBID_ATTR,
  });

  if (typeof DOMParser === 'undefined') {
    return initialClean;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(initialClean, 'text/html');

  // Harden anchors
  doc.querySelectorAll('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    }
  });

  // Harden & optionally proxy images
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (src && options.proxyImages && /^https?:\/\//i.test(src)) {
      const proxied = getProxiedImageUrl(src);
      if (proxied) img.setAttribute('src', proxied);
    }
    img.setAttribute('loading', 'lazy');
    img.setAttribute('referrerpolicy', 'no-referrer');
  });

  if (options.linkifyTimestamps) {
    linkifyTimestampsInNode(doc, doc.body);
  }

  // Final DOMPurify pass guarantees strict sanitization even after DOM transforms
  return DOMPurify.sanitize(doc.body.innerHTML, {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    FORBID_ATTR,
    ADD_ATTR: ['target', 'rel', 'data-seek-seconds', 'loading', 'referrerpolicy'],
  });
}

/**
 * Convert plain text (e.g. trafilatura extracted_text or plain shownotes) to safe paragraphs.
 */
export function plainTextToSanitizedHtml(
  text: string | null | undefined,
  options: SanitizeOptions = {},
): string {
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const paragraphs = escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, '<br />')}</p>`)
    .join('');
  return sanitizeHtml(paragraphs, options);
}
