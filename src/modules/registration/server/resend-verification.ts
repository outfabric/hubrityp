import 'server-only';

import { eq } from 'drizzle-orm';

import { ProfileStatus } from '@/modules/registration/lib/profile-status';
import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { logger } from '@/shared/lib/logger';
import { createServerClient } from '@/shared/supabase/server';

import { getCurrentProfile } from './get-profile';

// Discriminated union returned to the page. Errors are typed string literals
// so the result stays serializable across the Server Action boundary and
// consumers can narrow exhaustively.
export type ResendVerificationResult =
  | { ok: true }
  | { ok: false; error: 'invalid_status' | 'rate_limited' | 'unknown' };

// Per-user resend throttle. The client-side cooldown (60s) is UX scaffolding;
// this is the authoritative gate that survives a page refresh. Centralised as
// a module-level constant so a future rate-tuning change is a single edit and
// the integration test can import the same number.
export const RESEND_THROTTLE_MS = 60_000;

/**
 * Resend the email-verification message for the active session's user.
 *
 * Contract (per `account-registration/spec.md`):
 *   - Authenticated `pending_verification` user MUST be the only caller —
 *     anonymous and any other status return `invalid_status`.
 *   - A per-user 60s throttle is enforced server-side via
 *     `profiles.last_resend_at`. A second call within the window returns
 *     `rate_limited` WITHOUT touching Supabase — this is the fix for QA
 *     finding #4 (refresh bypassing the client cooldown).
 *   - Supabase rate-limit responses (HTTP 429 / `over_email_send_rate_limit`
 *     / message containing "rate") also map to `rate_limited`. The UI
 *     explains the cool-down to the user.
 *   - NEVER throws across the Server Action boundary.
 */
export async function resendVerificationEmailImpl(): Promise<ResendVerificationResult> {
  const supabase = await createServerClient();
  const profile = await getCurrentProfile(supabase);

  // Anonymous OR a profile in any non-pending status: refuse without
  // touching Supabase. Returning the same `invalid_status` for both shapes
  // is intentional — a probing attacker cannot distinguish "you are
  // logged out" from "you are already verified".
  if (!profile || profile.status !== ProfileStatus.PendingVerification) {
    return { ok: false, error: 'invalid_status' };
  }

  // Server-side throttle. If the user resent within the throttle window,
  // refuse before contacting Supabase — this is what stops a refresh-loop
  // from spamming the email pipeline. We compare against `now()` rather
  // than a server clock helper because Postgres-side strict equality is
  // not needed: the gate is bounded by RESEND_THROTTLE_MS, off by single
  // milliseconds is fine.
  if (profile.lastResendAt) {
    const elapsedMs = Date.now() - profile.lastResendAt.getTime();
    if (elapsedMs < RESEND_THROTTLE_MS) {
      return { ok: false, error: 'rate_limited' };
    }
  }

  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: profile.email,
    });

    if (error) {
      // Supabase exposes rate-limit either as the typed `code`
      // `over_email_send_rate_limit`, an HTTP 429 status, or a free-form
      // message containing "rate". We accept all three because the surface
      // varies by SDK version and gateway configuration.
      const code = (error as { code?: string }).code;
      const status = (error as { status?: number }).status;
      const message = error.message ?? '';
      const isRateLimited =
        code === 'over_email_send_rate_limit' || status === 429 || /rate/i.test(message);

      if (isRateLimited) {
        return { ok: false, error: 'rate_limited' };
      }

      logger.warn(
        { event: 'resend_verification_failed', errorName: error.name ?? 'AuthError' },
        'supabase.auth.resend returned an error',
      );
      return { ok: false, error: 'unknown' };
    }

    // Stamp the throttle column. We do this AFTER Supabase confirms the
    // resend so a Supabase failure doesn't lock the user out of retrying.
    // Failure of the UPDATE itself is non-fatal — the email already went
    // out, and at worst the user can resend again immediately. We log so
    // a future operator can spot drift.
    try {
      await db
        .update(profiles)
        .set({ lastResendAt: new Date() })
        .where(eq(profiles.userId, profile.userId));
    } catch (err) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      logger.warn(
        { event: 'resend_verification_throttle_write_failed', errorName: name },
        'failed to stamp profiles.last_resend_at after a successful resend',
      );
    }

    return { ok: true };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'resend_verification_unknown_error', errorName: name },
      'supabase.auth.resend threw',
    );
    return { ok: false, error: 'unknown' };
  }
}
