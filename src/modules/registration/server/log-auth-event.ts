import 'server-only';

import { headers } from 'next/headers';

import { db } from '@/shared/db/client';
import { authLogs } from '@/shared/db/schema/auth/tables';
import { logger } from '@/shared/lib/logger';

// `log-auth-event.ts` is the single internal writer for `auth_logs`. It is
// deliberately NOT re-exported by the registration module barrel (section 6)
// — every call site is inside `src/modules/registration/server/**`.
//
// Why Drizzle (the app-level pool) and not the Supabase service-role client?
// Drizzle connects as the `postgres` role, which is RLS-exempt; the user-side
// policies on `auth_logs` only allow SELECT for the row owner. The audit
// trail must be writable on signup failures (no session yet) and on success
// before the SECURITY DEFINER trigger has finished, so going through the
// app pool keeps everything in one place without spinning up a separate
// Supabase admin client per call.
//
// Best-effort by design: a logging failure must NEVER bubble up and break a
// user-facing flow. Errors are swallowed and re-emitted via the structured
// logger so ops still see them.

/**
 * Strict union of `auth_logs.event` values produced by THIS change. Adding a
 * new event MUST extend this union — the audit dashboard relies on the
 * closed set when filtering.
 */
export type AuthLogEvent =
  | 'signup_success'
  | 'signup_failure_duplicate_email'
  | 'signup_failure_duplicate_crp'
  | 'email_verified';

export type LogAuthEventInput = {
  /**
   * `null` for signup failures that never produced an `auth.users` row —
   * the audit row still goes in so we can detect probing/duplicate-email
   * brute-forcing.
   */
  userId?: string | null;
  event: AuthLogEvent;
  /**
   * Free-form per-event payload. Sensitive fields (email, raw CRP, etc.)
   * MUST be hashed before being placed here — see the `emailHash` field
   * referenced by the spec for `signup_failure_duplicate_email`.
   */
  metadata?: Record<string, unknown>;
};

/**
 * Capture the originating request's IP and User-Agent. Best-effort: when
 * there is no request context (e.g. called from a job runner) we skip the
 * capture and write the row with `null` IP/UA.
 *
 * `x-forwarded-for` carries a comma-separated chain `client, proxy1,
 * proxy2`; we keep only the first hop (the closest the platform will admit
 * to the original client). Vercel also sets `x-real-ip` as a fallback for
 * environments where `x-forwarded-for` is unavailable.
 */
async function readRequestSignals(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwardedFor = h.get('x-forwarded-for');
    const firstHop = forwardedFor?.split(',')[0]?.trim() ?? null;
    const ip = firstHop && firstHop.length > 0 ? firstHop : (h.get('x-real-ip') ?? null);
    const userAgent = h.get('user-agent') ?? null;
    return { ip, userAgent };
  } catch {
    // `headers()` throws when called outside a request context. The audit
    // row is still valuable — we just lose the IP/UA columns for it.
    return { ip: null, userAgent: null };
  }
}

/**
 * Insert a row into `auth_logs`. NEVER throws — a logging failure cannot
 * be allowed to break a user-facing flow.
 */
export async function logAuthEvent(input: LogAuthEventInput): Promise<void> {
  try {
    const { ip, userAgent } = await readRequestSignals();
    await db.insert(authLogs).values({
      userId: input.userId ?? null,
      event: input.event,
      ip,
      userAgent,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'auth_log_write_failed', errorName: name, target: input.event },
      'auth_logs writer threw',
    );
  }
}
