'use client';

import { useCallStateHooks } from '@stream-io/video-react-sdk';
import { MonitorOff } from 'lucide-react';
import { useCallback } from 'react';

// ---------------------------------------------------------------------------
// Component
//
// Overlay banner shown when the local psychologist is sharing their screen.
// Displays "Voce esta compartilhando sua tela" with a "Parar de compartilhar"
// button that stops the share via Stream SDK.
//
// `useScreenShareState().isMute` follows Stream's convention:
//   isMute === false → screen share is ACTIVE (publishing)
//   isMute === true  → screen share is INACTIVE (not publishing)
// ---------------------------------------------------------------------------

export function ScreenShareIndicator() {
  const { useScreenShareState } = useCallStateHooks();
  const { screenShare, isMute: isScreenShareMuted } = useScreenShareState();

  // isMute false means the screen share track is active (publishing)
  const isSharing = !isScreenShareMuted;

  const handleStopSharing = useCallback(() => {
    void screenShare.disable();
  }, [screenShare]);

  if (!isSharing) return null;

  return (
    <div
      className="bg-surface/90 border-border animate-in fade-in slide-in-from-top-2 pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-2 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      data-testid="screen-share-indicator"
    >
      <span className="text-text-primary text-sm font-medium">
        Você está compartilhando sua tela
      </span>
      <button
        type="button"
        onClick={handleStopSharing}
        className="text-danger-500 hover:text-danger-700 flex items-center gap-1.5 text-sm font-medium transition-colors"
        data-testid="stop-screen-share-button"
      >
        <MonitorOff className="h-4 w-4" aria-hidden="true" />
        Parar de compartilhar
      </button>
    </div>
  );
}
