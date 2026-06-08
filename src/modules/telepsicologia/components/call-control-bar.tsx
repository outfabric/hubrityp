'use client';

import { useCallStateHooks } from '@stream-io/video-react-sdk';
import { FileText, MessageSquare, PhoneOff } from 'lucide-react';
import { useCallback, useState } from 'react';

import type { EndVideoSessionResult, ToggleRecordingResult } from '@/modules/telepsicologia';
import type { VideoRoom } from '@/shared/db/schema/telepsicologia/tables';
import { Button } from '@/shared/ui/button';

import { DeviceToggleButton } from './device-toggle-button';
import { EndCallDialog } from './end-call-dialog';
import { RecordingControls } from './recording-controls';
import { TroubleshootingPopover } from './troubleshooting-popover';

// ---------------------------------------------------------------------------
// PT-BR permission errors
//
// Surfaced inline when a device toggle Promise rejects (browser blocked the
// permission). Consistent with RecordingControls' inline error rendering:
// small danger-colored text inside a role="alert" region.
// ---------------------------------------------------------------------------

const MIC_PERMISSION_ERROR =
  'Não foi possível acessar o microfone. Verifique as permissões do navegador.';
const CAMERA_PERMISSION_ERROR =
  'Não foi possível acessar a câmera. Verifique as permissões do navegador.';
const SCREEN_SHARE_PERMISSION_ERROR =
  'Não foi possível compartilhar a tela. Verifique as permissões do navegador.';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CallControlBarProps {
  room: VideoRoom;
  onEndSession: (roomId: string) => Promise<EndVideoSessionResult>;
  /** Whether the chat drawer is currently open. */
  isChatOpen: boolean;
  /** Toggle the chat drawer open/close. */
  onChatToggle: () => void;
  /** Whether there are unread chat messages (drawer was closed when they arrived). */
  hasUnreadMessages: boolean;
  /** Whether the current user is a psychologist (controls prontuario button visibility). */
  isPsychologist?: boolean;
  /** Whether the prontuario drawer is currently open. */
  isProntuarioOpen?: boolean;
  /** Toggle the prontuario drawer open/close. Psychologist-only. */
  onProntuarioToggle?: () => void;
  /** Whether the patient has valid recording consent. Psychologist-only. */
  hasRecordingConsent?: boolean;
  /** Whether the room is currently recording. Psychologist-only. */
  isRecording?: boolean;
  /** Server Action that toggles recording start/stop. Psychologist-only. */
  onToggleRecording?: (input: {
    room_id: string;
    action: 'start' | 'stop';
  }) => Promise<ToggleRecordingResult>;
  /** Callback fired after a successful recording state change. */
  onRecordingChange?: (isRecording: boolean) => void;
}

// ---------------------------------------------------------------------------
// Inner: device controls (mic, camera, screen share)
//
// Backed by Stream call-state hooks. Mic/camera state comes from the `isMute`
// alias; screen-share active state is derived from `status === 'enabled'`
// (NOT the `isMute` alias — see design D3) and the button is disabled while
// another participant is sharing. Each toggle() returns a Promise; a rejection
// (browser blocked the permission) surfaces a PT-BR inline error.
//
// Screen share is psychologist-only — the caller renders this component only
// for the host, so the screen-share control always belongs to the host.
// ---------------------------------------------------------------------------

