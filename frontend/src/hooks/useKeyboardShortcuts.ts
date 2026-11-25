import { useEffect } from 'react';

export interface KeyboardShortcutHandlers {
  enabled: boolean;
  onNext: () => void;
  onPrev: () => void;
  onToggleStar: () => void;
  onToggleRead: () => void;
  onOpenOriginal: () => void;
  onFocusSearch?: () => void;
  onEscape?: () => void;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const {
    enabled,
    onNext,
    onPrev,
    onToggleStar,
    onToggleRead,
    onOpenOriginal,
    onFocusSearch,
    onEscape,
  } = handlers;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onEscape?.();
        return;
      }

      if (!enabled) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableElement(event.target)) return;

      switch (event.key) {
        case 'j':
        case 'J':
          event.preventDefault();
          onNext();
          break;
        case 'k':
        case 'K':
          event.preventDefault();
          onPrev();
          break;
        case 's':
        case 'S':
          event.preventDefault();
          onToggleStar();
          break;
        case 'm':
        case 'M':
          event.preventDefault();
          onToggleRead();
          break;
        case 'o':
        case 'O':
          event.preventDefault();
          onOpenOriginal();
          break;
        case '/':
          if (onFocusSearch) {
            event.preventDefault();
            onFocusSearch();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    enabled,
    onNext,
    onPrev,
    onToggleStar,
    onToggleRead,
    onOpenOriginal,
    onFocusSearch,
    onEscape,
  ]);
}
