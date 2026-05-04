import 'server-only';

import { ProfileStatus } from '@/modules/registration/lib/profile-status';
import { logger } from '@/shared/lib/logger';
import { createServerClient } from '@/shared/supabase/server';

import { getCurrentProfile } from './get-profile';

// Discriminated union returned to the page. Errors are typed string literals
// so the result stays serializable across the Server Action boundary and
// consumers can narrow exhaustively.
export type ResendVerificationResult =
  | { ok: true }
  | { ok: false; error: 'invalid_status' | 'rate_limited' | 'unknown' };

/**
 * Resend the email-verification message for the active session's user.
 *
 * Contract (per `account-registration/spec.md`):
 *   - Authenticated `pending_verification` user MUST be the only caller —
 *     anonymous and any other status return `invalid_status`.
 *   - Supabase rate-limit responses (HTTP 429 / `over_email_send_rate_limit`
 *     / message containing "rate") map to `rate_limited`. The UI explains
 *     the cool-down to the user.
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
