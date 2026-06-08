'use client';

import {
  Mic,
  MicOff,
  ScreenShare,
  ScreenShareOff,
  Video,
  VideoOff,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DeviceKind = 'mic' | 'camera' | 'screenshare';

interface DeviceToggleButtonProps {
  kind: DeviceKind;
  /** true = off/muted (variant "outline"); false = on (variant "ghost"). */
  isOff: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Required PT-BR label for the standalone icon button. */
  ariaLabel: string;
  'data-testid'?: string;
}

// ---------------------------------------------------------------------------
// Icon map
//
// Each device kind maps to an [on, off] pair of Lucide icons. The component is
// purely presentational: it never calls Stream hooks. Callers own the device
// state and pass `isOff` + `onToggle` down, which keeps this leaf trivial to
// unit test and consistent across the lobby, patient bar, and psychologist bar.
// ---------------------------------------------------------------------------

const ICONS: Record<DeviceKind, { on: LucideIcon; off: LucideIcon }> = {
  mic: { on: Mic, off: MicOff },
  camera: { on: Video, off: VideoOff },
  screenshare: { on: ScreenShare, off: ScreenShareOff },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeviceToggleButton({
  kind,
  isOff,
  onToggle,
  disabled,
  ariaLabel,
  'data-testid': dataTestId,
}: DeviceToggleButtonProps) {
  const Icon = isOff ? ICONS[kind].off : ICONS[kind].on;

  return (
    <Button
      type="button"
      size="icon"
      variant={isOff ? 'outline' : 'ghost'}
      onClick={onToggle}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={dataTestId}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </Button>
  );
}
