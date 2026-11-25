import type { Feed } from '../types/api';

export interface FeedErrorGroup {
  error: string;
  feeds: Feed[];
}

/**
 * Inspect a feed fetch error string and return a concise, actionable Chinese hint
 * for common local proxy, network, TLS, or rate-limit failures.
 */
export function getActionableErrorHint(error: string): string | null {
  const normalized = error.trim();
  if (!normalized) return null;

  if (/socksio|socks/i.test(normalized)) {
    return '检测到系统 SOCKS 代理，请确认后端已安装 httpx[socks]（执行 just install），或在 .env 中配置 RSS_PROXY_URL=http://... / RSS_PROXY_URL=direct。';
  }

  if (/\bssl\b|certificate|cert_verify/i.test(normalized)) {
    return 'TLS 证书校验失败，如开启了代理 MITM 解密，请确认 SSL_CERT_FILE 配置正确或尝试直连/关闭该域名 MITM。';
  }

  if (
    /connecterror|connecttimeout|readtimeout|timed\s*out|proxyerror|gaierror/i.test(
      normalized,
    )
  ) {
    return '网络或代理连接失败，请检查 Surge / Sing-box / Clash 代理是否正常运行，或在 .env 中设置 RSS_PROXY_URL。';
  }

  if (/\b(?:403|429)\b|too many requests|rate[\s-]?limit/i.test(normalized)) {
    return '目标站点限流或拦截，可稍后重试或检查代理出口 IP。';
  }

  return null;
}

/**
 * Group failing feeds by identical trimmed `last_error` text, sorted with the
 * largest affected groups first.
 */
export function groupFeedsByError(feeds: Feed[]): FeedErrorGroup[] {
  const map = new Map<string, Feed[]>();
  for (const feed of feeds) {
    const err = feed.last_error?.trim();
    if (!err) continue;
    const bucket = map.get(err);
    if (bucket) {
      bucket.push(feed);
    } else {
      map.set(err, [feed]);
    }
  }

  return Array.from(map.entries())
    .map(([error, groupedFeeds]) => ({ error, feeds: groupedFeeds }))
    .sort((a, b) => b.feeds.length - a.feeds.length);
}
