import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../utils/cn';

export interface ToastMessage {
  id: number;
  type: 'success' | 'warning' | 'error' | 'info';
  text: string;
}

interface ToastStackProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-20 z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-2 sm:max-w-md"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.type === 'error' ? 'alert' : 'status'}
          data-toast-type={toast.type}
          className={cn(
            'pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-lg backdrop-blur-md transition-all',
            toast.type === 'success' &&
              'border-emerald-200 bg-emerald-50/95 text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/90 dark:text-emerald-100',
            toast.type === 'warning' &&
              'border-amber-200 bg-amber-50/95 text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/90 dark:text-amber-100',
            toast.type === 'error' &&
              'border-rose-200 bg-rose-50/95 text-rose-900 dark:border-rose-800/70 dark:bg-rose-950/90 dark:text-rose-100',
            toast.type === 'info' &&
              'border-zinc-200 bg-white/95 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100',
          )}
        >
          {toast.type === 'success' && (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
          {toast.type === 'warning' && (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          )}
          {toast.type === 'error' && (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          )}
          {toast.type === 'info' && (
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
          )}
          <span className="min-w-0 flex-1 break-words leading-snug">{toast.text}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="rounded p-0.5 opacity-60 hover:opacity-100"
            aria-label="关闭通知"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
