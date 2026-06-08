import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { db } from '@/shared/db/client';
import { logger } from '@/shared/lib/logger';

import type { PendenciasResult, UnauthorizedResult } from '../lib/types';

// A `done` session is "overdue without evolution" once it has been done for
// more than this window with no evolution recorded against it.
const OVERDUE_EVOLUTION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Deep-link targets. These are static, server-owned paths (no client input),
// so they are safe href values: they point the psychologist at the relevant
// filtered list, never at a clinical record's content.
const OVERDUE_EVOLUTIONS_HREF = '/agenda?filtro=sem-evolucao';
const PATIENTS_MISSING_CONSENT_HREF = '/pacientes?filtro=sem-consentimento';
const AI_NOTES_AWAITING_REVIEW_HREF = '/dashboard/transcricoes?status=ready';

/**
 * Computes the three MVP pendência counts for the authenticated psychologist.
 *
 * MVP-allowlisted (not blocklisted): only the three types below are ever
 * queried, so a post-MVP pendência (Receita Saúde, cobranças, WhatsApp) cannot
 * accidentally leak into the result.
 *
 *   (a) overdue evolutions — `done` sessions older than 7 days with no
 *       evolution recorded (anti-join on `evolutions.session_id`);
 *   (b) patients with `consent_signed_at IS NULL`;
 *   (c) AI transcription notes in the `ready` state (awaiting human review).
 *
 * Security:
 *   1. Authenticate via `supabase.auth.getUser()` (NOT `getSession`).
 *   2. Every count is scoped `user_id = session.uid` — defense in depth on top
 *      of RLS (`db` bypasses RLS). No caller-supplied id is accepted.
 *
 * The result carries only counts + static deep-link targets — never a patient
 * name, a session id, or any clinical text.
 */
export async function getPendencias(
  supabase: SupabaseClient,
): Promise<PendenciasResult | UnauthorizedResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, code: 'UNAUTHORIZED' };
  }

  const userId = user.id;

  const { sessions } = await import('@/shared/db/schema/agenda/tables');
  const { patients } = await import('@/shared/db/schema/patients/tables');
  const { evolutions } = await import('@/shared/db/schema/medical-records/tables');
  const { aiTranscriptions } = await import('@/shared/db/schema/ai-transcription/tables');

  const overdueBefore = new Date(Date.now() - OVERDUE_EVOLUTION_DAYS * MS_PER_DAY);

  // (a) Overdue evolutions: anti-join `done` sessions against `evolutions`
  //     (1:1 via `session_id`). `start_at` older than the window, owner-scoped,
  //     excluding soft-deleted rows. The LEFT JOIN + IS NULL keeps it a single
  //     indexed pass over the owner's sessions.
  const overduePromise = db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessions)
    .leftJoin(evolutions, eq(evolutions.sessionId, sessions.id))
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.status, 'done'),
        isNull(sessions.deletedAt),
        lt(sessions.startAt, overdueBefore),
        isNull(evolutions.id),
      ),
    );

  // (b) Patients missing consent: `consent_signed_at IS NULL`, owner-scoped.
  //     Archived patients are excluded — a consent gap on an archived record is
  //     not an actionable pendência.
  const missingConsentPromise = db
    .select({ count: sql<number>`count(*)::int` })
    .from(patients)
    .where(
      and(
        eq(patients.userId, userId),
        isNull(patients.consentSignedAt),
        isNull(patients.archivedAt),
      ),
    );

  // (c) AI notes awaiting review: `ready` status = generated, not yet reviewed.
  const aiNotesPromise = db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiTranscriptions)
    .where(and(eq(aiTranscriptions.userId, userId), eq(aiTranscriptions.status, 'ready')));

  const [overdueRows, missingConsentRows, aiNotesRows] = await Promise.all([
    overduePromise,
    missingConsentPromise,
    aiNotesPromise,
  ]);

  const overdueEvolutionsCount = overdueRows[0]?.count ?? 0;
  const patientsMissingConsentCount = missingConsentRows[0]?.count ?? 0;
  const aiNotesAwaitingReviewCount = aiNotesRows[0]?.count ?? 0;

  logger.debug({
    module: 'dashboard',
    event: 'pendencias',
    userId,
    overdueEvolutionsCount,
    patientsMissingConsentCount,
    aiNotesAwaitingReviewCount,
  });

  return {
    ok: true,
    overdueEvolutionsCount,
    overdueEvolutionsHref: OVERDUE_EVOLUTIONS_HREF,
    patientsMissingConsentCount,
    patientsMissingConsentHref: PATIENTS_MISSING_CONSENT_HREF,
    aiNotesAwaitingReviewCount,
    aiNotesAwaitingReviewHref: AI_NOTES_AWAITING_REVIEW_HREF,
  };
}
