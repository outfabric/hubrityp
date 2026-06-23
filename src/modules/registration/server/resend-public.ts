import 'server-only';

import { cookies } from 'next/headers';

import { readPendingEmail } from '@/shared/lib/cookies/pending-email';
import { logger } from '@/shared/lib/logger';
import { createServerClient } from '@/shared/supabase/server';

// The public resend action ALWAYS resolves to this single, success-shaped
// result — regardless of the Supabase outcome (200 success, 422 user-not-found,
// 429 rate-limited) and regardless of whether a valid pending-email cookie was
// present at all. This is the enumeration-safety contract: a caller can never
// distinguish "we sent an email" from "no account / no cookie / rate limited",
// so the action cannot be used to probe which addresses are registered nor to
// trigger email-bombing toward arbitrary addresses.
export type ResendPublicResult = { ok: true };

const GENERIC_OK: ResendPublicResult = { ok: true } as const;

/**
 * Public, sessionless resend of the signup confirmation email.
 *
 * Reachable from `/verifique-email` WITHOUT an authenticated session. The
 * target email is taken EXCLUSIVELY from the verified `hp_pending_email`
 * cookie (HMAC-signed, see `@/shared/lib/cookies/pending-email`), NEVER from
 * client-supplied input — so a caller cannot trigger a confirmation email to
 * an address they do not control.
 *
 * Contract (per `public-email-confirmation` spec):
 *   - Read the email via `readPendingEmail`. A missing, malformed, tampered, or
 *     wrong-secret-signed cookie yields `null`, in which case we return the
 *     generic result WITHOUT calling Supabase — no enumeration signal, no
 *     wasted email-send quota.
 *   - With a valid email, call `supabase.auth.resend({ type: 'signup', email })`
 *     using the anon server client. We rely entirely on Supabase's native
 *     limits (per-user 60s window + project per-hour email-send limit) — NO
 *     custom throttle and NO `profiles` lookup here (the public surface must
 *     not query account state).
 *   - Return the SAME generic `{ ok: true }` for every Supabase outcome
 *     (200 / 422 / 429) and NEVER throw across the Server Action boundary.
 */
export async function resendPublicConfirmationImpl(): Promise<ResendPublicResult> {
  const cookieStore = await cookies();
  const email = readPendingEmail(cookieStore);

  // No valid pending-email cookie: do nothing observable. We deliberately skip
  // Supabase entirely so the action neither leaks enumeration signal nor burns
  // the project email-send quota when probed without a legitimate cookie.
  if (!email) {
    return GENERIC_OK;
  }

  try {
    // Anon server client. We do NOT inspect the result: success (200),
    // user-not-found (422), and rate-limited (429) all collapse to the same
    // generic acknowledgement. Errors are logged WITHOUT the email (PII) so an
    // operator can spot pipeline issues without an enumeration vector in logs.
    const supabase = await createServerClient();
    const { error } = await supabase.auth.resend({ type: 'signup', email });

    if (error) {
      logger.warn(
        {
          event: 'resend_public_confirmation_supabase_error',
          errorName: error.name ?? 'AuthError',
        },
        'supabase.auth.resend returned an error on the public resend path',
      );
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'resend_public_confirmation_threw', errorName: name },
      'supabase.auth.resend threw on the public resend path',
    );
  }

  // Always the same generic, success-shaped result.
  return GENERIC_OK;
}
