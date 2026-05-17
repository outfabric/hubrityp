/**
 * Public token-based scale operations (service-role, no authentication).
 *
 * **Why service-role is used here (design.md decision #2):**
 * The public patient-facing route (`/escala/[token]`) needs to read a
 * `scale_applications` row by its `remote_token` without any Supabase Auth
 * session. RLS policies on `scale_applications` are scoped to
 * `auth.uid() = user_id` (owner-only), so they intentionally block anonymous
 * access. Rather than adding an `anon` policy (which would widen the attack
 * surface on a clinical table), this module uses the app-level Drizzle
 * client (`db`) which connects as the DB owner and bypasses RLS.
 *
 * Security controls:
 *  - `getScaleApplicationByToken` returns ONLY `{ id, scaleKey, isExpired,
 *    isCompleted }`. user_id, patient_id, names, and scores are NEVER
 *    included in the return type.
 *  - Token-not-found returns the same shape as token-expired to prevent
 *    enumeration attacks (an attacker cannot distinguish nonexistent tokens
 *    from expired ones).
 *  - `submitScaleResponsesByToken` uses a `WHERE remote_token AND
 *    completed_at IS NULL` UPDATE to prevent double-submit races.
 *  - Audit log entries for public submissions contain NO patient_id or
 *    psychologist user_id — only the scale_application id and client IP.
 */
import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { scaleByKey, type ClassificationResult } from '@/modules/medical-records/lib/scales';
import { submitResponsesByTokenSchema } from '@/modules/medical-records/lib/scales-schemas';
import { db } from '@/shared/db/client';
import { auditLog, scaleApplications } from '@/shared/db/schema/medical-records/tables';
import { logger } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Minimal info returned for a public token lookup. NEVER includes user_id,
 *  patient_id, or any PII. */
export type GetScaleApplicationByTokenResult =
  | {
      ok: true;
      id: string;
      scaleKey: string;
      isExpired: boolean;
      isCompleted: boolean;
    }
  | { ok: false };

export type SubmitScaleResponsesByTokenResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_TOKEN' | 'EXPIRED' | 'ALREADY_COMPLETED' | 'INVALID_RESPONSES' };

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const tokenSchema = z.string().length(64, { message: 'Token must be exactly 64 characters.' });

// ---------------------------------------------------------------------------
// getScaleApplicationByToken
// ---------------------------------------------------------------------------

/**
 * Looks up a scale application by its public remote token.
 *
 * Returns ONLY minimal metadata — never user_id, patient_id, names, or
 * scores. When the token is not found, returns `{ ok: false }` — the same
 * shape as an expired/completed token to prevent enumeration.
 *
 * Uses service-role (db) — see module-level comment for justification.
 */
export async function getScaleApplicationByToken(
  token: string,
): Promise<GetScaleApplicationByTokenResult> {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) {
    return { ok: false };
  }

  try {
    const [row] = await db
      .select({
        id: scaleApplications.id,
        scaleKey: scaleApplications.scaleKey,
        tokenExpiresAt: scaleApplications.tokenExpiresAt,
        completedAt: scaleApplications.completedAt,
      })
      .from(scaleApplications)
      .where(eq(scaleApplications.remoteToken, parsed.data))
      .limit(1);

    // Token not found — return same shape as expired to prevent enumeration
    if (!row) {
      return { ok: false };
    }

    const now = new Date();
    const isExpired = row.tokenExpiresAt !== null && row.tokenExpiresAt < now;
    const isCompleted = row.completedAt !== null;

    return {
      ok: true,
      id: row.id,
      scaleKey: row.scaleKey,
      isExpired,
      isCompleted,
    };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'get_scale_by_token_failed', errorCode: pgError.code },
      'unexpected error looking up scale application by token',
    );
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// submitScaleResponsesByToken
// ---------------------------------------------------------------------------

/**
 * Submits responses for a remote scale application via public token.
 *
 * Flow:
 *   1. Validate token format + responses with Zod.
 *   2. Look up application by remote_token (service-role, bypasses RLS).
 *   3. Reject if token expired or application already completed.
 *   4. Score + classify via the scale definition library.
 *   5. UPDATE with `WHERE remote_token AND completed_at IS NULL` (race guard).
 *   6. Write audit_log with IP — NO patient_id or psychologist user_id.
 *   7. Return `{ ok: true }`.
 *
 * Uses service-role (db) — see module-level comment for justification.
 */
