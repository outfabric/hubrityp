import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { z } from 'zod';

import { db } from '@/shared/db/client';
import { logger } from '@/shared/lib/logger';

import { inngest } from '../inngest/client';
import { detractorSubmittedEventSchema, NPS_EVENTS } from '../inngest/events';
import { isDetractor, npsAnswerSchema } from '../lib/schemas';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type SubmitNpsResult =
  | { ok: true }
  | { ok: false; code: 'UNAUTHORIZED' | 'INVALID_INPUT' | 'ALREADY_RESPONDED' };

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * Two shapes reach this action:
 *   - an *answer* (`{ score, feedback? }`) validated by {@link npsAnswerSchema}
 *   - a *dismissal* (`{ dismiss: true }`) which stamps `nps_responded_at`
 *     without a score so the modal does not reappear.
 *
 * `unknown` is accepted at the boundary; the shape is narrowed by Zod inside the
 * impl, so no untrusted client value reaches the domain layer un-validated.
 */
export type SubmitNpsInput = unknown;

const dismissSchema = z.object({ dismiss: z.literal(true) });

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Persists an NPS response (or dismissal) for the authenticated psychologist.
 *
 * Security (defense in depth):
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`) — the
 *      identity is revalidated against GoTrue before any write.
 *   2. Validate the input with Zod at the boundary — no raw client value reaches
 *      the write.
 *   3. Authorize from the session: the write is scoped
 *      `WHERE user_id = session.uid AND nps_responded_at IS NULL`. No
 *      caller-supplied id is ever accepted, so a cross-user write is impossible
 *      (the `db` client bypasses RLS; RLS remains the backstop for the
 *      RLS-scoped client path). The `IS NULL` guard makes a second submission a
 *      no-op so the survey records exactly one response.
 *
 * Paths:
 *   - Answer (`{ score, feedback? }`): writes `nps_score`, `nps_feedback`, and
 *     `nps_responded_at = now()`. If the score is a detractor (0–6), a
 *     fire-and-forget `nps/detractor.submitted` Inngest event is enqueued for
 *     the follow-up email.
 *   - Dismissal (`{ dismiss: true }`): writes only `nps_responded_at = now()`
 *     (score and feedback stay NULL) so the modal does not reappear.
 *
 * LGPD: `nps_feedback` may contain incidental PII and the user's email/name are
 * sensitive — none of them is ever logged. Log lines carry only the internal
 * user UUID and the (non-PII) score.
 */
export async function submitNpsImpl(
  supabase: SupabaseClient,
  input: SubmitNpsInput,
): Promise<SubmitNpsResult> {
  const log = logger.child({ module: 'nps' });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  // Dismissal path: stamp `nps_responded_at` without a score.
  const dismissal = dismissSchema.safeParse(input);
  if (dismissal.success) {
    const stamped = await stampResponded(userId, { withScore: false });
    if (!stamped) {
      return { ok: false, code: 'ALREADY_RESPONDED' };
    }
    log.info({ event: 'nps_dismissed', userId });
    return { ok: true };
  }

  // Answer path.
  const parsed = npsAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT' };
  }

  const { score, feedback } = parsed.data;

  const stamped = await stampResponded(userId, {
    withScore: true,
    score,
    feedback: feedback ?? null,
  });
  if (!stamped) {
    return { ok: false, code: 'ALREADY_RESPONDED' };
  }

  log.info({ event: 'nps_submitted', userId, score });

  if (isDetractor(score)) {
    await enqueueDetractorEmail(userId, score, log);
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StampOptions =
  | { withScore: false }
  | { withScore: true; score: number; feedback: string | null };

/**
 * Writes the NPS response columns on the caller's own row only, guarded by
 * `nps_responded_at IS NULL`. Returns true when this call performed the write
 * (the row matched), false when a prior response already exists.
 */
async function stampResponded(userId: string, options: StampOptions): Promise<boolean> {
  const { profiles } = await import('@/shared/db/schema/auth/tables');

  const values = options.withScore
    ? {
        npsScore: options.score,
        npsFeedback: options.feedback,
        npsRespondedAt: sql`now()`,
      }
    : {
        npsRespondedAt: sql`now()`,
      };

  const updated = await db
    .update(profiles)
    .set(values)
    .where(and(eq(profiles.userId, userId), isNull(profiles.npsRespondedAt)))
    .returning({ userId: profiles.userId });

  return updated.length > 0;
}

/**
 * Enqueues the detractor follow-up email event. Fire-and-forget: a transport
 * failure is logged (no PII) but never fails the user's submission.
 */
async function enqueueDetractorEmail(userId: string, score: number, log: Logger): Promise<void> {
  try {
    const payload = detractorSubmittedEventSchema.parse({ userId, score });
    await inngest.send({ name: NPS_EVENTS.DETRACTOR_SUBMITTED, data: payload });
  } catch (inngestErr: unknown) {
    const errMsg = inngestErr instanceof Error ? inngestErr.message : 'unknown';
    log.error(
      {
        event: 'inngest_send_failed',
        eventName: NPS_EVENTS.DETRACTOR_SUBMITTED,
        userId,
        error: errMsg,
      },
      'failed to send nps/detractor.submitted event',
    );
  }
}
