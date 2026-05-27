import 'server-only';

import { createClient } from '@supabase/supabase-js';

import type { TranscriptionId } from '@/modules/ai-transcription/lib/branded-types';
import { createTranscriptionLogger } from '@/modules/ai-transcription/lib/logger';
import { clientEnv } from '@/shared/env/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BroadcastAiReadyInput {
  userId: string;
  transcriptionId: TranscriptionId;
}

interface BroadcastAiReadyDeps {
  /**
   * Supabase service-role key, injected to avoid importing serverEnv at
   * module level (keeps tests from needing the full env).
   */
  serviceRoleKey: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Broadcasts a `ai-transcription:ready` event via Supabase Realtime so the
 * client UI can refresh without polling.
 *
 * Uses service-role because Inngest functions do not have a user session.
 * Service-role justification: system-level notification, no user input
 * controls the channel name (it is derived from the userId UUID).
 *
 * Errors are swallowed and logged — the broadcast is best-effort; the
 * transcription result is already persisted and the user can refresh.
 */
export async function broadcastAiReady(
  input: BroadcastAiReadyInput,
  deps: BroadcastAiReadyDeps,
): Promise<void> {
  const log = createTranscriptionLogger({
    transcriptionId: input.transcriptionId,
    userId: input.userId,
  });

  try {
    const supabase = createClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, deps.serviceRoleKey);

    const channel = supabase.channel(`user:${input.userId}`);

    await channel.send({
      type: 'broadcast',
      event: 'ai-transcription:ready',
      payload: {
        transcriptionId: input.transcriptionId,
      },
    });

    // Unsubscribe immediately — we only needed to send one message.
    await supabase.removeChannel(channel);

    log.info(
      { event: 'realtime_broadcast_sent' },
      'Broadcast ai-transcription:ready to user channel',
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown';
    log.error(
      { event: 'realtime_broadcast_failed', error: msg },
      'Failed to broadcast ai-transcription:ready — best-effort, swallowing error',
    );
  }
}