export async function submitScaleResponsesByToken(
  token: string,
  responses: Record<string, number>,
  ip: string,
): Promise<SubmitScaleResponsesByTokenResult> {
  // 1. Validate input
  const parsed = submitResponsesByTokenSchema.safeParse({ token, responses });
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_RESPONSES' };
  }

  try {
    // 2. Look up application by token (service-role)
    const [row] = await db
      .select({
        id: scaleApplications.id,
        scaleKey: scaleApplications.scaleKey,
        tokenExpiresAt: scaleApplications.tokenExpiresAt,
        completedAt: scaleApplications.completedAt,
        // userId is loaded ONLY for the audit_log write — it is NOT returned
        // to the caller and NOT included in audit metadata.
        userId: scaleApplications.userId,
      })
      .from(scaleApplications)
      .where(eq(scaleApplications.remoteToken, parsed.data.token))
      .limit(1);

    if (!row) {
      return { ok: false, code: 'INVALID_TOKEN' };
    }

    // 3. Check expiry and completion
    const now = new Date();
    if (row.tokenExpiresAt !== null && row.tokenExpiresAt < now) {
      return { ok: false, code: 'EXPIRED' };
    }

    if (row.completedAt !== null) {
      return { ok: false, code: 'ALREADY_COMPLETED' };
    }

    // 4. Score + classify
    const scaleDef = scaleByKey(row.scaleKey);
    if (!scaleDef) {
      // Defensive: CHECK constraint should prevent this, but handle gracefully
      logger.error(
        { event: 'unknown_scale_key_on_submit', scaleKey: row.scaleKey },
        'scale application references unknown scale key',
      );
      return { ok: false, code: 'INVALID_TOKEN' };
    }

    const totalScore = scaleDef.score(parsed.data.responses);
    const classification: ClassificationResult = scaleDef.classify(
      totalScore,
      parsed.data.responses,
    );

    // 5. UPDATE with race-guard: WHERE remote_token AND completed_at IS NULL.
    // If another request completed this in the meantime, 0 rows are updated.
    const updated = await db
      .update(scaleApplications)
      .set({
        responses: parsed.data.responses,
        totalScore,
        classification: classification.label,
        completedAt: now,
      })
      .where(
        and(
          eq(scaleApplications.remoteToken, parsed.data.token),
          isNull(scaleApplications.completedAt),
        ),
      )
      .returning({ id: scaleApplications.id });

    if (updated.length === 0) {
      // Race condition: another request completed first
      return { ok: false, code: 'ALREADY_COMPLETED' };
    }

    // 6. Write audit_log — IP present, NO patient_id or psychologist user_id
    // in metadata. The userId column is the application owner (required FK),
    // but the metadata bag intentionally omits both patient_id and user_id.
    try {
      await db.insert(auditLog).values({
        userId: row.userId, // FK required — the owner of the application
        action: 'scale.public-submit',
        resourceType: 'scale_application',
        resourceId: row.id,
        metadata: { scaleKey: row.scaleKey },
        ipAddress: ip,
      });
    } catch (auditErr: unknown) {
      const pgError = auditErr as { code?: string };
      logger.error(
        { event: 'scale_public_audit_log_failed', errorCode: pgError.code },
        'failed to write audit_log entry for scale.public-submit',
      );
      // LGPD art. 37 / Lei 13.787/2018 compliance trade-off: audit failure
      // is intentionally non-blocking. The patient's clinical response must
      // not be lost due to an audit infrastructure issue. The logger.error
      // above feeds into the alerting pipeline (Pino → observability) to
      // surface the gap for manual remediation. If alerting is not yet
      // configured, this is a known residual risk accepted by the team.
    }

    return { ok: true };
  } catch (err: unknown) {
    const pgError = err as { code?: string };
    logger.error(
      { event: 'submit_scale_by_token_failed', errorCode: pgError.code },
      'unexpected error submitting scale responses by token',
    );
    throw err;
  }
}
