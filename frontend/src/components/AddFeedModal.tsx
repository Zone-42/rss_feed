import { useEffect, useState } from 'react';
import {
  Check,
  Download,
  Headphones,
  Loader2,
  MessageSquare,
  Package,
  Plus,
  Rss,
  Search,
  Tv,
  Upload,
  X,
} from 'lucide-react';
import { apiClient } from '../api/client';
import type { Feed, PodcastSearchResult, ViewType } from '../types/api';
import { cn } from '../utils/cn';
import { getProxiedImageUrl } from '../utils/sanitize';

export type AddFeedTab = 'rss' | 'youtube' | 'podcast' | 'social' | 'opml';

interface AddFeedModalProps {
  open: boolean;
  initialTab?: AddFeedTab;
  onClose: () => void;
  onFeedAdded: (feed: Feed) => void;
  onFeedsReloadNeeded: () => void;
  onNotify: (type: 'success' | 'error' | 'info', text: string) => void;
}

const TABS: Array<{ id: AddFeedTab; label: string; icon: typeof Rss }> = [
  { id: 'rss', label: 'RSS / URL', icon: Rss },
  { id: 'youtube', label: 'YouTube', icon: Tv },
  { id: 'podcast', label: '播客搜索', icon: Headphones },
  { id: 'social', label: 'Social / RSSHub', icon: MessageSquare },
  { id: 'opml', label: 'OPML / Starter', icon: Package },
];

type SocialPlatform = 'x' | 'zhihu' | 'xiaohongshu' | 'custom';

function buildSocialUrl(
  base: string,
  platform: SocialPlatform,
  handle: string,
  customUrl: string,
): string {
  const cleanBase = base.trim().replace(/\/+$/, '');
  const cleanHandle = handle.trim().replace(/^@/, '');
  if (platform === 'custom') return customUrl.trim();
  if (!cleanHandle) return '';
  switch (platform) {
    case 'x':
      return `${cleanBase}/twitter/user/${encodeURIComponent(cleanHandle)}`;
    case 'zhihu':
      return `${cleanBase}/zhihu/people/activities/${encodeURIComponent(cleanHandle)}`;
    case 'xiaohongshu':
      return `${cleanBase}/xiaohongshu/user/${encodeURIComponent(cleanHandle)}/notes`;
    default:
      return '';
  }
}

