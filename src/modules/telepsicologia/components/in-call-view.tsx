'use client';

import { SpeakerLayout, useCall, useCallStateHooks } from '@stream-io/video-react-sdk';
import { UserCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CreateEvolutionInput, EvolutionSummary } from '@/modules/medical-records/client';
import type { EndVideoSessionResult } from '@/modules/telepsicologia';
import type { VideoRoom } from '@/shared/db/schema/telepsicologia/tables';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

import type { ChatCustomEventPayload } from '../lib/chat-types';

import { CallControlBar } from './call-control-bar';
import { ChatDrawer } from './chat-drawer';
import { ConnectionQualityIndicator } from './connection-quality-indicator';
import { ElapsedTime } from './elapsed-time';
import { ProntuarioCallDrawer } from './prontuario-call-drawer';
import { ScreenShareIndicator } from './screen-share-indicator';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InCallViewProps {
  patient: { id: string; fullName: string } | null;
  room: VideoRoom;
  onEndSession: (roomId: string) => Promise<EndVideoSessionResult>;
  onAdmitPatient: (roomId: string) => Promise<{ ok: boolean }>;
  /** Authenticated psychologist's user info for chat. */
  currentUser: { id: string; name: string };
  /** Recent evolution summaries for the prontuario drawer (pre-fetched). */
  recentEvolutions: EvolutionSummary[];
  /** Server Action: create a new evolution for the patient. */
  onCreateEvolution: (input: CreateEvolutionInput) => Promise<{ ok: boolean; id?: string }>;
  /** Server Action: update an existing evolution's content. */
  onUpdateEvolution: (input: {
    evolutionId: string;
    content: Record<string, unknown>;
  }) => Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Component
//
// Active call view: Stream SpeakerLayout with psychologist PiP, controls bar,
// elapsed time, connection quality indicator, waiting room badge, and chat
// drawer.
// ---------------------------------------------------------------------------

export function InCallView({
  patient,
  room,
  onEndSession,
  onAdmitPatient,
  currentUser,
  recentEvolutions,
  onCreateEvolution,
  onUpdateEvolution,
}: InCallViewProps) {
  const { useParticipantCount } = useCallStateHooks();
  const participantCount = useParticipantCount();
  const call = useCall();

  const [isAdmitting, setIsAdmitting] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [isProntuarioOpen, setIsProntuarioOpen] = useState(false);

  // Track whether drawer is open via ref for the event listener
  const isChatOpenRef = useRef(isChatOpen);
  useEffect(() => {
    isChatOpenRef.current = isChatOpen;
  }, [isChatOpen]);

  // Listen for incoming chat messages to set unread indicator
  useEffect(() => {
    if (!call) return;

    const unsubscribe = call.on('custom', (event) => {
      const payload = event.custom as Partial<ChatCustomEventPayload> | undefined;
      if (!payload || payload.type !== 'chat-message') return;

      // Only mark unread if drawer is closed and message is not from self
      if (!isChatOpenRef.current && payload.senderId !== currentUser.id) {
        setHasUnreadMessages(true);
      }
    });

    return unsubscribe;
  }, [call, currentUser.id]);

  // If there are participants in the call beyond the psychologist (participantCount includes self),
  // and the room is still pending, show the waiting room badge suggesting someone is in the lobby.
  // participantCount = 1 means only the psychologist is in the call.
  const showWaitingBadge = room.status === 'pending' && participantCount <= 1;

  const handleAdmitPatient = useCallback(() => {
    setIsAdmitting(true);
    onAdmitPatient(room.id)
      .then((result) => {
        if (!result.ok) {
          // Generic error only — no internal details leaked to the client
          console.error('Erro ao admitir paciente');
        }
      })
      .catch(() => {
        console.error('Erro ao admitir paciente');
      })
      .finally(() => {
        setIsAdmitting(false);
      });
  }, [onAdmitPatient, room.id]);

  const handleChatToggle = useCallback(() => {
    setIsChatOpen((prev) => {
      const next = !prev;
      // Clear unread when opening the drawer
      if (next) setHasUnreadMessages(false);
      return next;
    });
  }, []);

  const handleProntuarioToggle = useCallback(() => {
    setIsProntuarioOpen((prev) => !prev);
  }, []);

  return (
    <div className="relative flex h-full flex-col">
      {/* Top overlay bar */}
      <div className="pointer-events-none absolute top-0 right-0 left-0 z-10 flex items-start justify-between p-4">
        {/* Elapsed time — top-left */}
        <div className="pointer-events-auto">
          <ElapsedTime />
        </div>

        {/* Waiting room badge + admit button — top-center */}
        <div className="pointer-events-auto">
          {showWaitingBadge && (
            <div className="flex items-center gap-2" data-testid="waiting-room-badge">
              <Badge variant="warning">{patient?.fullName ?? 'Paciente'} aguardando</Badge>
              <Button
                size="sm"
                onClick={handleAdmitPatient}
                disabled={isAdmitting}
                aria-label="Admitir paciente na sessao"
                data-testid="admit-patient-button"
              >
                <UserCheck className="mr-1 h-4 w-4" aria-hidden="true" />
                {isAdmitting ? 'Admitindo...' : 'Admitir'}
              </Button>
            </div>
          )}
        </div>

        {/* Connection quality — top-right */}
        <div className="pointer-events-auto">
          <ConnectionQualityIndicator />
        </div>
      </div>

      {/* Screen share indicator — bottom of overlay stack, above video */}
      <div className="pointer-events-none absolute right-0 bottom-auto left-0 z-10 flex justify-center pt-16">
        <ScreenShareIndicator />
      </div>

      {/* Main video area — SpeakerLayout handles PiP for local participant
          and automatically switches to show the shared screen as the
          dominant video for both psychologist and patient views. */}
      <div className="flex-1 overflow-hidden">
        <SpeakerLayout participantsBarPosition="bottom" mirrorLocalParticipantVideo={true} />
      </div>

      {/* Controls bar — bottom */}
      <CallControlBar
        room={room}
        onEndSession={onEndSession}
        isChatOpen={isChatOpen}
        onChatToggle={handleChatToggle}
        hasUnreadMessages={hasUnreadMessages}
        isPsychologist={true}
        isProntuarioOpen={isProntuarioOpen}
        onProntuarioToggle={patient ? handleProntuarioToggle : undefined}
      />

      {/* Chat drawer */}
      {call && (
        <ChatDrawer
          open={isChatOpen}
          onOpenChange={(nextOpen) => {
            setIsChatOpen(nextOpen);
            if (nextOpen) setHasUnreadMessages(false);
          }}
          call={call}
          currentUser={currentUser}
        />
      )}

      {/* Prontuario drawer — psychologist only (InCallView is psychologist-only) */}
      {patient && (
        <ProntuarioCallDrawer
          open={isProntuarioOpen}
          onOpenChange={setIsProntuarioOpen}
          patientId={patient.id}
          patientName={patient.fullName}
          recentEvolutions={recentEvolutions}
          onCreateEvolution={onCreateEvolution}
          onUpdateEvolution={onUpdateEvolution}
        />
      )}
    </div>
  );
}
