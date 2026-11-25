import { CheckCheck, Menu, Search, X } from 'lucide-react';
import { cn } from '../utils/cn';

interface StreamToolbarProps {
  title: string;
  subtitle?: string;
  total: number;
  searchQuery: string;
  unreadOnly: boolean;
  showMarkAllRead: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  onSearchChange: (q: string) => void;
  onToggleUnreadOnly: () => void;
  onMarkAllRead: () => void;
  onOpenMobileMenu: () => void;
}

export function StreamToolbar({
  title,
  subtitle,
  total,
  searchQuery,
  unreadOnly,
  showMarkAllRead,
  searchInputRef,
  onSearchChange,
  onToggleUnreadOnly,
  onMarkAllRead,
  onOpenMobileMenu,
}: StreamToolbarProps) {
  return (
    <header className="shrink-0 border-b border-zinc-200/80 bg-white/80 px-4 py-3 backdrop-blur-sm dark:border-zinc-800/80 dark:bg-[#14171f]/80">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            className="rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 lg:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="打开导航菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h2 className="truncate text-base font-bold text-zinc-900 dark:text-zinc-100">
                {title}
              </h2>
              <span className="shrink-0 font-mono text-xs text-zinc-400 dark:text-zinc-500">
                {total}
              </span>
            </div>
            {subtitle && (
              <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onToggleUnreadOnly}
            aria-pressed={unreadOnly}
            className={cn(
              'rounded-lg border px-2.5 py-1 text-xs font-medium transition',
              unreadOnly
                ? 'border-orange-500 bg-orange-50 text-orange-700 dark:border-orange-500/70 dark:bg-orange-500/15 dark:text-orange-300'
                : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800',
            )}
          >
            仅未读
          </button>

          {showMarkAllRead && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
              title="全部标为已读"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">全部已读</span>
            </button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative mt-2.5">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
        <input
          ref={searchInputRef}
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索标题、正文、作者... (按 / 聚焦)"
          aria-label="搜索条目"
          className="w-full rounded-xl border border-zinc-200/90 bg-zinc-50/80 py-1.5 pr-8 pl-8.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-orange-400 focus:bg-white focus:outline-none dark:border-zinc-700/80 dark:bg-zinc-900/70 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-orange-500 dark:focus:bg-zinc-900"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            aria-label="清空搜索"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </header>
  );
}
