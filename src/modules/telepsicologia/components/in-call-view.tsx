'use client';

import { SpeakerLayout, useCallStateHooks } from '@stream-io/video-react-sdk';
import { UserCheck } from 'lucide-react';
import { useCallback, useState } from 'react';

import type { EndVideoSessionResult } from '@/modules/telepsicologia';
import type { VideoRoom } from '@/shared/db/schema/telepsicologia/tables';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

import { CallControlBar } from './call-control-bar';
import { ConnectionQualityIndicator } from './connection-quality-indicator';
import { ElapsedTime } from './elapsed-time';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InCallViewProps {
  patient: { id: string; fullName: string } | null;
  room: VideoRoom;
  onEndSession: (roomId: string) => Promise<EndVideoSessionResult>;
  onAdmitPatient: (roomId: string) => Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Component
//
// Active call view: Stream SpeakerLayout with psychologist PiP, controls bar,
// elapsed time, connection quality indicator, and waiting room badge.
// ---------------------------------------------------------------------------

export function InCallView({ patient, room, onEndSession, onAdmitPatient }: InCallViewProps) {
  const { useParticipantCount } = useCallStateHooks();
  const participantCount = useParticipantCount();

  const [isAdmitting, setIsAdmitting] = useState(false);

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

      {/* Main video area — SpeakerLayout handles PiP for local participant */}
      <div className="flex-1 overflow-hidden">
        <SpeakerLayout participantsBarPosition="bottom" mirrorLocalParticipantVideo={true} />
      </div>

      {/* Controls bar — bottom */}
      <CallControlBar room={room} onEndSession={onEndSession} />
    </div>
  );
}
