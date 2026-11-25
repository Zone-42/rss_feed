import { describe, expect, it } from 'vitest';
import {
  extractYouTubeVideoId,
  getProxiedImageUrl,
  getSafeHttpUrl,
  isValidYouTubeVideoId,
  sanitizeHtml,
} from '../utils/sanitize';

describe('sanitizeHtml & media safety', () => {
  it('strips XSS payloads (script, event handlers, javascript links, iframes)', () => {
    const malicious = `
      <p>Safe text</p>
      <script>alert('xss')</script>
      <img src="https://example.com/a.jpg" onerror="alert(1)" />
      <a href="javascript:alert(2)">click</a>
      <iframe src="https://evil.example/embed"></iframe>
    `;
    const clean = sanitizeHtml(malicious);
    expect(clean).toContain('Safe text');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('javascript:');
    expect(clean).not.toContain('<iframe');
  });

  it('hardens external links and proxies images when proxyImages is enabled', () => {
    const html = `
      <p><a href="https://example.com/post">Read</a></p>
      <img src="https://cdn.example.com/pic.png" alt="pic" />
    `;
    const clean = sanitizeHtml(html, { proxyImages: true });
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).toContain(
      '/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fpic.png',
    );
  });

  it('validates safe http/https URLs and rejects javascript/data/file schemes', () => {
    expect(getSafeHttpUrl('https://example.com/article?id=1')).toBe(
      'https://example.com/article?id=1',
    );
    expect(getSafeHttpUrl('http://localhost:8000/feed')).toBe('http://localhost:8000/feed');
    expect(getSafeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(getSafeHttpUrl('  JAVASCRIPT:alert(1)')).toBeNull();
    expect(getSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(getSafeHttpUrl('file:///etc/passwd')).toBeNull();
    expect(getSafeHttpUrl('not a url')).toBeNull();
    expect(getSafeHttpUrl(null)).toBeNull();
  });

  it('builds safe proxied image URLs only for http/https', () => {
    expect(getProxiedImageUrl('https://img.example.com/1.jpg')).toBe(
      '/api/image-proxy?url=https%3A%2F%2Fimg.example.com%2F1.jpg',
    );
    expect(getProxiedImageUrl('javascript:alert(1)')).toBeNull();
    expect(getProxiedImageUrl('file:///etc/passwd')).toBeNull();
    expect(getProxiedImageUrl('/api/image-proxy?url=foo')).toBe('/api/image-proxy?url=foo');
  });

  it('validates and extracts YouTube video IDs safely', () => {
    expect(isValidYouTubeVideoId('dQw4w9WgXcQ')).toBe(true);
    expect(isValidYouTubeVideoId('../evil?a=1')).toBe(false);
    expect(
      extractYouTubeVideoId({ url: 'https://www.youtube.com/watch?v=zjkBMFhNj_g' }),
    ).toBe('zjkBMFhNj_g');
    expect(extractYouTubeVideoId({ url: 'https://youtu.be/kCc8FmEb1nY' })).toBe(
      'kCc8FmEb1nY',
    );
    expect(extractYouTubeVideoId({ video_id: 'bad/id' })).toBeNull();
  });
});
