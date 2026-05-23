'use client';

import { useCallStateHooks } from '@stream-io/video-react-sdk';
import { Signal, SignalLow, SignalZero } from 'lucide-react';
import { useMemo } from 'react';

// ---------------------------------------------------------------------------
// Component
//
// 3-bar icon reflecting the local participant's connection quality.
// Shows an instability banner when the quality is poor.
//
// Stream's ConnectionQuality enum values (from SFU protobuf):
//   UNSPECIFIED = 0, POOR = 1, GOOD = 2, EXCELLENT = 3
// We compare via Number() to avoid @typescript-eslint/no-unsafe-enum-comparison.
// ---------------------------------------------------------------------------

export function ConnectionQualityIndicator() {
  const { useLocalParticipant } = useCallStateHooks();
  const localParticipant = useLocalParticipant();

  const quality = localParticipant?.connectionQuality;

  const { icon, colorClass, label, showBanner } = useMemo(() => {
    const q = Number(quality ?? 0);

    if (q >= 2) {
      // GOOD (2) or EXCELLENT (3) — green
      return {
        icon: Signal,
        colorClass: 'text-success-500',
        label: 'Conexao boa',
        showBanner: false,
      };
    }

    if (q === 1) {
      // POOR — red with instability banner
      return {
        icon: SignalZero,
        colorClass: 'text-danger-500',
        label: 'Conexao ruim',
        showBanner: true,
      };
    }

    // UNSPECIFIED (0) — treat as degraded/unknown
    return {
      icon: SignalLow,
      colorClass: 'text-warning-500',
      label: 'Conexao instavel',
      showBanner: false,
    };
  }, [quality]);

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
