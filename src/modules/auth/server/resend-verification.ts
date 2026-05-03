import { and, count, gt, sql } from 'drizzle-orm';

import { getAccountStatus } from '@/modules/account-lifecycle';
import { db } from '@/shared/db/client';
import { authResendLog } from '@/shared/db/schema/auth/auth-resend-log';
import { logger } from '@/shared/lib/logger';
import { createAdminClient } from '@/shared/supabase/admin';
import { createServerClient } from '@/shared/supabase/server';

// Discriminated union returned to the page. Errors are typed string literals,
// never `Error` instances, so the result stays serializable across the
// Server Action boundary and consumers can narrow exhaustively.
export type ResendVerificationResult =
  | { ok: true }
  | { ok: false; error: 'unauthenticated' | 'forbidden' | 'rate_limited' | 'unknown' };

// Sliding-window rate limit: at most 3 resends per 5 minutes per user. Lives
// here as a constant rather than in a config layer because PRD-01 pins it as
// a contract and the unit/integration tests need to assert against the same
// number; centralising it here is the smallest surface that keeps everything
// in lock-step.
const RATE_LIMIT_COUNT = 3;
const RATE_LIMIT_WINDOW = sql`interval '5 minutes'`;

// `resendVerificationEmailImpl` is the module-side implementation of the
// `resendVerificationEmail` Server Action. This file MUST NOT carry a
// top-level `'use server'` directive — that lives on the route shell which
// wraps this function. See `src/modules/auth/server/login.ts` for the
// rationale.
//
// Steps:
//   1. Authenticate the caller from the session.
//   2. Refuse if the caller's status is not `pending_verification`.
//   3. Refuse if the user has issued more than 3 resends in the last 5 min.
//   4. Otherwise insert a log row and call Supabase Auth's resend endpoint.
export async function resendVerificationEmailImpl(): Promise<ResendVerificationResult> {
  // 1. Read the session from the per-request anon-key Supabase server client.
  let userId: string | null = null;
  let email: string | null = null;
  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return { ok: false, error: 'unauthenticated' };
    }
    userId = data.user.id;
    email = data.user.email ?? null;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn({ event: 'resend_verification_unknown_error', errorName: name }, 'getUser threw');
    return { ok: false, error: 'unknown' };
  }

  if (!userId || !email) {
    return { ok: false, error: 'unauthenticated' };
  }

  // 2. Status gate — only `pending_verification` may invoke resend. Every
  //    other status (`active`, `suspended`, `cancelled`, missing) is `forbidden`.
  let status;
  try {
    const result = await getAccountStatus(userId);
    status = result.status;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'resend_verification_unknown_error', errorName: name },
      'getAccountStatus threw',
    );
    return { ok: false, error: 'unknown' };
  }

  if (status !== 'pending_verification') {
    return { ok: false, error: 'forbidden' };
  }

  // 3. Sliding-window rate limit check. We count rows whose `sent_at` falls
  //    inside the window; an INSERT happens only on the allow-path so the
  //    counter never advances when the limit blocks the request. The
  //    `(user_id, sent_at desc)` index keeps this scan cheap.
  try {
    const rateLimitRows = await db
      .select({ value: count() })
      .from(authResendLog)
      .where(
        and(
          sql`${authResendLog.userId} = ${userId}`,
          gt(authResendLog.sentAt, sql`now() - ${RATE_LIMIT_WINDOW}`),
        ),
      );

    const recentCount = rateLimitRows[0]?.value ?? 0;
    if (recentCount >= RATE_LIMIT_COUNT) {
      return { ok: false, error: 'rate_limited' };
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'resend_verification_unknown_error', errorName: name },
      'rate-limit query failed',
    );
    return { ok: false, error: 'unknown' };
  }

  // 4. Record the attempt FIRST, then call Supabase. If Supabase fails we
  //    return `unknown` but the log row stays — that errs on the side of
  //    enforcing the limit. In practice GoTrue's resend has its own
  //    server-side cool-down, so the conservative choice is fine.
  try {
    await db.insert(authResendLog).values({ userId });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'resend_verification_unknown_error', errorName: name },
      'failed to record resend attempt',
    );
    return { ok: false, error: 'unknown' };
  }

  try {
    // We use the admin client here because the resend call is logically
    // "as the user" but the user's own session may have lapsed; the admin
    // client always has the credential to issue the request and it is the
    // same code path the integration tests exercise.
    const admin = createAdminClient();
    const { error } = await admin.auth.resend({ type: 'signup', email });
    if (error) {
      logger.warn(
        { event: 'resend_verification_unknown_error', errorName: error.name ?? 'AuthError' },
        'supabase auth.resend returned an error',
      );
      return { ok: false, error: 'unknown' };
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'resend_verification_unknown_error', errorName: name },
      'supabase auth.resend threw',
    );
    return { ok: false, error: 'unknown' };
  }

  logger.info({ event: 'resend_verification_succeeded' }, 'verification email resent');
  return { ok: true };
}
