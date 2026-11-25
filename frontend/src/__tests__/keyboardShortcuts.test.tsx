import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

function ShortcutHarness({
  enabled = true,
  handlers,
}: {
  enabled?: boolean;
  handlers: {
    onNext: () => void;
    onPrev: () => void;
    onToggleStar: () => void;
    onToggleRead: () => void;
    onOpenOriginal: () => void;
    onFocusSearch: () => void;
    onEscape: () => void;
  };
}) {
  useKeyboardShortcuts({ enabled, ...handlers });
  return (
    <div>
      <input aria-label="search-box" />
      <button type="button">focus-target</button>
    </div>
  );
}

describe('useKeyboardShortcuts', () => {
  it('triggers j/k/s/m/o/slash/Escape handlers when enabled', () => {
    const handlers = {
      onNext: vi.fn(),
      onPrev: vi.fn(),
      onToggleStar: vi.fn(),
      onToggleRead: vi.fn(),
      onOpenOriginal: vi.fn(),
      onFocusSearch: vi.fn(),
      onEscape: vi.fn(),
    };

    render(<ShortcutHarness handlers={handlers} />);

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.keyDown(window, { key: 'm' });
    fireEvent.keyDown(window, { key: 'o' });
    fireEvent.keyDown(window, { key: '/' });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(handlers.onNext).toHaveBeenCalledTimes(1);
    expect(handlers.onPrev).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleStar).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleRead).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenOriginal).toHaveBeenCalledTimes(1);
    expect(handlers.onFocusSearch).toHaveBeenCalledTimes(1);
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });

  it('ignores shortcuts while typing in an input or when disabled', () => {
    const handlers = {
      onNext: vi.fn(),
      onPrev: vi.fn(),
      onToggleStar: vi.fn(),
      onToggleRead: vi.fn(),
      onOpenOriginal: vi.fn(),
      onFocusSearch: vi.fn(),
      onEscape: vi.fn(),
    };

    const { rerender } = render(<ShortcutHarness handlers={handlers} />);
    const input = screen.getByLabelText('search-box');
    input.focus();

    fireEvent.keyDown(input, { key: 'j' });
    fireEvent.keyDown(input, { key: 's' });
    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onToggleStar).not.toHaveBeenCalled();

    // Disabled (e.g. modal open): regular keys ignored, Escape still works
    rerender(<ShortcutHarness enabled={false} handlers={handlers} />);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handlers.onNext).not.toHaveBeenCalled();
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });
});
