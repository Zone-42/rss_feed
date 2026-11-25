const TIMESTAMP_PATTERN = /\b(\d{1,2}:[0-5]\d:[0-5]\d|\d{1,3}:[0-5]\d)\b/g;

/**
 * Parse a timestamp string (`MM:SS` or `HH:MM:SS`) into total seconds.
 * Returns null if the format is invalid.
 */
export function parseTimestampToSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  const parts = trimmed.split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;

  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : Number.NaN));
  if (nums.some((n) => Number.isNaN(n))) return null;

  if (nums.length === 2) {
    const [minutes, seconds] = nums;
    if (seconds >= 60 || minutes < 0 || seconds < 0) return null;
    return minutes * 60 + seconds;
  }

  const [hours, minutes, seconds] = nums;
  if (minutes >= 60 || seconds >= 60 || hours < 0 || minutes < 0 || seconds < 0) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Format seconds into `MM:SS` or `H:MM:SS`.
 */
export function formatSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '00:00';
  const sec = Math.floor(totalSeconds);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Parse a backend `audio_duration` (number, numeric string, or `MM:SS`/`HH:MM:SS`) into seconds.
 */
export function parseAudioDurationSeconds(duration: number | string | null | undefined): number {
  if (duration === null || duration === undefined) return 0;
  if (typeof duration === 'number') {
    return Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0;
  }
  const trimmed = duration.trim();
  if (!trimmed) return 0;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
  }
  return parseTimestampToSeconds(trimmed) ?? 0;
}

/**
 * Normalize backend `audio_duration` which may be integer seconds or a formatted string.
 */
export function formatAudioDuration(duration: number | string | null | undefined): string | null {
  if (duration === null || duration === undefined) return null;
  if (typeof duration === 'number') {
    if (!Number.isFinite(duration) || duration <= 0) return null;
    return formatSeconds(duration);
  }
  const trimmed = duration.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    return num > 0 ? formatSeconds(num) : null;
  }
  return trimmed;
}

/**
 * Extract all valid timestamps from a plain text string.
 */
export function extractTimestamps(text: string): Array<{ label: string; seconds: number }> {
  const results: Array<{ label: string; seconds: number }> = [];
  const regex = new RegExp(TIMESTAMP_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const label = match[1];
    const seconds = parseTimestampToSeconds(label);
    if (seconds !== null) {
      results.push({ label, seconds });
    }
  }
  return results;
}

/**
 * Format an ISO timestamp into a concise relative time string (CN/EN friendly).
 */
export function formatRelativeTime(isoString: string | null | undefined, nowMs = Date.now()): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  const timeMs = date.getTime();
  if (Number.isNaN(timeMs)) return '';

  const diffSeconds = Math.floor((nowMs - timeMs) / 1000);
  if (diffSeconds < 0) return '刚刚';
  if (diffSeconds < 60) return '刚刚';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d`;

  const year = date.getFullYear();
  const nowYear = new Date(nowMs).getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (year === nowYear) {
    return `${month}/${day}`;
  }
  return `${year}/${month}/${day}`;
}

export function formatFullDate(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export { TIMESTAMP_PATTERN };
