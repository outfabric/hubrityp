'use client';

import {
  ScreenShareButton,
  ToggleAudioPublishingButton,
  ToggleVideoPublishingButton,
} from '@stream-io/video-react-sdk';
import { FileText, MessageSquare, PhoneOff } from 'lucide-react';
import { useState } from 'react';

import type { EndVideoSessionResult } from '@/modules/telepsicologia';
import type { VideoRoom } from '@/shared/db/schema/telepsicologia/tables';
import { Button } from '@/shared/ui/button';

import { EndCallDialog } from './end-call-dialog';

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
}

// ---------------------------------------------------------------------------
// Component
//
// Bottom controls bar with mic, camera, screen share, chat toggle,
// and end call button. Uses Stream SDK's built-in toggle buttons for
// mic/camera/screen share and a custom end call button with confirmation.
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
}: CallControlBarProps) {
  const [showEndDialog, setShowEndDialog] = useState(false);

  return (
    <>
      <div
        className="bg-surface-muted flex items-center justify-center gap-2 rounded-2xl px-4 py-3"
        role="toolbar"
        aria-label="Controles da sessao de video"
      >
        {/* Mic toggle — Stream's built-in button with custom aria-label */}
        <ToggleAudioPublishingButton caption="Microfone" />

        {/* Camera toggle */}
        <ToggleVideoPublishingButton caption="Camera" />

        {/* Screen share — psychologist only (always shown for the host) */}
        <ScreenShareButton caption="Compartilhar tela" />

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
              aria-label="Mensagens nao lidas"
              data-testid="chat-unread-badge"
            />
          )}
        </div>

        {/* Prontuario toggle — psychologist only */}
        {isPsychologist && onProntuarioToggle && (
          <Button
            variant={isProntuarioOpen ? 'outline' : 'ghost'}
            size="icon"
            aria-label={isProntuarioOpen ? 'Fechar prontuario' : 'Abrir prontuario'}
            onClick={onProntuarioToggle}
            data-testid="prontuario-toggle-button"
          >
            <FileText className="h-5 w-5" aria-hidden="true" />
          </Button>
        )}

        {/* End call — danger button */}
        <Button
          variant="destructive"
          size="icon"
          onClick={() => setShowEndDialog(true)}
          aria-label="Encerrar sessao"
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
