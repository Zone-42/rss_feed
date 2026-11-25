import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileDown,
  Filter,
  Loader2,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { apiClient } from '../api/client';
import type {
  ExportMarkdownResponse,
  FilterRule,
  ViewType,
} from '../types/api';
import { cn } from '../utils/cn';

type ModalTab = 'export' | 'filters';
type MatchField = 'both' | 'title' | 'content';

interface FiltersExportModalProps {
  open: boolean;
  nlmAvailable: boolean;
  onClose: () => void;
  onNotify: (type: 'success' | 'error' | 'info', text: string) => void;
}

export function FiltersExportModal({
  open,
  nlmAvailable,
  onClose,
  onNotify,
}: FiltersExportModalProps) {
  const [tab, setTab] = useState<ModalTab>('export');

  // Filters state
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [matchField, setMatchField] = useState<MatchField>('both');
  const [savingFilter, setSavingFilter] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);

  // Export state
  const [starredOnly, setStarredOnly] = useState(false);
  const [exportView, setExportView] = useState<ViewType | ''>('');
  const [days, setDays] = useState<number>(7);
  const [exportTitle, setExportTitle] = useState('');
  const [generating, setGenerating] = useState(false);
  const [exportResult, setExportResult] = useState<ExportMarkdownResponse | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // NotebookLM push state
  const [notebookId, setNotebookId] = useState('');
  const [pushingNlm, setPushingNlm] = useState(false);
  const [nlmMessage, setNlmMessage] = useState<string | null>(null);

  const loadFilters = useCallback(async () => {
    setLoadingFilters(true);
    setFilterError(null);
    try {
      const data = await apiClient.getFilters();
      setFilters(data);
    } catch (err) {
      setFilterError(err instanceof Error ? err.message : '加载过滤规则失败');
    } finally {
      setLoadingFilters(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadFilters();
      setExportError(null);
      setNlmMessage(null);
    }
  }, [open, loadFilters]);

  if (!open) return null;

  const handleAddFilter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    setSavingFilter(true);
    setFilterError(null);
    try {
      const created = await apiClient.createFilter({
        keyword: newKeyword.trim(),
        match_field: matchField,
      });
      setFilters((prev) => [created, ...prev]);
      setNewKeyword('');
      onNotify('success', `已添加黑名单关键词：${created.keyword}`);
    } catch (err) {
      setFilterError(err instanceof Error ? err.message : '添加过滤规则失败');
    } finally {
      setSavingFilter(false);
    }
  };

  const handleDeleteFilter = async (id: number) => {
    try {
      await apiClient.deleteFilter(id);
      setFilters((prev) => prev.filter((f) => f.id !== id));
      onNotify('info', '已删除黑名单关键词');
    } catch (err) {
      setFilterError(err instanceof Error ? err.message : '删除规则失败');
    }
  };

  const buildExportPayload = () => ({
    starred_only: starredOnly,
    view_type: exportView || undefined,
    days,
    title: exportTitle.trim() || undefined,
  });

  const handleGenerateExport = async () => {
    setGenerating(true);
    setExportError(null);
    setNlmMessage(null);
    try {
      const res = await apiClient.exportMarkdown(buildExportPayload());
      setExportResult(res);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '生成 Markdown 打包失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadMarkdown = () => {
    if (!exportResult) return;
    const blob = new Blob([exportResult.markdown], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportResult.filename || 'rss-digest.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onNotify('success', `已下载 ${exportResult.filename}`);
  };

  const handleCopyMarkdown = async () => {
    if (!exportResult) return;
    try {
      await navigator.clipboard.writeText(exportResult.markdown);
      setCopied(true);
      onNotify('success', 'Markdown 内容已复制到剪贴板');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotify('error', '复制失败，请手动全选预览区文本');
    }
  };

  const handlePushNotebookLM = async () => {
    if (!notebookId.trim()) {
      setExportError('请输入目标 NotebookLM Notebook ID');
      return;
    }
    setPushingNlm(true);
    setExportError(null);
    setNlmMessage(null);
    try {
      const res = await apiClient.exportNotebookLM({
        ...buildExportPayload(),
        notebook_id: notebookId.trim(),
      });
      if (res.status === 'pushed') {
        setNlmMessage(res.message || '已推送到 NotebookLM');
        onNotify('success', '已推送到 NotebookLM');
      } else {
        const errMsg = res.message || `推送 NotebookLM 失败 (${res.status})`;
        setExportError(errMsg);
        onNotify('error', errMsg);
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '推送 NotebookLM 失败');
    } finally {
      setPushingNlm(false);
    }
  };

  const usageRatio = exportResult
    ? Math.min(100, Math.round((exportResult.word_count / Math.max(1, exportResult.safe_limit)) * 100))
    : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="L1 过滤规则与知识导出"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#161922]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              过滤规则 & 知识导出
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              L1 关键词黑名单降噪 · 周报批量打包导出至 NotebookLM (40万字安全线) 与 Obsidian
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
        <div className="flex gap-2 border-b border-zinc-200 bg-zinc-50/70 px-5 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/50">
          <button
            type="button"
            onClick={() => setTab('export')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
              tab === 'export'
                ? 'bg-white text-orange-600 shadow-xs ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-orange-400 dark:ring-zinc-700'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
            )}
          >
            <FileDown className="h-3.5 w-3.5" />
            <span>导出到 NotebookLM / Obsidian</span>
          </button>

          <button
            type="button"
            onClick={() => setTab('filters')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition',
              tab === 'filters'
                ? 'bg-white text-orange-600 shadow-xs ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-orange-400 dark:ring-zinc-700'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100',
            )}
          >
            <Filter className="h-3.5 w-3.5" />
            <span>L1 关键词黑名单 ({filters.length})</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'export' ? (
            <div className="space-y-4">
              {exportError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                  {exportError}
                </div>
              )}

              {nlmMessage && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
                  {nlmMessage}
                </div>
              )}

              {/* Export Filter Controls */}
              <div className="grid grid-cols-1 gap-3 rounded-2xl border border-zinc-200/90 bg-zinc-50/70 p-4 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900/40">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    视图范围
                  </label>
                  <select
                    value={exportView}
                    onChange={(e) => setExportView(e.target.value as ViewType | '')}
                    aria-label="导出视图范围"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 focus:border-orange-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    <option value="">全部视图 (All)</option>
                    <option value="article">Articles (财经/科技)</option>
                    <option value="hn">Hacker News</option>
                    <option value="video">Videos (YouTube)</option>
                    <option value="audio">Podcasts (播客)</option>
                    <option value="social">Social (社媒)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    时间跨度 (天)
                  </label>
                  <div className="flex items-center gap-1.5">
                    {[1, 7, 14, 30].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDays(d)}
                        className={cn(
                          'rounded-lg border px-2.5 py-1 text-xs font-medium transition',
                          days === d
                            ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
                        )}
                      >
                        {d}天
                      </button>
                    ))}
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={days}
                      onChange={(e) => setDays(Math.max(0, Number(e.target.value) || 0))}
                      aria-label="自定义天数"
                      className="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-center font-mono text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    文档标题（可选）
                  </label>
                  <input
                    type="text"
                    value={exportTitle}
                    onChange={(e) => setExportTitle(e.target.value)}
                    placeholder="例如：Weekly Tech & Markets Digest"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-800 focus:border-orange-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  />
                </div>

                <div className="flex items-end justify-between gap-2">
                  <label className="flex cursor-pointer items-center gap-2 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={starredOnly}
                      onChange={(e) => setStarredOnly(e.target.checked)}
                      className="h-4 w-4 rounded accent-orange-600"
                    />
                    <span>仅导出已收藏 (Starred only)</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => void handleGenerateExport()}
                    disabled={generating}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-orange-700 disabled:opacity-60"
                  >
                    {generating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileDown className="h-3.5 w-3.5" />
                    )}
                    <span>生成打包预览</span>
                  </button>
                </div>
              </div>

              {/* Word Count vs 400k Safe Limit Progress & Preview */}
              {exportResult && (
                <div className="space-y-3" data-testid="export-preview-section">
                  <div className="rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-900/60">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                        共打包 <span className="font-mono text-orange-600 dark:text-orange-400">{exportResult.entry_count}</span> 篇 ·{' '}
                        <span className="font-mono">{exportResult.word_count.toLocaleString()}</span> /{' '}
                        <span className="font-mono">{exportResult.safe_limit.toLocaleString()}</span> 词
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                          exportResult.within_limit
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
                        )}
                      >
                        {!exportResult.within_limit && <AlertTriangle className="h-3 w-3" />}
                        {exportResult.within_limit
                          ? 'NotebookLM 安全范围内'
                          : '超出 40万词安全线，建议缩小天数或仅导收藏'}
                      </span>
                    </div>

                    <div
                      role="progressbar"
                      aria-valuenow={usageRatio}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="NotebookLM 字数配额使用率"
                      className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                    >
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          exportResult.within_limit
                            ? usageRatio > 80
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                            : 'bg-rose-500',
                        )}
                        style={{ width: `${Math.max(2, usageRatio)}%` }}
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDownloadMarkdown}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>下载 .md ({exportResult.filename})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleCopyMarkdown()}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        {copied ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span>{copied ? '已复制' : '复制 Markdown'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Markdown Preview */}
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                      批量打包预览 (Obsidian YAML Frontmatter + 结构化元数据头)
                    </p>
                    <pre className="max-h-60 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-700 dark:border-zinc-800 dark:bg-[#101218] dark:text-zinc-300">
                      {exportResult.markdown}
                    </pre>
                  </div>
                </div>
              )}

              {/* Direct Push to NotebookLM */}
              <div className="rounded-2xl border border-violet-200/80 bg-violet-50/50 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-violet-900 dark:text-violet-200">
                    直推 NotebookLM (nlm CLI)
                  </h3>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      nlmAvailable
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
                    )}
                  >
                    {nlmAvailable ? 'nlm 已就绪' : '未检测到 nlm CLI'}
                  </span>
                </div>

                {nlmAvailable ? (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={notebookId}
                      onChange={(e) => setNotebookId(e.target.value)}
                      placeholder="输入 Notebook ID (如 eeaf0373-3961-4cba-910f-8198ae2c809f)"
                      aria-label="NotebookLM Notebook ID"
                      className="min-w-[220px] flex-1 rounded-xl border border-violet-200 bg-white px-3 py-1.5 font-mono text-xs text-zinc-800 focus:border-violet-500 focus:outline-none dark:border-violet-800 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={() => void handlePushNotebookLM()}
                      disabled={pushingNlm}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-violet-700 disabled:opacity-60"
                    >
                      {pushingNlm ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                      <span>推送到 NotebookLM</span>
                    </button>
                  </div>
                ) : (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-violet-800/80 dark:text-violet-300/80">
                    当前环境未检测到 <code>nlm</code> 命令行工具。您可以直接使用上方「下载 .md」按钮将周报文件拖入 NotebookLM 网页端，或存入本地 Obsidian 知识库。
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* L1 Keyword Blacklist Filters */
            <div className="space-y-4">
              {filterError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                  {filterError}
                </div>
              )}

              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                L1 规则过滤在抓取阶段自动拦截命中黑名单的广告、水文或低信号条目，保持信息流清爽。
              </p>

              <form onSubmit={handleAddFilter} className="flex flex-wrap gap-2">
                <input
                  type="text"
                  required
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  placeholder="输入屏蔽关键词（如：Sponsored、推广、抽奖）"
                  aria-label="黑名单关键词"
                  className="min-w-[200px] flex-1 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs text-zinc-900 focus:border-orange-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
                <select
                  value={matchField}
                  onChange={(e) => setMatchField(e.target.value as MatchField)}
                  aria-label="匹配字段"
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 focus:border-orange-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <option value="both">标题 + 正文</option>
                  <option value="title">仅标题</option>
                  <option value="content">仅正文</option>
                </select>
                <button
                  type="submit"
                  disabled={savingFilter || !newKeyword.trim()}
                  className="inline-flex items-center gap-1 rounded-xl bg-orange-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-orange-700 disabled:opacity-60"
                >
                  {savingFilter ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  <span>添加规则</span>
                </button>
              </form>

              {loadingFilters ? (
                <div className="flex items-center justify-center py-8 text-xs text-zinc-400">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  加载过滤规则...
                </div>
              ) : filters.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  暂无关键词过滤规则。
                </div>
              ) : (
                <ul className="divide-y divide-zinc-200/80 rounded-xl border border-zinc-200/80 dark:divide-zinc-800 dark:border-zinc-800">
                  {filters.map((rule) => (
                    <li
                      key={rule.id}
                      className="flex items-center justify-between px-3.5 py-2.5 text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="font-semibold text-zinc-800 dark:text-zinc-100">
                          {rule.keyword}
                        </span>
                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          {rule.match_field === 'title'
                            ? '仅标题'
                            : rule.match_field === 'content'
                              ? '仅正文'
                              : '标题+正文'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteFilter(rule.id)}
                        className="rounded p-1 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                        aria-label={`删除规则 ${rule.keyword}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
