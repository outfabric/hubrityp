'use client';

// Stream SDK CSS — scoped to this component via the `isolate` container.
import '@stream-io/video-react-sdk/dist/css/styles.css';

import {
  CallingState,
  SpeakerLayout,
  StreamCall,
  StreamVideo,
  StreamVideoClient,
  useCallStateHooks,
} from '@stream-io/video-react-sdk';
import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/shared/ui/button';

import { ConnectionQualityIndicator } from './connection-quality-indicator';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PatientInCallViewProps {
  streamToken: string;
  apiKey: string;
  callId: string;
  psychologistName: string | null;
  /** 64-char hex token used to authenticate log events. */
  token: string;
  /** Called when the call ends (psychologist ends or patient leaves). */
  onCallEnded: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the `user_id` from a Stream JWT payload.
 *
 * The patient JWT is minted server-side with
 * `user_id: 'patient-${session.patientId ?? sessionId}'`. The Stream SDK
 * requires the `User.id` to EXACTLY match the JWT's `user_id` claim —
 * a mismatch causes a 401 on connect. We decode the payload (JWTs are
 * base64url-encoded, not encrypted) rather than hardcoding the id format,
 * so any upstream change to the minting logic propagates automatically.
 */
function extractUserIdFromJwt(jwt: string): string {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  // Base64url -> base64 -> decode
  const payload = parts[1]!;
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const json = atob(base64);
  const parsed = JSON.parse(json) as { user_id?: string };

  if (!parsed.user_id) {
    throw new Error('JWT does not contain user_id claim');
  }

  return parsed.user_id;
}

/**
 * Fire-and-forget POST to /api/video/log. Errors are swallowed because
 * logging is best-effort and must never interrupt the call UX.
 */
function logVideoEvent(videoToken: string, eventType: 'patient_joined' | 'patient_left'): void {
  fetch('/api/video/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: videoToken, event_type: eventType }),
  }).catch(() => {
    // Best-effort — swallow to avoid disrupting the call
  });
}

// ---------------------------------------------------------------------------
// Inner: call controls (simplified patient bar — no screen share, no chat)
// ---------------------------------------------------------------------------

