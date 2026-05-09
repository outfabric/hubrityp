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

  // Ref holding the JSON snapshot of the last *successfully* saved content.
  const lastSavedContentRef = useRef<string>(JSON.stringify(content));

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
      return;
    }

    const timerId = setTimeout(() => {
      void executeSave(content);
    }, interval);

    // Each content change clears the previous timer, implementing debounce.
    return () => {
      clearTimeout(timerId);
    };
  }, [content, interval, executeSave]);

  return { status, lastSavedAt };
}
