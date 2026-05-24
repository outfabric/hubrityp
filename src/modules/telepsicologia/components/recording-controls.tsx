'use client';

import { useCall } from '@stream-io/video-react-sdk';
import { Circle } from 'lucide-react';
import { useCallback, useState, useTransition } from 'react';

import type { ToggleRecordingResult } from '@/modules/telepsicologia';
import { Button } from '@/shared/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';

import type { RecordingStateEventPayload } from '../lib/chat-types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RecordingControlsProps {
  roomId: string;
  /** Whether the patient has valid recording consent (signed and not revoked). */
  hasConsent: boolean;
  /** Whether the room is currently recording. */
  isRecording: boolean;
  /** Server Action that toggles recording start/stop. */
  onToggleRecording: (input: {
    room_id: string;
    action: 'start' | 'stop';
  }) => Promise<ToggleRecordingResult>;
  /** Callback fired after a successful recording state change. */
  onRecordingChange?: (isRecording: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
//
// Recording toggle button for the psychologist's call control bar.
// Three visual states:
//   1. Disabled (no consent) — grey button with tooltip explaining why.
//   2. Enabled idle — "Iniciar gravacao" button ready to start.
//   3. Recording — red dot + "Gravando" indicator + "Parar gravacao" button.
//
// Calls the toggleRecording Server Action. Errors are surfaced via console
// only (no toast dependency) — the button resets to its previous state.
// ---------------------------------------------------------------------------

export function RecordingControls({
  roomId,
  hasConsent,
  isRecording,
  onToggleRecording,
  onRecordingChange,
}: RecordingControlsProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const call = useCall();

  const handleToggle = useCallback(() => {
    const action = isRecording ? 'stop' : 'start';
    setError(null);

    startTransition(async () => {
      const result = await onToggleRecording({ room_id: roomId, action });

      if (result.ok) {
        const newRecordingState = !isRecording;
        onRecordingChange?.(newRecordingState);

        // Broadcast recording state to patient via Stream custom event
        // so the patient's browser can display the recording banner
        // (LGPD Art. 9 — real-time notification of recording).
        if (call) {
          const payload: RecordingStateEventPayload = {
            type: 'recording-state-changed',
            isRecording: newRecordingState,
          };
          void call.sendCustomEvent(payload).catch(() => {
            // Best-effort — the banner is a UX enhancement; recording
            // consent was already validated server-side before the call
            // to toggleRecording succeeded.
          });
        }
      } else {
        // Surface a generic message — no internal details leaked
        const message =
          result.code === 'CONSENT_REQUIRED'
            ? 'Consentimento de gravacao nao encontrado.'
            : 'Erro ao alterar gravacao. Tente novamente.';
        setError(message);
      }
    });
  }, [isRecording, onToggleRecording, roomId, onRecordingChange, call]);

  // State 1: disabled — no consent
  if (!hasConsent) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="ghost"
                size="sm"
                disabled
                aria-label="Gravar sessao"
                data-testid="recording-button-disabled"
              >
                <Circle className="mr-1 h-4 w-4" aria-hidden="true" />
                Gravar sessao
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent data-testid="recording-no-consent-tooltip">
            <p>Paciente nao assinou termo de gravacao</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // State 3: recording active
  if (isRecording) {
    return (
      <div className="flex items-center gap-2" data-testid="recording-active-indicator">
        {/* Red dot + "Gravando" label */}
        <div className="flex items-center gap-1" aria-live="polite">
          <span
            className="bg-danger-500 inline-block h-2.5 w-2.5 animate-pulse rounded-full"
            aria-hidden="true"
            data-testid="recording-red-dot"
          />
          <span className="text-danger-700 text-sm font-medium">Gravando</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleToggle}
          disabled={isPending}
          aria-label="Parar gravacao"
          data-testid="recording-stop-button"
        >
          {isPending ? 'Parando...' : 'Parar gravacao'}
        </Button>

        {error && (
          <span className="text-danger-600 text-xs" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  // State 2: idle — consent valid, ready to start
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleToggle}
        disabled={isPending}
        aria-label="Iniciar gravacao"
        data-testid="recording-start-button"
      >
        <Circle className="mr-1 h-4 w-4" aria-hidden="true" />
        {isPending ? 'Iniciando...' : 'Iniciar gravacao'}
      </Button>

      {error && (
        <span className="text-danger-600 text-xs" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
