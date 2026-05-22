'use client';

import {
  ScreenShareButton,
  ToggleAudioPublishingButton,
  ToggleVideoPublishingButton,
} from '@stream-io/video-react-sdk';
import { MessageSquare, PhoneOff } from 'lucide-react';
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
  onAdmitPatient: (roomId: string) => Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Component
//
// Bottom controls bar with mic, camera, screen share, chat (placeholder),
// and end call button. Uses Stream SDK's built-in toggle buttons for
// mic/camera/screen share and a custom end call button with confirmation.
// ---------------------------------------------------------------------------

export function CallControlBar({ room, onEndSession }: CallControlBarProps) {
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

        {/* Chat toggle — placeholder for change 4 */}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Abrir chat"
          disabled
          title="Chat (em breve)"
        >
          <MessageSquare className="h-5 w-5" aria-hidden="true" />
        </Button>

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
