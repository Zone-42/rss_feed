import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from '../utils/sanitize';
import {
  extractTimestamps,
  formatAudioDuration,
  formatSeconds,
  parseAudioDurationSeconds,
  parseTimestampToSeconds,
} from '../utils/time';

describe('timestamp utilities', () => {
  it('parses MM:SS and HH:MM:SS timestamps into seconds', () => {
    expect(parseTimestampToSeconds('00:00')).toBe(0);
    expect(parseTimestampToSeconds('05:30')).toBe(330);
    expect(parseTimestampToSeconds('1:02:15')).toBe(3735);
    expect(parseTimestampToSeconds('75:10')).toBe(4510);
  });

  it('rejects invalid timestamps', () => {
    expect(parseTimestampToSeconds('12:65')).toBeNull();
    expect(parseTimestampToSeconds('1:70:00')).toBeNull();
    expect(parseTimestampToSeconds('not-a-time')).toBeNull();
    expect(parseTimestampToSeconds('1:2:3:4')).toBeNull();
  });

  it('formats seconds and mixed audio durations cleanly', () => {
    expect(formatSeconds(0)).toBe('00:00');
    expect(formatSeconds(125)).toBe('02:05');
    expect(formatSeconds(3725)).toBe('1:02:05');
    expect(formatAudioDuration(3600)).toBe('1:00:00');
    expect(formatAudioDuration('45:12')).toBe('45:12');
    expect(formatAudioDuration('180')).toBe('03:00');
    expect(formatAudioDuration(null)).toBeNull();
    expect(parseAudioDurationSeconds('45:00')).toBe(2700);
    expect(parseAudioDurationSeconds('3:40:00')).toBe(13200);
    expect(parseAudioDurationSeconds('180')).toBe(180);
    expect(parseAudioDurationSeconds(95)).toBe(95);
    expect(parseAudioDurationSeconds(null)).toBe(0);
  });

  it('extracts multiple timestamps from shownotes text', () => {
    const found = extractTimestamps('00:45 Intro, 12:30 Deep Dive, 1:05:10 Q&A');
    expect(found).toEqual([
      { label: '00:45', seconds: 45 },
      { label: '12:30', seconds: 750 },
      { label: '1:05:10', seconds: 3910 },
    ]);
  });

  it('auto-links timestamps in shownotes HTML while skipping code, links, and ISO dates', () => {
    const html = `
      <p>02:15 开场介绍，1:00:05 核心讨论</p>
      <p>发布于 2026-11-25 14:30:00</p>
      <code>04:20</code>
      <a href="https://example.com">09:10 link</a>
    `;
    const output = sanitizeHtml(html, { linkifyTimestamps: true });
    expect(output).toContain('data-seek-seconds="135"');
    expect(output).toContain('data-seek-seconds="3605"');
    // Should NOT link ISO datetime
    expect(output).not.toContain('data-seek-seconds="52200"');
    // Should NOT link inside <code> or <a>
    expect(output).not.toContain('data-seek-seconds="260"');
    expect(output).not.toContain('data-seek-seconds="550"');
  });
});
