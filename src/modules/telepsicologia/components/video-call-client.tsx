'use client';

import type { Session } from '@/shared/db/schema/agenda/tables';
import type { VideoRoom } from '@/shared/db/schema/telepsicologia/tables';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VideoCallClientProps {
  /** Stream.io call identifier (e.g. "session-<uuid>"). */
  streamCallId: string;
  /** Stream JWT for the psychologist to join the call. */
  token: string;
  /** Public Stream API key (NEXT_PUBLIC_STREAM_API_KEY). */
  apiKey: string;
  /** Authenticated psychologist's Supabase user ID. */
  userId: string;
  /** Clinical session metadata. */
  session: Pick<Session, 'id' | 'startAt' | 'endAt' | 'status' | 'patientId'>;
  /** Patient display info. */
  patient: { id: string; fullName: string } | null;
  /** Video room row from the database. */
  room: VideoRoom;
}

// ---------------------------------------------------------------------------
// Placeholder component
//
// Section 4 will REPLACE this implementation with the full Stream SDK
// integration. The placeholder exists so that typecheck/build pass for the
// dynamic import boundary set up in Section 3.
// ---------------------------------------------------------------------------

export default function VideoCallClient(props: VideoCallClientProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sessao de video</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-secondary text-sm">
            {props.patient
              ? `Carregando sessao de video com ${props.patient.fullName}...`
              : 'Carregando sessao de video...'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