export function AddFeedModal({
  open,
  initialTab = 'rss',
  onClose,
  onFeedAdded,
  onFeedsReloadNeeded,
  onNotify,
}: AddFeedModalProps) {
  const [tab, setTab] = useState<AddFeedTab>(initialTab);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // RSS tab
  const [rssUrl, setRssUrl] = useState('');
  const [rssTitle, setRssTitle] = useState('');
  const [rssViewType, setRssViewType] = useState<ViewType>('article');
  const [rssCategory, setRssCategory] = useState('');

  // YouTube tab
  const [ytInput, setYtInput] = useState('');
  const [ytTitle, setYtTitle] = useState('');
  const [excludeShorts, setExcludeShorts] = useState(true);

  // Podcast search tab
  const [podQuery, setPodQuery] = useState('');
  const [podLoading, setPodLoading] = useState(false);
  const [podResults, setPodResults] = useState<PodcastSearchResult[]>([]);
  const [subscribedUrls, setSubscribedUrls] = useState<Set<string>>(new Set());

  // Social / RSSHub tab
  const [rsshubBase, setRsshubBase] = useState('http://localhost:1200');
  const [socialPlatform, setSocialPlatform] = useState<SocialPlatform>('x');
  const [socialHandle, setSocialHandle] = useState('');
  const [socialCustomUrl, setSocialCustomUrl] = useState('');
  const [socialTitle, setSocialTitle] = useState('');

  // OPML / Starter tab
  const [opmlXml, setOpmlXml] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [exportingOpml, setExportingOpml] = useState(false);

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setError(null);
    }
  }, [open, initialTab]);

  if (!open) return null;

  const handleSubmitRss = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rssUrl.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const feed = await apiClient.createFeed({
        url: rssUrl.trim(),
        title: rssTitle.trim() || undefined,
        view_type: rssViewType,
        category: rssCategory.trim() || undefined,
      });
      onFeedAdded(feed);
      onNotify('success', `已添加订阅源：${feed.title}`);
      setRssUrl('');
      setRssTitle('');
      setRssCategory('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加订阅源失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitYouTube = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytInput.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const raw = ytInput.trim();
      const normalizedUrl = raw.startsWith('@')
        ? `https://www.youtube.com/${raw}`
        : raw;
      const feed = await apiClient.createFeed({
        url: normalizedUrl,
        title: ytTitle.trim() || undefined,
        view_type: 'video',
        feed_kind: 'youtube',
        category: 'YouTube',
        exclude_shorts: excludeShorts,
      });
      onFeedAdded(feed);
      onNotify('success', `已添加 YouTube 频道：${feed.title}`);
      setYtInput('');
      setYtTitle('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析或添加 YouTube 频道失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePodcastSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!podQuery.trim()) return;
    setPodLoading(true);
    setError(null);
    try {
      const res = await apiClient.discoverPodcasts(podQuery.trim());
      setPodResults(res.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : '播客搜索失败');
    } finally {
      setPodLoading(false);
    }
  };

  const handleSubscribePodcast = async (pod: PodcastSearchResult) => {
    setSubmitting(true);
    setError(null);
    try {
      const feed = await apiClient.createFeed({
        url: pod.feed_url,
        title: pod.title,
        view_type: 'audio',
        feed_kind: 'podcast',
        category: pod.genre || 'Podcast',
      });
      setSubscribedUrls((prev) => new Set(prev).add(pod.feed_url));
      onFeedAdded(feed);
      onNotify('success', `已订阅播客：${feed.title}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '订阅播客失败');
    } finally {
      setSubmitting(false);
    }
  };

  const previewSocialUrl = buildSocialUrl(
    rsshubBase,
    socialPlatform,
    socialHandle,
    socialCustomUrl,
  );

  const handleSubmitSocial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!previewSocialUrl) return;
    setSubmitting(true);
    setError(null);
    try {
      const defaultTitle =
        socialTitle.trim() ||
        (socialPlatform === 'custom'
          ? undefined
          : `${socialPlatform.toUpperCase()} · ${socialHandle.trim()}`);
      const feed = await apiClient.createFeed({
        url: previewSocialUrl,
        title: defaultTitle,
        view_type: 'social',
        feed_kind: socialPlatform === 'custom' ? 'rss' : 'rsshub',
        category:
          socialPlatform === 'x'
            ? 'X / Twitter'
            : socialPlatform === 'zhihu'
              ? '知乎'
              : socialPlatform === 'xiaohongshu'
                ? '小红书'
                : 'Social',
      });
      onFeedAdded(feed);
      onNotify('success', `已添加社媒订阅：${feed.title}`);
      setSocialHandle('');
      setSocialCustomUrl('');
      setSocialTitle('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加社媒源失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSeedStarter = async () => {
    setSeeding(true);
    setError(null);
    try {
      const res = await apiClient.seedStarterFeeds();
      onFeedsReloadNeeded();
      onNotify('success', `精选包加载完成：新增 ${res.added_feeds} 个订阅源`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 Starter Pack 失败');
    } finally {
      setSeeding(false);
    }
  };

  const handleExportOpml = async () => {
    setExportingOpml(true);
    setError(null);
    try {
      const xml = await apiClient.exportOpml();
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `foliorss-subscriptions-${new Date().toISOString().slice(0, 10)}.opml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onNotify('success', 'OPML 订阅列表已下载');
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出 OPML 失败');
    } finally {
      setExportingOpml(false);
    }
  };

  const handleImportOpml = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opmlXml.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.importOpml(opmlXml.trim());
      const added = res.added ?? res.added_feeds ?? res.feeds?.length ?? 0;
      onFeedsReloadNeeded();
      onNotify('success', `OPML 导入成功：新增 ${added} 个订阅源`);
      setOpmlXml('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入 OPML 失败，请检查 XML 格式');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpmlFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setOpmlXml(reader.result);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="添加订阅源"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#161922]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              添加订阅源 · Add Feed
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              支持标准 RSS/Atom、YouTube 频道、iTunes 播客发现、RSSHub 社媒路由及 OPML 批量导入
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="关闭弹窗"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 bg-zinc-50/70 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900/50">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setError(null);
                }}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                  active
                    ? 'bg-white text-orange-600 shadow-xs ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-orange-400 dark:ring-zinc-700'
                    : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}

          {tab === 'rss' && (
            <form onSubmit={handleSubmitRss} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  RSS / Atom 订阅链接 *
                </label>
                <input
                  type="url"
                  required
                  value={rssUrl}
                  onChange={(e) => setRssUrl(e.target.value)}
                  placeholder="https://feeds.bloomberg.com/technology/news.rss"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-900 focus:border-orange-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    自定义名称（可选）
                  </label>
                  <input
                    type="text"
                    value={rssTitle}
                    onChange={(e) => setRssTitle(e.target.value)}
                    placeholder="留空自动解析源标题"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-900 focus:border-orange-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    所属视图
                  </label>
                  <select
                    value={rssViewType}
                    onChange={(e) => setRssViewType(e.target.value as ViewType)}
                    aria-label="所属视图"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-900 focus:border-orange-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    <option value="article">Articles (财经/科技)</option>
                    <option value="hn">Hacker News</option>
                    <option value="video">Videos (YouTube)</option>
                    <option value="audio">Podcasts (播客)</option>
                    <option value="social">Social (社媒)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  分类标签（可选）
                </label>
                <input
                  type="text"
                  value={rssCategory}
                  onChange={(e) => setRssCategory(e.target.value)}
                  placeholder="例如：Finance、Tech、AI"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-900 focus:border-orange-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-orange-700 disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  <span>添加订阅</span>
                </button>
              </div>
            </form>
          )}

          {tab === 'youtube' && (
            <form onSubmit={handleSubmitYouTube} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  YouTube @handle、频道主页或 RSS 链接 *
                </label>
                <input
                  type="text"
                  required
                  value={ytInput}
                  onChange={(e) => setYtInput(e.target.value)}
                  placeholder="@AndrejKarpathy 或 https://www.youtube.com/@Fireship"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-900 focus:border-orange-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
                <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  后端将自动解析 <code>@handle</code> 获取频道 ID 并转换为标准 Atom Feed。
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  频道名称（可选）
                </label>
                <input
                  type="text"
                  value={ytTitle}
                  onChange={(e) => setYtTitle(e.target.value)}
                  placeholder="留空自动使用频道原名"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-900 focus:border-orange-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
                <input
                  type="checkbox"
                  checked={excludeShorts}
                  onChange={(e) => setExcludeShorts(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-orange-600"
                />
                <span className="text-xs">
                  <span className="block font-semibold text-zinc-800 dark:text-zinc-200">
                    Exclude Shorts · 排除 Shorts 短视频（推荐）
                  </span>
                  <span className="mt-0.5 block text-[11px] text-zinc-500 dark:text-zinc-400">
                    自动将 <code>UC...</code> 频道 ID 转换为 <code>UULF...</code> 长视频播放列表源，告别竖屏碎片干扰。
                  </span>
                </span>
              </label>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-rose-700 disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Tv className="h-4 w-4" />
                  )}
                  <span>添加 YouTube 频道</span>
                </button>
              </div>
            </form>
          )}

          {tab === 'podcast' && (
            <div className="space-y-4">
              <form onSubmit={handlePodcastSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={podQuery}
                    onChange={(e) => setPodQuery(e.target.value)}
                    placeholder="搜索 Apple Podcasts，例如：Acquired、Latent Space、商业就是这样..."
                    className="w-full rounded-xl border border-zinc-200 bg-white py-2 pr-3 pl-9 text-sm text-zinc-900 focus:border-violet-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>
                <button
                  type="submit"
                  disabled={podLoading || !podQuery.trim()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-violet-700 disabled:opacity-60"
                >
                  {podLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  <span>搜索</span>
                </button>
              </form>

              {podResults.length > 0 ? (
                <ul className="divide-y divide-zinc-200/80 rounded-xl border border-zinc-200/80 dark:divide-zinc-800 dark:border-zinc-800">
                  {podResults.map((pod) => {
                    const art = getProxiedImageUrl(pod.artwork_url);
                    const isAdded = subscribedUrls.has(pod.feed_url);
                    return (
                      <li
                        key={pod.feed_url}
                        className="flex items-center gap-3 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                      >
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-violet-50 dark:border-zinc-700 dark:bg-violet-950/30">
                          {art ? (
                            <img
                              src={art}
                              alt={pod.title}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-violet-500">
                              <Headphones className="h-5 w-5" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            {pod.title}
                          </p>
                          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {pod.author || 'Unknown'} {pod.genre ? `· ${pod.genre}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={submitting || isAdded}
                          onClick={() => void handleSubscribePodcast(pod)}
                          className={cn(
                            'inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                            isAdded
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-500/20 dark:text-violet-300 dark:hover:bg-violet-500/30',
                          )}
                        >
                          {isAdded ? (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              <span>已订阅</span>
                            </>
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5" />
                              <span>订阅</span>
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  输入关键词搜索全球中英文播客，一键解析真实 RSS Feed 并支持 Shownotes 时间轴跳转播放。
                </div>
              )}
            </div>
          )}

          {tab === 'social' && (
            <form onSubmit={handleSubmitSocial} className="space-y-4">
              <div className="rounded-xl border border-sky-200/80 bg-sky-50/70 p-3 text-xs leading-relaxed text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
                <p className="font-semibold">社媒路由快捷助手 (RSSHub / MediaCrawler)</p>
                <p className="mt-1 opacity-85">
                  填写本地或自建 RSSHub 地址（默认 <code>http://localhost:1200</code>），快速拼接 X / 知乎 / 小红书路由；或者选择「自定义 URL」填入 MediaCrawler CDP 导出的本地 RSS 地址。
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    平台模板
                  </label>
                  <select
                    value={socialPlatform}
                    onChange={(e) => setSocialPlatform(e.target.value as SocialPlatform)}
                    aria-label="社媒平台"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-sky-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    <option value="x">X / Twitter 用户时间线</option>
                    <option value="zhihu">知乎用户动态 (Zhihu)</option>
                    <option value="xiaohongshu">小红书用户笔记 (Xiaohongshu)</option>
                    <option value="custom">自定义 RSSHub / MediaCrawler URL</option>
                  </select>
                </div>

                {socialPlatform !== 'custom' && (
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      RSSHub 实例地址
                    </label>
                    <input
                      type="url"
                      value={rsshubBase}
                      onChange={(e) => setRsshubBase(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-sky-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                )}
              </div>

              {socialPlatform === 'custom' ? (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    自定义社媒 RSS 地址 *
                  </label>
                  <input
                    type="url"
                    required
                    value={socialCustomUrl}
                    onChange={(e) => setSocialCustomUrl(e.target.value)}
                    placeholder="http://localhost:1200/twitter/user/karpathy"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-900 focus:border-sky-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    {socialPlatform === 'x'
                      ? 'X 用户名 (不含 @)'
                      : socialPlatform === 'zhihu'
                        ? '知乎用户 URL Token'
                        : '小红书用户 ID'}
                    {' *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={socialHandle}
                    onChange={(e) => setSocialHandle(e.target.value)}
                    placeholder={
                      socialPlatform === 'x'
                        ? 'karpathy'
                        : socialPlatform === 'zhihu'
                          ? 'excited-vczh'
                          : '5ff0e6410000000001008400'
                    }
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-900 focus:border-sky-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  显示名称（可选）
                </label>
                <input
                  type="text"
                  value={socialTitle}
                  onChange={(e) => setSocialTitle(e.target.value)}
                  placeholder="例如：Andrej Karpathy (X)"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-sm text-zinc-900 focus:border-sky-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              </div>

              {previewSocialUrl && (
                <div className="rounded-xl bg-zinc-100 px-3 py-2 font-mono text-[11px] break-all text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                  目标路由：{previewSocialUrl}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || !previewSocialUrl}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-sky-700 disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  <span>添加社媒订阅</span>
                </button>
              </div>
            </form>
          )}

          {tab === 'opml' && (
            <div className="space-y-5">
              {/* Starter Pack */}
              <div className="rounded-2xl border border-orange-200/80 bg-orange-50/70 p-4 dark:border-orange-900/60 dark:bg-orange-950/25">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-orange-900 dark:text-orange-200">
                      一键加载 2026 精选 Starter Pack
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-orange-800/80 dark:text-orange-300/80">
                      内置 Bloomberg、WSJ 新域、FT、Reuters、CNBC、TechCrunch AI、The Verge、Ars Technica、Hacker News 高分源、YouTube 与播客精选（幂等导入，不会重复）。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleSeedStarter()}
                    disabled={seeding}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-orange-700 disabled:opacity-60"
                  >
                    {seeding ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Package className="h-4 w-4" />
                    )}
                    <span>加载精选源</span>
                  </button>
                </div>
              </div>

              {/* Export OPML */}
              <div className="flex items-center justify-between rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800">
                <div>
                  <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    导出当前订阅列表 (OPML)
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    方便备份或迁移至 Miniflux / Folo / Reeder。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleExportOpml()}
                  disabled={exportingOpml}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {exportingOpml ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  <span>导出 .opml</span>
                </button>
              </div>

              {/* Import OPML */}
              <form onSubmit={handleImportOpml} className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    导入 OPML XML
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
                    <Upload className="h-3 w-3" />
                    <span>选择 .opml 文件</span>
                    <input
                      type="file"
                      accept=".opml,.xml,text/xml,application/xml"
                      onChange={handleOpmlFileSelect}
                      className="hidden"
                    />
                  </label>
                </div>
                <textarea
                  rows={5}
                  value={opmlXml}
                  onChange={(e) => setOpmlXml(e.target.value)}
                  placeholder='粘贴 <?xml version="1.0"?><opml version="2.0">...</opml>'
                  className="w-full rounded-xl border border-zinc-200 bg-white p-3 font-mono text-xs text-zinc-800 focus:border-orange-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submitting || !opmlXml.trim()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    <span>导入 OPML</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
