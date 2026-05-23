'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { DeviceTest } from './device-test';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WaitingRoomViewProps {
  psychologistName: string | null;
  psychologistPhotoUrl: string | null;
  token: string;
  /** Called when the API returns status 'active' with call credentials. */
  onActive: (data: { streamToken: string; apiKey: string; callId: string }) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}

// ---------------------------------------------------------------------------
// Component
//
// Waiting room: the patient has arrived within the time window but the
// psychologist has not admitted them yet (room status = 'pending').
//
// Polls /api/video/join every 10 seconds. When the response changes to
// status 'active', lifts the call credentials to the parent via `onActive`.
//
// Design: centered card (max-w 480px), psychologist avatar, "Aguarde"
// message, pulsing dot (<300ms, respects prefers-reduced-motion), compact
// device check summary.
// ---------------------------------------------------------------------------

export function WaitingRoomView({
  psychologistName,
  psychologistPhotoUrl,
  token,
  onActive,
}: WaitingRoomViewProps) {
  const [pollError, setPollError] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const displayName = psychologistName ?? 'Psicologo';

  // Stable poll function — captured in the interval
  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/video/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        // Non-2xx: might be rate-limited or session ended — keep polling,
        // the parent PatientVideoPage handles terminal states on initial load.
        return;
      }

      const data = (await res.json()) as {
        status?: string;
        streamToken?: string;
        apiKey?: string;
        callId?: string;
      };

      if (data.status === 'active' && data.streamToken && data.apiKey && data.callId) {
        onActive({
          streamToken: data.streamToken,
          apiKey: data.apiKey,
          callId: data.callId,
        });
      }
    } catch {
      // Transient network error — surface indicator, keep polling
      setPollError(true);
    }
  }, [token, onActive]);

  // Set up polling interval (10s).
  // The initial poll is deferred via setTimeout to avoid synchronous
  // setState inside the effect body (React Compiler rule).
  useEffect(() => {
    const initialTimeout = setTimeout(() => {
      void poll();
    }, 0);

    intervalRef.current = setInterval(() => {
      void poll();
    }, 10_000);

    return () => {
      clearTimeout(initialTimeout);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [poll]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-[480px]">
        <CardHeader className="items-center text-center">
          {/* Psychologist avatar */}
          <Avatar className="mb-2 h-14 w-14">
            {psychologistPhotoUrl && (
              <AvatarImage src={psychologistPhotoUrl} alt={`Foto de ${displayName}`} />
            )}
            <AvatarFallback className="bg-brand-100 text-brand-700 text-lg">
              {getInitials(displayName)}
            </AvatarFallback>
          </Avatar>

          <CardTitle>{displayName}</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4 text-center">
          {/* Waiting message with pulsing dot */}
          <div className="flex items-center justify-center gap-2">
            {/* Pulsing dot — animation < 300ms cycle, respects prefers-reduced-motion */}
            <span
              className="bg-brand-500 inline-block h-2.5 w-2.5 rounded-full motion-safe:animate-pulse"
              aria-hidden="true"
              style={{
                animationDuration: '1.5s',
              }}
            />
            <p className="text-text-secondary text-[15px]">
              Aguarde, {displayName} vai admitir voce em breve
            </p>
          </div>

          {/* Network error indicator */}
          {pollError && (
            <p className="text-warning-700 text-xs" role="status">
              Dificuldade de conexao. Tentando novamente...
            </p>
          )}

          {/* Device check summary (compact mode) */}
          <div className="pt-2">
            <DeviceTest compact />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