function DeviceControls() {
  const { useMicrophoneState, useCameraState, useScreenShareState, useHasOngoingScreenShare } =
    useCallStateHooks();
  const { microphone, isMute: isMicMuted } = useMicrophoneState();
  const { camera, isMute: isCameraMuted } = useCameraState();
  const { screenShare, status: screenShareStatus } = useScreenShareState();

  const isSharing = screenShareStatus === 'enabled';
  const someoneElseSharing = useHasOngoingScreenShare();

  const [permissionError, setPermissionError] = useState<string | null>(null);

  const handleToggleMic = useCallback(() => {
    void microphone
      .toggle()
      .then(() => setPermissionError(null))
      .catch(() => setPermissionError(MIC_PERMISSION_ERROR));
  }, [microphone]);

  const handleToggleCamera = useCallback(() => {
    void camera
      .toggle()
      .then(() => setPermissionError(null))
      .catch(() => setPermissionError(CAMERA_PERMISSION_ERROR));
  }, [camera]);

  const handleToggleScreenShare = useCallback(() => {
    void screenShare
      .toggle()
      .then(() => setPermissionError(null))
      .catch(() => setPermissionError(SCREEN_SHARE_PERMISSION_ERROR));
  }, [screenShare]);

  return (
    <>
      <DeviceToggleButton
        kind="mic"
        isOff={isMicMuted}
        onToggle={handleToggleMic}
        ariaLabel={isMicMuted ? 'Ligar microfone' : 'Desligar microfone'}
        data-testid="mic-toggle-button"
      />

      <DeviceToggleButton
        kind="camera"
        isOff={isCameraMuted}
        onToggle={handleToggleCamera}
        ariaLabel={isCameraMuted ? 'Ligar câmera' : 'Desligar câmera'}
        data-testid="camera-toggle-button"
      />

      <DeviceToggleButton
        kind="screenshare"
        isOff={!isSharing}
        onToggle={handleToggleScreenShare}
        disabled={!isSharing && someoneElseSharing}
        ariaLabel={isSharing ? 'Parar compartilhamento de tela' : 'Compartilhar tela'}
        data-testid="screen-share-toggle-button"
      />

      {permissionError && (
        <span className="text-danger-600 text-xs" role="alert">
          {permissionError}
        </span>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Component
//
// Bottom controls bar with mic, camera, screen share, chat toggle,
// and end call button. Mic/camera/screen-share are rendered via the
// design-system DeviceToggleButton (Lucide icons + shadcn Button) — no
// Stream built-in widgets — backed by Stream call-state hooks.
// ---------------------------------------------------------------------------

export function CallControlBar({
  room,
  onEndSession,
  isChatOpen,
  onChatToggle,
  hasUnreadMessages,
  isPsychologist = false,
  isProntuarioOpen = false,
  onProntuarioToggle,
  hasRecordingConsent = false,
  isRecording = false,
  onToggleRecording,
  onRecordingChange,
}: CallControlBarProps) {
  const [showEndDialog, setShowEndDialog] = useState(false);

  return (
    <>
      <div
        className="bg-surface-muted flex items-center justify-center gap-2 rounded-2xl px-4 py-3"
        role="toolbar"
        aria-label="Controles da sessão de vídeo"
      >
        {/* Mic, camera, screen share — design-system controls backed by Stream hooks */}
        <DeviceControls />

        {/* Chat toggle */}
        <div className="relative">
          <Button
            variant={isChatOpen ? 'outline' : 'ghost'}
            size="icon"
            aria-label={isChatOpen ? 'Fechar chat' : 'Abrir chat'}
            onClick={onChatToggle}
            data-testid="chat-toggle-button"
          >
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
          </Button>
          {/* Unread dot — danger-500, 8px, top-right corner */}
          {hasUnreadMessages && !isChatOpen && (
            <span
              className="bg-danger-500 absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
              aria-label="Mensagens não lidas"
              data-testid="chat-unread-badge"
            />
          )}
        </div>

        {/* Prontuario toggle — psychologist only */}
        {isPsychologist && onProntuarioToggle && (
          <Button
            variant={isProntuarioOpen ? 'outline' : 'ghost'}
            size="icon"
            aria-label={isProntuarioOpen ? 'Fechar prontuário' : 'Abrir prontuário'}
            onClick={onProntuarioToggle}
            data-testid="prontuario-toggle-button"
          >
            <FileText className="h-5 w-5" aria-hidden="true" />
          </Button>
        )}

        {/* Recording controls — psychologist only */}
        {isPsychologist && onToggleRecording && (
          <RecordingControls
            roomId={room.id}
            hasConsent={hasRecordingConsent}
            isRecording={isRecording}
            onToggleRecording={onToggleRecording}
            onRecordingChange={onRecordingChange}
          />
        )}

        {/* Troubleshooting help — psychologist view (no psychologist name) */}
        <TroubleshootingPopover />

        {/* End call — danger button */}
        <Button
          variant="destructive"
          size="icon"
          onClick={() => setShowEndDialog(true)}
          aria-label="Encerrar sessão"
          data-testid="end-call-button"
        >
          <PhoneOff className="h-5 w-5" aria-hidden="true" />
        </Button>
      </div>

      {/* End call confirmation dialog */}
      <EndCallDialog
        open={showEndDialog}
        onOpenChange={setShowEndDialog}
        roomId={room.id}
        onEndSession={onEndSession}
      />
    </>
  );
}
