import 'server-only';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';

import { forgotPasswordInputSchema } from '@/modules/password-recovery/lib/forgot-password-input-schema';
import { logAuthEvent } from '@/modules/registration/server/log-auth-event';
import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { logger } from '@/shared/lib/logger';
import { createServerClient } from '@/shared/supabase/server';

// ---------------------------------------------------------------------------
// 7.1 — requestPasswordResetImpl
//
// Server Action implementation for the "forgot password" step. The action
// validates the email, looks up the profile, and calls Supabase's
// `resetPasswordForEmail` only when the profile exists. For non-existing
// emails, a constant-time dummy delay is applied so an attacker cannot
// distinguish existing vs non-existing accounts by timing.
//
// Anti-enumeration contract: the return shape is ALWAYS `{ ok: true }` for
// valid input, regardless of whether the profile exists, Supabase rate-limits
// the call, or the email send fails. Only malformed input yields a typed
// `{ ok: false, error: 'invalid_input' }`.
//
// This file MUST NOT carry `'use server'` — the route shell
// (`app/(auth)/forgot-password/actions.ts`) is the single Server Action
// entry point.
// ---------------------------------------------------------------------------

export type RequestPasswordResetResult = { ok: true } | { ok: false; error: 'invalid_input' };

const FALLBACK_ORIGIN = 'http://localhost:3000';

/**
 * Resolve the user-facing origin from the request headers. Mirrors the
 * pattern used by `signUpImpl` for email-verification redirect URLs.
 */
async function resolveOrigin(): Promise<string> {
  try {
    const h = await headers();
    const origin = h.get('origin');
    if (origin && origin.length > 0) return origin;
  } catch {
    // Outside a request context — fall through to the localhost fallback.
  }
  return FALLBACK_ORIGIN;
}

/**
 * Anti-enumeration delay: add random 50-150ms delay to match the timing
 * of a real Supabase resetPasswordForEmail call, preventing attackers from
 * distinguishing existing vs non-existing emails by response time.
 */
async function dummyDelay(): Promise<void> {
  const { randomInt } = await import('node:crypto');
  await new Promise<void>((r) => setTimeout(r, 50 + randomInt(100)));
}

/**
 * Hash an email for audit log metadata. Never log the raw email — only
 * the hash is stored so ops can correlate attempts without exposing PII.
 */
async function hashEmail(email: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex').slice(0, 16);
}

export async function requestPasswordResetImpl(
  formData: FormData,
): Promise<RequestPasswordResetResult> {
  const parsed = forgotPasswordInputSchema.safeParse({
    email: formData.get('email'),
  });

  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  const { email } = parsed.data;

  try {
    // Lookup profile to decide whether to call Supabase or dummy-delay.
    const rows = await db
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);

    const profile = rows[0] ?? null;

    if (profile) {
      // Profile exists — call Supabase to send the password reset email.
      const origin = await resolveOrigin();
      const redirectTo = `${origin}/auth/callback?next=/reset-password`;

      const supabase = await createServerClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) {
        // Log the error but still return { ok: true } — hide rate limiting
        // and other Supabase errors from the user.
        logger.warn(
          { event: 'password_reset_supabase_error', errorName: error.name },
          'resetPasswordForEmail returned an error',
        );
      }

      void logAuthEvent({
        userId: profile.userId,
        event: 'password_reset_requested',
      });
    } else {
      // No profile — apply dummy delay for anti-enumeration timing.
      await dummyDelay();

      const emailHash = await hashEmail(email);
      void logAuthEvent({
        userId: null,
        event: 'password_reset_requested',
        metadata: { emailHash },
      });
    }
  } catch (err) {
    // Best-effort: a DB or Supabase failure must not reveal whether the
    // account exists. Log the error and return the uniform response.
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'password_reset_request_error', errorName: name },
      'requestPasswordReset failed internally',
    );
  }

  return { ok: true };
}
