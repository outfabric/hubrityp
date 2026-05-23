'use client';

// Stream SDK CSS — scoped to this component only (loaded via dynamic import
// with ssr:false in video-call-loader.tsx) so styles do not leak globally.
import '@stream-io/video-react-sdk/dist/css/styles.css';

import {
  CallingState,
  StreamCall,
  StreamVideo,
  StreamVideoClient,
  useCallStateHooks,
} from '@stream-io/video-react-sdk';
import { useEffect, useMemo, useState } from 'react';

import type { CreateEvolutionInput, EvolutionSummary } from '@/modules/medical-records/client';
import type { EndVideoSessionResult } from '@/modules/telepsicologia';
import type { Session } from '@/shared/db/schema/agenda/tables';
import type { VideoRoom } from '@/shared/db/schema/telepsicologia/tables';

import { InCallView } from './in-call-view';
import { PostCallView } from './post-call-view';
import { PreCallLobby } from './pre-call-lobby';

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
  /** Display name for the psychologist in the call. */
  psychologistName: string;
  /** Clinical session metadata. */
  session: Pick<Session, 'id' | 'startAt' | 'endAt' | 'status' | 'patientId'>;
  /** Patient display info. */
  patient: { id: string; fullName: string } | null;
  /** Video room row from the database. */
  room: VideoRoom;
  /** Server Action: end the video session (updates DB + terminates Stream call). */
  onEndSession: (roomId: string) => Promise<EndVideoSessionResult>;
  /** Server Action: admit a patient into the video room (updates DB status). */
  onAdmitPatient: (roomId: string) => Promise<{ ok: boolean }>;
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
// Inner component — must be rendered inside <StreamCall> to use call hooks
// ---------------------------------------------------------------------------

function CallStateRouter({
  patient,
  room,
  onEndSession,
  onAdmitPatient,
  currentUser,
  recentEvolutions,
  onCreateEvolution,
  onUpdateEvolution,
}: Pick<
  VideoCallClientProps,
  | 'patient'
  | 'room'
  | 'onEndSession'
  | 'onAdmitPatient'
  | 'recentEvolutions'
  | 'onCreateEvolution'
  | 'onUpdateEvolution'
> & {
  currentUser: { id: string; name: string };
}) {
  const { useCallCallingState } = useCallStateHooks();
  const callingState = useCallCallingState();

  if (callingState === CallingState.LEFT) {
    return <PostCallView patientId={patient?.id ?? null} />;
  }

  if (callingState === CallingState.JOINED) {
    return (
      <InCallView
        patient={patient}
        room={room}
        onEndSession={onEndSession}
        onAdmitPatient={onAdmitPatient}
        currentUser={currentUser}
        recentEvolutions={recentEvolutions}
        onCreateEvolution={onCreateEvolution}
        onUpdateEvolution={onUpdateEvolution}
      />
    );
  }

  // IDLE, JOINING, UNKNOWN, RINGING — show the lobby
  return <PreCallLobby patient={patient} />;
}

// ---------------------------------------------------------------------------
// Main component — initializes StreamVideoClient and wraps providers
// ---------------------------------------------------------------------------

export default function VideoCallClient({
  streamCallId,
  token,
  apiKey,
  userId,
  psychologistName,
  // session metadata is passed through for future use (e.g., duration limits)
  session: _session, // eslint-disable-line @typescript-eslint/no-unused-vars
  patient,
  room,
  onEndSession,
  onAdmitPatient,
  recentEvolutions,
  onCreateEvolution,
  onUpdateEvolution,
}: VideoCallClientProps) {
  const [client, setClient] = useState<StreamVideoClient>();

  // Memoize the user object to avoid re-creating the client on every render
  const user = useMemo(() => ({ id: userId, name: psychologistName }), [userId, psychologistName]);

  useEffect(() => {
    let cancelled = false;
    const videoClient = new StreamVideoClient({
      apiKey,
      user,
      token,
    });

    // Schedule state update asynchronously to satisfy React Compiler's
    // "no sync setState in effect" rule. The microtask fires after the
    // current render commit but before the next frame paint.
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setClient(videoClient);
      }
    });

    return () => {
      cancelled = true;
      // Disconnect on unmount to clean up WebSocket connections
      videoClient.disconnectUser().catch(() => {
        // Swallow — component unmounted, nothing to do
      });
    };
  }, [apiKey, token, user]);

  // Create the call instance — stable reference keyed on streamCallId
  const call = useMemo(() => {
    if (!client) return undefined;
    return client.call('default', streamCallId);
  }, [client, streamCallId]);

  if (!client || !call) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-text-secondary text-sm">Conectando ao servidor de video...</p>
      </div>
    );
  }

  return (
    // CSS isolation: the `isolate` class creates a new stacking context so
    // Stream's default styles do not interfere with the rest of the app.
    <div className="isolate h-full">
      <StreamVideo client={client}>
        <StreamCall call={call}>
          <CallStateRouter
            patient={patient}
            room={room}
            onEndSession={onEndSession}
            onAdmitPatient={onAdmitPatient}
            currentUser={user}
            recentEvolutions={recentEvolutions}
            onCreateEvolution={onCreateEvolution}
            onUpdateEvolution={onUpdateEvolution}
          />
        </StreamCall>
      </StreamVideo>
    </div>
  );
}
