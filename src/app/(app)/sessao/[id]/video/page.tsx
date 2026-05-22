import { and, eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { VideoCallLoader } from '@/modules/telepsicologia/components/video-call-loader';
import { db } from '@/shared/db/client';
import { sessions } from '@/shared/db/schema/agenda/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { patients } from '@/shared/db/schema/patients/tables';
import { videoRooms } from '@/shared/db/schema/telepsicologia/tables';
import { clientEnv } from '@/shared/env/client';
import { createServerClient } from '@/shared/supabase/server';

import { admitPatient, endVideoSession } from './actions';
import { CreateRoomCard } from './create-room-card';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VideoCallPageProps {
  params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// Page component (Server Component)
// ---------------------------------------------------------------------------

export default async function VideoCallPage({ params }: VideoCallPageProps) {
  const { id: sessionId } = await params;
  const supabase = await createServerClient();

  // 1. Authenticate — defense-in-depth (middleware already gates /sessao/*)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const userId = user.id;

  // 2. Load session by ID, scoped to the authenticated psychologist
  const [session] = await db
    .select({
      id: sessions.id,
      startAt: sessions.startAt,
      endAt: sessions.endAt,
      status: sessions.status,
      modality: sessions.modality,
      patientId: sessions.patientId,
    })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
    .limit(1);

  if (!session) {
    notFound();
  }

  // 3. Verify modality is 'online' — in-person sessions have no video room
  if (session.modality !== 'online') {
    redirect('/agenda');
  }

  // 4. Load patient info (for display in the call UI)
  let patient: { id: string; fullName: string } | null = null;
  if (session.patientId) {
    const [patientRow] = await db
      .select({ id: patients.id, fullName: patients.fullName })
      .from(patients)
      .where(and(eq(patients.id, session.patientId), eq(patients.userId, userId)))
      .limit(1);

    if (patientRow) {
      patient = patientRow;
    }
  }

  // 5. Load psychologist profile for display name in the call
  const [profile] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  const psychologistName = profile?.fullName ?? 'Psicologo';

  // 6. Load video room for this session
  const [room] = await db
    .select()
    .from(videoRooms)
    .where(and(eq(videoRooms.sessionId, sessionId), eq(videoRooms.userId, userId)))
    .limit(1);

  // 7. No room: show "create room" UI
  if (!room) {
    return <CreateRoomCard sessionId={sessionId} patientName={patient?.fullName ?? null} />;
  }

  // 8. Room exists: mint a psychologist token to join the call
  //    getVideoToken validates ownership + room status internally.
  const { getVideoToken } = await import('./actions');
  const tokenResult = await getVideoToken(room.id);

  if (!tokenResult.ok) {
    // Room exists but token generation failed (room ended/expired or unknown)
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="bg-surface border-border rounded-xl border p-8 text-center shadow-sm">
          <h2 className="text-text-primary mb-2 text-lg font-semibold">Sala indisponivel</h2>
          <p className="text-text-secondary text-sm">
            Esta sala de video nao esta mais disponivel. Retorne para a agenda.
          </p>
        </div>
      </div>
    );
  }

  // 9. Pass everything to the client component
  return (
    <VideoCallLoader
      streamCallId={room.streamCallId}
      token={tokenResult.token}
      apiKey={clientEnv.NEXT_PUBLIC_STREAM_API_KEY}
      userId={userId}
      psychologistName={psychologistName}
      session={{
        id: session.id,
        startAt: session.startAt,
        endAt: session.endAt,
        status: session.status,
        patientId: session.patientId,
      }}
      patient={patient}
      room={room}
      onEndSession={endVideoSession}
      onAdmitPatient={admitPatient}
    />
  );
}