function PatientCallControls({ onLeave }: { onLeave: () => void }) {
  const { useMicrophoneState, useCameraState } = useCallStateHooks();
  const { microphone, isMute: isMicMuted } = useMicrophoneState();
  const { camera, isMute: isCameraMuted } = useCameraState();

  const handleToggleMic = useCallback(() => {
    void microphone.toggle();
  }, [microphone]);

  const handleToggleCamera = useCallback(() => {
    void camera.toggle();
  }, [camera]);

  return (
    <div
      className="bg-surface-muted flex items-center justify-center gap-2 rounded-2xl px-4 py-3"
      role="toolbar"
      aria-label="Controles da videochamada"
    >
      {/* Mic toggle */}
      <Button
        variant={isMicMuted ? 'outline' : 'ghost'}
        size="icon"
        onClick={handleToggleMic}
        aria-label={isMicMuted ? 'Ligar microfone' : 'Desligar microfone'}
      >
        {isMicMuted ? (
          <MicOff className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Mic className="h-5 w-5" aria-hidden="true" />
        )}
      </Button>

      {/* Camera toggle */}
      <Button
        variant={isCameraMuted ? 'outline' : 'ghost'}
        size="icon"
        onClick={handleToggleCamera}
        aria-label={isCameraMuted ? 'Ligar camera' : 'Desligar camera'}
      >
        {isCameraMuted ? (
          <VideoOff className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Video className="h-5 w-5" aria-hidden="true" />
        )}
      </Button>

      {/* Leave call — danger button */}
      <Button
        variant="destructive"
        size="icon"
        onClick={onLeave}
        aria-label="Sair da sessao"
        data-testid="patient-leave-button"
      >
        <PhoneOff className="h-5 w-5" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner: call state router — observes CallingState to detect call end
// ---------------------------------------------------------------------------

function PatientCallContent({ token, onCallEnded }: { token: string; onCallEnded: () => void }) {
  const { useCallCallingState } = useCallStateHooks();
  const callingState = useCallCallingState();
  const hasLoggedJoin = useRef(false);
  const hasLoggedLeave = useRef(false);

  // Log patient_joined when call is JOINED
  useEffect(() => {
    if (callingState === CallingState.JOINED && !hasLoggedJoin.current) {
      hasLoggedJoin.current = true;
      logVideoEvent(token, 'patient_joined');
    }
  }, [callingState, token]);

  // Log patient_left and transition when call ends
  useEffect(() => {
    if (
      (callingState === CallingState.LEFT || callingState === CallingState.IDLE) &&
      hasLoggedJoin.current &&
      !hasLoggedLeave.current
    ) {
      hasLoggedLeave.current = true;
      logVideoEvent(token, 'patient_left');
      onCallEnded();
    }
  }, [callingState, token, onCallEnded]);

  const handleLeave = useCallback(() => {
    if (!hasLoggedLeave.current) {
      hasLoggedLeave.current = true;
      logVideoEvent(token, 'patient_left');
    }
    onCallEnded();
  }, [token, onCallEnded]);

  if (callingState !== CallingState.JOINED && callingState !== CallingState.JOINING) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-text-secondary text-sm">Conectando...</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Connection quality — top-right overlay */}
      <div className="pointer-events-none absolute top-0 right-0 z-10 p-4">
        <div className="pointer-events-auto">
          <ConnectionQualityIndicator />
        </div>
      </div>

      {/* Main video area — SpeakerLayout: psychologist large, patient PiP */}
      <div className="flex-1 overflow-hidden">
        <SpeakerLayout participantsBarPosition="bottom" mirrorLocalParticipantVideo={true} />
      </div>

      {/* Controls bar — bottom */}
      <PatientCallControls onLeave={handleLeave} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
//
// Initializes StreamVideoClient for the patient using the JWT from
// /api/video/join. The user id is decoded from the JWT payload to ensure
// it matches the claim (see extractUserIdFromJwt).
//
// Layout: psychologist video large (~75% viewport), patient PiP
// bottom-right via SpeakerLayout. Simplified controls (mic, camera, leave).
// ConnectionQualityIndicator reused from the psychologist call view.
// No elapsed time. Logs patient_joined/patient_left via /api/video/log.
// ---------------------------------------------------------------------------

export function PatientInCallView({
  streamToken,
  apiKey,
  callId,
  // Accepted for interface consistency — patient display name in the call
  // is always "Paciente" (no PII in the video stream).
  psychologistName: _psychologistName, // eslint-disable-line @typescript-eslint/no-unused-vars
  token,
  onCallEnded,
}: PatientInCallViewProps) {
  const [client, setClient] = useState<StreamVideoClient>();

  // Decode the user_id from the JWT so it matches the token's claim exactly.
  // Memoized because the token is stable for the lifetime of this component.
  const userId = useMemo(() => {
    try {
      return extractUserIdFromJwt(streamToken);
    } catch {
      // Fallback should never happen — the JWT is minted server-side.
      // If it does, the SDK will reject the connection with 401.
      return 'patient-unknown';
    }
  }, [streamToken]);

  // Patient display name is always "Paciente" — no PII exposed in the call
  const user = useMemo(
    () => ({
      id: userId,
      name: 'Paciente',
    }),
    [userId],
  );

  // Initialize StreamVideoClient
  useEffect(() => {
    let cancelled = false;

    const videoClient = new StreamVideoClient({
      apiKey,
      user,
      token: streamToken,
    });

    // Schedule state update asynchronously (React Compiler safe)
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setClient(videoClient);
      }
    });

    return () => {
      cancelled = true;
      videoClient.disconnectUser().catch(() => {
        // Swallow — component unmounted
      });
    };
  }, [apiKey, streamToken, user]);

  // Create the call instance and join immediately
  const call = useMemo(() => {
    if (!client) return undefined;
    const c = client.call('default', callId);
    // Join immediately — patient does not go through a lobby
    void c.join().catch(() => {
      // Join failure is handled by the CallingState observer
    });
    return c;
  }, [client, callId]);

  if (!client || !call) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-text-secondary text-sm">Conectando ao servidor de video...</p>
      </div>
    );
  }

  return (
    <div className="isolate h-full">
      <StreamVideo client={client}>
        <StreamCall call={call}>
          <PatientCallContent token={token} onCallEnded={onCallEnded} />
        </StreamCall>
      </StreamVideo>
    </div>
  );
}
