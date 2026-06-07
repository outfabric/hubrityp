'use client';

import { useCallStateHooks } from '@stream-io/video-react-sdk';
import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Component
//
// Displays elapsed time since the call started. Format: "MM:SS" or "H:MM:SS"
// after 1 hour. Uses caption style with text-tertiary color per Salvia.
// ---------------------------------------------------------------------------

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');

  if (h > 0) {
    return `${h}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function ElapsedTime() {
  const { useCallStartedAt } = useCallStateHooks();
  const callStartedAt = useCallStartedAt();

  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  // Store start time in a ref so the interval callback is never stale
  useEffect(() => {
    startTimeRef.current = callStartedAt?.getTime() ?? null;
  }, [callStartedAt]);

  useEffect(() => {
    if (!callStartedAt) return;

    // Use an interval (async-safe) to update the elapsed counter every second.
    // The initial value is computed in the first tick (after ~1s), which is
    // acceptable for a timer — avoids the "setState synchronously in effect"
    // lint rule violation from React Compiler.
    const intervalId = setInterval(() => {
      const start = startTimeRef.current;
      if (start === null) return;
      const now = Date.now();
      setElapsed(Math.max(0, Math.floor((now - start) / 1000)));
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [callStartedAt]);

  return (
    <span
      className="text-text-tertiary text-xs font-medium tabular-nums select-none"
      role="timer"
      aria-label="Tempo de sessão"
      data-testid="elapsed-time"
    >
      {formatElapsed(elapsed)}
    </span>
  );
}
