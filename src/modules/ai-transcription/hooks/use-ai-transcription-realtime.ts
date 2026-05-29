'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { createBrowserClient } from '@/shared/supabase/client';

// ---------------------------------------------------------------------------
// Channel / event contract
//
// These constants MUST stay in lockstep with the server-side broadcaster at
// `src/modules/ai-transcription/server/realtime/broadcast.ts`. The broadcaster
// (run from an Inngest job, with no user session) sends on channel
// `user:<userId>` with event `ai-transcription:ready` and a payload that only
// carries the `transcriptionId`. The spec text describes the channel as
// `ai-transcription:user:<userId>` / event `ready`, but the wire contract that
// actually exists in the codebase is the one mirrored here — aligning to the
// real broadcaster is what makes the notification fire at all.
// ---------------------------------------------------------------------------

const READY_EVENT = 'ai-transcription:ready';

/** Channel name for a given user. Derived from the session UUID, never input. */
function userChannelName(userId: string): string {
  return `user:${userId}`;
}

/** TanStack Query keys invalidated when a transcription becomes ready. */
const TRANSCRIPTIONS_LIST_KEY = ['ai-transcriptions', 'list'] as const;
const TRANSCRIPTIONS_READY_COUNT_KEY = ['ai-transcriptions', 'ready-count'] as const;

// ---------------------------------------------------------------------------
// Payload typing
// ---------------------------------------------------------------------------

/**
 * Shape of the broadcast payload. The realtime channel is untrusted transport,
 * so we treat the incoming `payload` defensively and only act when a non-empty
 * `transcriptionId` string is present. We do NOT trust it for any authorization
 * decision — it only builds the review link the user may click.
 */
interface ReadyBroadcastPayload {
  transcriptionId?: unknown;
}

function extractTranscriptionId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const candidate = (payload as ReadyBroadcastPayload).transcriptionId;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Subscribes to the authenticated user's AI-transcription realtime channel and,
 * when a transcription becomes ready, invalidates the relevant TanStack Query
 * caches and surfaces a Sonner toast with a "Ver" action linking to the review
 * page.
 *
 * The subscription is created on mount and torn down on unmount (or when
 * `userId` changes). Passing an empty/falsy `userId` is a no-op — the hook
 * simply does not subscribe (e.g., before the session is known).
 *
 * `userId` comes from the server-side session (passed down by the layout
 * boundary), never from client-controlled input.
 */
export function useAiTranscriptionRealtime(userId: string | null | undefined): void {
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (!userId) {
      return;
    }

    const supabase = createBrowserClient();
    const channel = supabase
      .channel(userChannelName(userId))
      .on('broadcast', { event: READY_EVENT }, ({ payload }) => {
        void queryClient.invalidateQueries({ queryKey: TRANSCRIPTIONS_LIST_KEY });
        void queryClient.invalidateQueries({ queryKey: TRANSCRIPTIONS_READY_COUNT_KEY });

        const transcriptionId = extractTranscriptionId(payload);

        toast('Nova nota IA pronta para revisão', {
          action: transcriptionId
            ? {
                label: 'Ver',
                onClick: () => {
                  router.push(`/dashboard/transcricoes/${transcriptionId}/revisar`);
                },
              }
            : undefined,
        });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient, router]);
}
