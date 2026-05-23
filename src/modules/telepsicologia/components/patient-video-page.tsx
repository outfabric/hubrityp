'use client';

import { useCallback, useEffect, useState } from 'react';

import { BrowserCheck } from './browser-check';
import { PatientInCallView } from './patient-in-call-view';
import { SessionEndedView } from './session-ended-view';
import { TooEarlyView } from './too-early-view';
import { WaitingRoomView } from './waiting-room-view';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PatientVideoPageProps {
  token: string;
}

// ---------------------------------------------------------------------------
// State machine — discriminated union for the page status
// ---------------------------------------------------------------------------

type PageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'too_early';
      psychologistName: string | null;
      psychologistPhotoUrl: string | null;
      sessionStartAt: string;
    }
  | {
      status: 'waiting';
      psychologistName: string | null;
      psychologistPhotoUrl: string | null;
    }
  | {
      status: 'active';
      streamToken: string;
      apiKey: string;
      callId: string;
      psychologistName: string | null;
      psychologistPhotoUrl: string | null;
    }
  | { status: 'ended'; psychologistName: string | null };

// ---------------------------------------------------------------------------
// Component
//
// Client component for the patient video join flow. On mount, POSTs the
// token to /api/video/join and routes to the correct view based on the
// response status: too_early, waiting, active, or ended/expired.
//
// The BrowserCheck guard wraps the entire component tree to prevent
// Stream SDK import on unsupported browsers.
//
// State transitions:
//   loading -> too_early | waiting | active | ended | error
//   waiting -> active (via polling in WaitingRoomView)
//   active  -> ended (via call end in PatientInCallView)
// ---------------------------------------------------------------------------

export function PatientVideoPage({ token }: PatientVideoPageProps) {
  const [state, setState] = useState<PageState>({ status: 'loading' });

  // Initial fetch on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchStatus() {
      try {
        const res = await fetch('/api/video/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        if (cancelled) return;

        if (res.status === 404) {
          setState({
            status: 'error',
            message: 'Link inválido ou sessão não encontrada.',
          });
          return;
        }

        if (res.status === 410) {
          // The 410 body may include psychologistName for a personalised ended message.
          const endedData = (await res.json()) as {
            error: string;
            psychologistName?: string | null;
          };
          setState({
            status: 'ended',
            psychologistName: endedData.psychologistName ?? null,
          });
          return;
        }

        if (!res.ok) {
          setState({
            status: 'error',
            message: 'Erro ao carregar a sessão. Tente novamente em alguns instantes.',
          });
          return;
        }

        const data = (await res.json()) as {
          status: string;
          psychologistName?: string | null;
          psychologistPhotoUrl?: string | null;
          sessionStartAt?: string;
          streamToken?: string;
          apiKey?: string;
          callId?: string;
        };

        if (cancelled) return;

        switch (data.status) {
          case 'too_early':
            setState({
              status: 'too_early',
              psychologistName: data.psychologistName ?? null,
              psychologistPhotoUrl: data.psychologistPhotoUrl ?? null,
              sessionStartAt: data.sessionStartAt ?? new Date().toISOString(),
            });
            break;

          case 'waiting':
            setState({
              status: 'waiting',
              psychologistName: data.psychologistName ?? null,
              psychologistPhotoUrl: data.psychologistPhotoUrl ?? null,
            });
            break;

          case 'active':
            setState({
              status: 'active',
              streamToken: data.streamToken!,
              apiKey: data.apiKey!,
              callId: data.callId!,
              psychologistName: data.psychologistName ?? null,
              psychologistPhotoUrl: data.psychologistPhotoUrl ?? null,
            });
            break;

          default:
            setState({
              status: 'error',
              message: 'Resposta inesperada do servidor.',
            });
        }
      } catch {
        if (cancelled) return;
        setState({
          status: 'error',
          message: 'Erro de conexão. Verifique sua internet e tente novamente.',
        });
      }
    }

    void fetchStatus();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Callback: waiting -> active transition (from WaitingRoomView poll)
  const handleActive = useCallback(
    (data: { streamToken: string; apiKey: string; callId: string }) => {
      setState((prev) => ({
        status: 'active' as const,
        streamToken: data.streamToken,
        apiKey: data.apiKey,
        callId: data.callId,
        psychologistName: prev.status === 'waiting' ? prev.psychologistName : null,
        psychologistPhotoUrl: prev.status === 'waiting' ? prev.psychologistPhotoUrl : null,
      }));
    },
    [],
  );

  // Callback: active -> ended transition (from PatientInCallView)
  const handleCallEnded = useCallback(() => {
    setState((prev) => ({
      status: 'ended' as const,
      psychologistName: prev.status === 'active' ? prev.psychologistName : null,
    }));
  }, []);

  // Render based on state
  return <BrowserCheck>{renderContent(state, token, handleActive, handleCallEnded)}</BrowserCheck>;
}

// ---------------------------------------------------------------------------
// View router — pure function, no hooks
// ---------------------------------------------------------------------------

function renderContent(
  state: PageState,
  token: string,
  onActive: (data: { streamToken: string; apiKey: string; callId: string }) => void,
  onCallEnded: () => void,
) {
  switch (state.status) {
    case 'loading':
      return (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div
            className="border-border h-12 w-12 animate-spin rounded-full border-4 border-t-transparent"
            role="status"
            aria-label="Carregando"
          />
          <p className="text-text-secondary text-[15px]">Carregando...</p>
        </div>
      );

    case 'error':
      return (
        <div className="flex min-h-[60vh] items-center justify-center px-4">
          <div className="max-w-[480px] text-center">
            <p className="text-text-secondary text-[15px]">{state.message}</p>
          </div>
        </div>
      );

    case 'too_early':
      return (
        <TooEarlyView
          psychologistName={state.psychologistName}
          psychologistPhotoUrl={state.psychologistPhotoUrl}
          sessionStartAt={state.sessionStartAt}
        />
      );

    case 'waiting':
      return (
        <WaitingRoomView
          psychologistName={state.psychologistName}
          psychologistPhotoUrl={state.psychologistPhotoUrl}
          token={token}
          onActive={onActive}
        />
      );

    case 'active':
      return (
        <PatientInCallView
          streamToken={state.streamToken}
          apiKey={state.apiKey}
          callId={state.callId}
          psychologistName={state.psychologistName}
          token={token}
          onCallEnded={onCallEnded}
        />
      );

    case 'ended':
      return <SessionEndedView psychologistName={state.psychologistName} />;
  }
}
