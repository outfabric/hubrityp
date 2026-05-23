'use client';

import { useCall, useCallStateHooks } from '@stream-io/video-react-sdk';
import { Signal, SignalLow, SignalZero } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum interval between consecutive degradation toasts (ms). */
const DEGRADATION_DEBOUNCE_MS = 30_000;

// Module-level timestamp so the debounce survives component remounts
// (e.g., React Strict Mode double-mounting, error boundary recovery).
// Only one ConnectionQualityIndicator is ever mounted at a time.
let lastDegradationToastTimestamp = 0;

/** @internal — exposed for test cleanup only. */
export function _resetDegradationDebounce() {
  lastDegradationToastTimestamp = 0;
}

// ---------------------------------------------------------------------------
// Component
//
// 3-bar icon reflecting the local participant's connection quality.
// Shows an instability banner when the quality is poor, and fires a Sonner
// warning toast with a "Reduzir qualidade" action button that lowers the
// camera resolution to 320x240 for the remainder of the call.
//
// Stream's ConnectionQuality enum values (from SFU protobuf):
//   UNSPECIFIED = 0, POOR = 1, GOOD = 2, EXCELLENT = 3
// We compare via Number() to avoid @typescript-eslint/no-unsafe-enum-comparison.
// ---------------------------------------------------------------------------

export function ConnectionQualityIndicator() {
  const { useLocalParticipant } = useCallStateHooks();
  const localParticipant = useLocalParticipant();
  const call = useCall();

  const quality = localParticipant?.connectionQuality;

  const { icon, colorClass, label, showBanner, isPoor } = useMemo(() => {
    const q = Number(quality ?? 0);

    if (q >= 2) {
      // GOOD (2) or EXCELLENT (3) — green
      return {
        icon: Signal,
        colorClass: 'text-success-500',
        label: 'Conexao boa',
        showBanner: false,
        isPoor: false,
      };
    }

    if (q === 1) {
      // POOR — red with instability banner
      return {
        icon: SignalZero,
        colorClass: 'text-danger-500',
        label: 'Conexao ruim',
        showBanner: true,
        isPoor: true,
      };
    }

    // UNSPECIFIED (0) — treat as degraded/unknown
    return {
      icon: SignalLow,
      colorClass: 'text-warning-500',
      label: 'Conexao instavel',
      showBanner: false,
      isPoor: false,
    };
  }, [quality]);

  // Show a Sonner warning toast when quality drops to poor, debounced to
  // avoid spamming the user during intermittent fluctuations.
  useEffect(() => {
    if (!isPoor || !call) return;

    const now = Date.now();
    if (now - lastDegradationToastTimestamp < DEGRADATION_DEBOUNCE_MS) return;

    lastDegradationToastTimestamp = now;

    toast.warning('Sua conexao esta instavel', {
      action: {
        label: 'Reduzir qualidade',
        onClick: () => {
          void call.camera.selectTargetResolution({ width: 320, height: 240 });
        },
      },
      duration: 10_000,
    });
  }, [isPoor, call]);

  const Icon = icon;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className={`${colorClass} flex items-center gap-1`} role="status" aria-label={label}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>

      {showBanner && (
        <div
          className="bg-danger-50 text-danger-700 animate-in fade-in rounded-lg px-3 py-1.5 text-xs font-medium"
          role="alert"
        >
          Sua conexao esta instavel
        </div>
      )}
    </div>
  );
}
