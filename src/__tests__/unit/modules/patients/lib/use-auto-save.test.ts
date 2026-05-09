// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAutoSave } from '@/modules/patients/lib/use-auto-save';

/**
 * Helper: advance fake timers inside `act()` so React flushes both the
 * timer callback and any resulting microtasks (state updates, resolved
 * promises). Returns a Promise so the call site can `await` it without
 * triggering the `@typescript-eslint/await-thenable` rule.
 */
async function advanceTimers(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with idle status and null lastSavedAt', () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useAutoSave('initial', saveFn, { interval: 5_000 }));

    expect(result.current.status).toBe('idle');
    expect(result.current.lastSavedAt).toBeNull();
  });

  it('triggers save after interval elapses when content changes', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);

    const { result, rerender } = renderHook(
      ({ content }: { content: string }) => useAutoSave(content, saveFn, { interval: 5_000 }),
      { initialProps: { content: 'initial' } },
    );

    // Change content — timer starts.
    rerender({ content: 'updated' });

    expect(saveFn).not.toHaveBeenCalled();

    // Advance past the interval.
    await advanceTimers(5_000);

    expect(saveFn).toHaveBeenCalledOnce();
    expect(saveFn).toHaveBeenCalledWith('updated');
    expect(result.current.status).toBe('saved');
    expect(result.current.lastSavedAt).toBeInstanceOf(Date);
  });

  it('does not trigger save if content has not changed', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useAutoSave('same', saveFn, { interval: 3_000 }));

    await advanceTimers(10_000);

    expect(saveFn).not.toHaveBeenCalled();
  });

  it('does not trigger save again after a successful save when content is unchanged', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ content }: { content: string }) => useAutoSave(content, saveFn, { interval: 2_000 }),
      { initialProps: { content: 'v1' } },
    );

    // Change to v2.
    rerender({ content: 'v2' });

    await advanceTimers(2_000);

    expect(saveFn).toHaveBeenCalledOnce();

    // Re-render with the same v2 — no new save should fire.
    rerender({ content: 'v2' });

    await advanceTimers(5_000);

    expect(saveFn).toHaveBeenCalledOnce();
  });

  it('resets the debounce timer on rapid changes', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ content }: { content: string }) => useAutoSave(content, saveFn, { interval: 5_000 }),
      { initialProps: { content: 'v1' } },
    );

    // First change.
    rerender({ content: 'v2' });

    // Advance 3s (not enough to trigger).
    await advanceTimers(3_000);

    expect(saveFn).not.toHaveBeenCalled();

    // Second change — resets the timer.
    rerender({ content: 'v3' });

    // Advance another 3s from the second change (total 6s from first, but
    // only 3s from the second change — still not enough).
    await advanceTimers(3_000);

    expect(saveFn).not.toHaveBeenCalled();

    // Advance the remaining 2s — now the full interval has passed since the
    // last change.
    await advanceTimers(2_000);

    expect(saveFn).toHaveBeenCalledOnce();
    // It should save the latest content.
    expect(saveFn).toHaveBeenCalledWith('v3');
  });

  it('returns "saving" status while the save is in progress', async () => {
    let resolveSave!: () => void;
    const saveFn = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ content }: { content: string }) => useAutoSave(content, saveFn, { interval: 1_000 }),
      { initialProps: { content: 'v1' } },
    );

    rerender({ content: 'v2' });

    // Trigger the timer — the save starts but does not resolve yet.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.status).toBe('saving');

    // Resolve the save and flush the resulting microtask (state update).
    await act(async () => {
      resolveSave();
      await Promise.resolve();
    });

    expect(result.current.status).toBe('saved');
  });

  it('returns "error" status when the save function rejects', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('network error'));

    const { result, rerender } = renderHook(
      ({ content }: { content: string }) => useAutoSave(content, saveFn, { interval: 1_000 }),
      { initialProps: { content: 'v1' } },
    );

    rerender({ content: 'v2' });

    await advanceTimers(1_000);

    expect(result.current.status).toBe('error');
    expect(result.current.lastSavedAt).toBeNull();
  });

  it('works with object content (compared via JSON.stringify)', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);

    type Content = { text: string; count: number };
    const initial: Content = { text: 'hello', count: 1 };

    const { rerender } = renderHook(
      ({ content }: { content: Content }) => useAutoSave(content, saveFn, { interval: 2_000 }),
      { initialProps: { content: initial } },
    );

    // Rerender with a structurally equal but referentially different object —
    // should NOT trigger save.
    rerender({ content: { text: 'hello', count: 1 } });

    await advanceTimers(5_000);

    expect(saveFn).not.toHaveBeenCalled();

    // Rerender with a different value — should trigger save.
    rerender({ content: { text: 'world', count: 2 } });

    await advanceTimers(2_000);

    expect(saveFn).toHaveBeenCalledOnce();
    expect(saveFn).toHaveBeenCalledWith({ text: 'world', count: 2 });
  });
});
