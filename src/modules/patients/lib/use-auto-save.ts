'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Auto-save status
// ---------------------------------------------------------------------------

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutoSaveResult {
  /** Current status of the auto-save cycle. */
  status: AutoSaveStatus;
  /** Timestamp of the last successful save, or `null` if nothing was saved yet. */
  lastSavedAt: Date | null;
  /**
   * `true` when the current content differs from the last successfully saved
   * snapshot (i.e. there are unsaved changes). Reactive — drives the enabled
   * state of a manual "Salvar" button.
   */
  isDirty: boolean;
  /**
   * Persist the latest content immediately, bypassing the debounce timer.
   * Cancels any pending debounced save, reuses the no-op check (unchanged
   * content) and the in-flight guard, so it is safe to call while a debounced
   * save is already running. Stable identity across renders.
   */
  saveNow: () => Promise<void>;
}

export interface AutoSaveOptions {
  /**
   * Debounce interval in milliseconds. The save function fires after the
   * content has been stable (unchanged) for this duration.
   * @default 10_000
   */
  interval: number;
}

// ---------------------------------------------------------------------------
// useAutoSave
// ---------------------------------------------------------------------------

/**
 * Hook that auto-saves content after it has been stable for `options.interval`
 * milliseconds. Compares current content against the last saved snapshot via
 * `JSON.stringify` and only triggers `saveFn` when the content has actually
 * changed.
 *
 * Rapid changes reset the debounce timer so the save fires only after the
 * user stops typing for the configured interval.
 */
export function useAutoSave<T>(
  content: T,
  saveFn: (content: T) => Promise<void>,
  options: AutoSaveOptions,
): AutoSaveResult {
  const { interval } = options;

  const [status, setStatus] = useState<AutoSaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  // Mirror of the dirty flag in React state so consumers re-render when the
  // unsaved-changes condition flips. Derived from `content` vs the last saved
  // snapshot; refs alone would not trigger a re-render.
  const [isDirty, setIsDirty] = useState(false);

  // Ref holding the JSON snapshot of the last *successfully* saved content.
  const lastSavedContentRef = useRef<string>(JSON.stringify(content));

  // Ref holding the latest content so `saveNow` can read it without being
  // re-created (and without going stale) on every render. Updated in an effect
  // (not during render) to satisfy the React Compiler.
  const latestContentRef = useRef<T>(content);
  useEffect(() => {
    latestContentRef.current = content;
  }, [content]);

  // Ref to the pending debounce timer so `saveNow` can cancel it before
  // saving immediately.
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a stable reference to the latest saveFn without re-triggering the
  // debounce effect when the caller passes a new function identity.
  const saveFnRef = useRef(saveFn);
  useEffect(() => {
    saveFnRef.current = saveFn;
  }, [saveFn]);

  // Guard against concurrent save invocations — if a save is already
  // in-flight, skip the new invocation to avoid race conditions and status
  // flickering.
  const isSavingRef = useRef(false);

  const executeSave = useCallback(async (contentToSave: T) => {
    if (isSavingRef.current) return;

    const serialized = JSON.stringify(contentToSave);

    // No-op if content hasn't changed since the last save.
    if (serialized === lastSavedContentRef.current) {
      return;
    }

    isSavingRef.current = true;
    setStatus('saving');

    try {
      await saveFnRef.current(contentToSave);
      lastSavedContentRef.current = serialized;
      setLastSavedAt(new Date());
      setStatus('saved');
      // Clear dirty state on a successful save.
      setIsDirty(false);
    } catch {
      setStatus('error');
    } finally {
      isSavingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const serialized = JSON.stringify(content);

    // Don't schedule a timer if there's nothing new to save.
    if (serialized === lastSavedContentRef.current) {
      setIsDirty(false);
      return;
    }

    // Content differs from the last saved snapshot — mark as dirty.
    setIsDirty(true);

    const timerId = setTimeout(() => {
      void executeSave(content);
    }, interval);
    pendingTimerRef.current = timerId;

    // Each content change clears the previous timer, implementing debounce.
    return () => {
      clearTimeout(timerId);
      if (pendingTimerRef.current === timerId) {
        pendingTimerRef.current = null;
      }
    };
  }, [content, interval, executeSave]);

  const saveNow = useCallback(async () => {
    // Cancel any pending debounced save so it does not fire after this one.
    if (pendingTimerRef.current !== null) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }

    // Reuses `executeSave`'s no-op check (unchanged content) and the in-flight
    // guard, so this is a safe no-op when there is nothing to save or a save is
    // already running.
    await executeSave(latestContentRef.current);
  }, [executeSave]);

  return { status, lastSavedAt, isDirty, saveNow };
}
