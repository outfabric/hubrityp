import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { and, eq, isNotNull, ne, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { cache } from 'react';

import { db } from '@/shared/db/client';
import { locations, sessions } from '@/shared/db/schema/agenda/tables';
import {
  aiTranscriptionSettings,
  aiTranscriptions,
} from '@/shared/db/schema/ai-transcription/tables';
import { profiles } from '@/shared/db/schema/auth/tables';
import { evolutions } from '@/shared/db/schema/medical-records/tables';
import { onboardingChecklist } from '@/shared/db/schema/onboarding/tables';
import { patients } from '@/shared/db/schema/patients/tables';

import type { ChecklistState } from '../lib/checklist-items';

/**
 * The result of a successful recompute: the freshly derived per-item state
 * (keyed by {@link ChecklistState}) for the authenticated owner. The mandatory
 * percentage / celebration logic is derived from this by the caller via the
 * pure `mandatoryCompletePct` helper — recompute persists the booleans and
 * returns them; it does not compute UI state.
 */
export interface RecomputeChecklistOk {
  ok: true;
  state: ChecklistState;
}

export interface RecomputeChecklistUnauthorized {
  ok: false;
  code: 'UNAUTHORIZED';
}

export type RecomputeChecklistResult = RecomputeChecklistOk | RecomputeChecklistUnauthorized;

// One bounded existence probe: `SELECT 1 ... LIMIT 1`. We never count whole
// tables — the first matching owner-scoped row short-circuits, and the boolean
// `rows.length > 0` is all the checklist needs.
async function ownerHasRow(table: PgTable, predicate: SQL | undefined): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(table)
    .where(predicate)
    .limit(1);
  return rows.length > 0;
}

/**
 * Recomputes the authenticated psychologist's onboarding checklist from
 * authoritative sources and persists the result to their `onboarding_checklist`
 * row.
 *
 * The checklist booleans are a denormalized cache; to avoid drift (e.g. a
 * patient deleted after the flag flipped) we re-derive every item from the
 * source tables on each call instead of trusting the stored flag:
 *
 *   - cadastro_completo  → `profiles`: email verified AND CRP validated
 *   - perfil_e_local     → >= 1 row in `locations`
 *   - primeiro_paciente  → >= 1 patient with status 'active'
 *   - primeira_sessao    → >= 1 session with status != 'cancelled'
 *   - primeira_evolucao  → >= 1 evolution
 *   - primeiro_termo     → >= 1 patient with `consent_signed_at` set
 *   - transcricao_ia     → AI transcription enabled AND >= 1 transcription started
 *
 * Security:
 *   1. Authenticate via `supabase.auth.getUser()` (NEVER `getSession`, which
 *      does not revalidate the JWT with GoTrue and is unsafe for authz).
 *   2. The owner id comes from the validated session ONLY. Any client-supplied
 *      user id is irrelevant here — this function takes no payload — and the
 *      persisted row's `user_id` is the session uid, so an attacker cannot
 *      target another account's row.
 *   3. Every source query is scoped `user_id = session.uid` — defense in depth
 *      on top of RLS (`db` is the module singleton and bypasses RLS, so the
 *      explicit predicate is what keeps a tenant from reading another's data;
 *      RLS remains the backstop for any path that uses an RLS-scoped client).
 *
 * Wrapped in React `cache()` so multiple callers in the same request (the
 * dashboard render does several owner-scoped aggregates) dedupe to a single
 * recompute. The cache key is the resolved owner id, so two different users in
 * (hypothetically) the same render never share a result.
 *
 * @param supabase the request's RLS-scoped Supabase client (carries the
 *   caller's session cookies); used only to authenticate via `getUser()`.
 */
export const recomputeChecklistImpl = cache(
  async (supabase: SupabaseClient): Promise<RecomputeChecklistResult> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { ok: false, code: 'UNAUTHORIZED' };
    }

    const userId = user.id;

    // Derive every item owner-scoped and in parallel — independent reads, no
    // waterfall. `cadastro_completo` reads two `profiles` timestamp columns;
    // the rest are bounded existence probes.
    const [
      profileRows,
      hasLocation,
      hasActivePatient,
      hasNonCancelledSession,
      hasEvolution,
      hasConsentPatient,
      aiSettingsRows,
      hasTranscription,
    ] = await Promise.all([
      db
        .select({
          emailVerifiedAt: profiles.emailVerifiedAt,
          crpValidatedAt: profiles.crpValidatedAt,
        })
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1),
      ownerHasRow(locations, eq(locations.userId, userId)),
      ownerHasRow(patients, and(eq(patients.userId, userId), eq(patients.status, 'active'))),
      ownerHasRow(sessions, and(eq(sessions.userId, userId), ne(sessions.status, 'cancelled'))),
      ownerHasRow(evolutions, eq(evolutions.userId, userId)),
      ownerHasRow(patients, and(eq(patients.userId, userId), isNotNull(patients.consentSignedAt))),
      db
        .select({ enabled: aiTranscriptionSettings.enabled })
        .from(aiTranscriptionSettings)
        .where(eq(aiTranscriptionSettings.userId, userId))
        .limit(1),
      ownerHasRow(aiTranscriptions, eq(aiTranscriptions.userId, userId)),
    ]);

    const profileRow = profileRows[0];
    const cadastroCompleto =
      profileRow?.emailVerifiedAt != null && profileRow?.crpValidatedAt != null;

    // Bonus: AI must be enabled AND the owner must have started >= 1 transcription.
    const aiEnabled = aiSettingsRows[0]?.enabled === true;
    const transcricaoIa = aiEnabled && hasTranscription;

    const state: ChecklistState = {
      cadastro_completo: cadastroCompleto,
      perfil_e_local: hasLocation,
      primeiro_paciente: hasActivePatient,
      primeira_sessao: hasNonCancelledSession,
      primeira_evolucao: hasEvolution,
      primeiro_termo: hasConsentPatient,
      transcricao_ia: transcricaoIa,
    };

    // Persist the derived state to the owner's single checklist row. The row is
    // lazily created on first recompute; on conflict we overwrite every flag so
    // the stored cache exactly mirrors the recomputed truth (drift-free). The
    // `user_id` written is the session uid, so the row can only ever be the
    // caller's own — RLS would reject any other target anyway.
    const flags = {
      profileCompleted: cadastroCompleto,
      locationConfigured: hasLocation,
      firstPatientAdded: hasActivePatient,
      firstSessionScheduled: hasNonCancelledSession,
      firstEvolutionRecorded: hasEvolution,
      firstConsentSent: hasConsentPatient,
      aiTranscriptionTried: transcricaoIa,
    };

    await db
      .insert(onboardingChecklist)
      .values({ userId, ...flags })
      .onConflictDoUpdate({
        target: onboardingChecklist.userId,
        set: { ...flags, updatedAt: new Date() },
      });

    return { ok: true, state };
  },
);
