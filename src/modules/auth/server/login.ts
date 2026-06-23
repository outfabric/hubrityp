import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { loginInputSchema } from '@/modules/auth/lib/login-input-schema';
import { safeRedirect } from '@/modules/auth/lib/safe-redirect';
import type { SignInResult } from '@/modules/auth/lib/sign-in-result';
import { getCurrentProfile, ProfileStatus } from '@/modules/registration';
import { logAuthEvent } from '@/modules/registration/server/log-auth-event';
import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { setKeepLoggedInCookie } from '@/shared/lib/cookies/keep-logged-in';
import { setPendingEmailCookie } from '@/shared/lib/cookies/pending-email';
import { logger } from '@/shared/lib/logger';
import { sendAccountLockedEmail } from '@/shared/lib/mail/send-account-locked';
import { createServerClient } from '@/shared/supabase/server';

import { applyFailedLoginAttempt, isCurrentlyLockedOut, resetLoginCounters } from './lockout';

export type { SignInResult } from '@/modules/auth/lib/sign-in-result';

const DEFAULT_TARGET = '/dashboard';
const PENDING_TARGET = '/onboarding/pending';
// First-run wizard entrypoint. An active user who has not finished (or
// explicitly skipped) onboarding is funnelled here by the middleware. We mirror
// that target in the login action so the redirect lands directly on the wizard
// instead of bouncing /dashboard -> 307 -> /onboarding/welcome (see below).
const WELCOME_TARGET = '/onboarding/welcome';

/**
 * Anti-enumeration delay: add random 50–150ms delay to match the timing
 * of a real bcrypt compare, preventing attackers from distinguishing
 * existing vs non-existing emails by response time.
 */
async function dummyDelay(): Promise<void> {
  const { randomInt } = await import('node:crypto');
  await new Promise<void>((r) => setTimeout(r, 50 + randomInt(100)));
}

// `signInImpl` is the module-side implementation of the `signIn` Server
// Action. This file MUST NOT carry a top-level `'use server'` directive —
// that lives on the route shell (`app/(auth)/login/actions.ts`) which wraps
// this function. Marking the module as `'use server'` would force every
// export to be RPC-able and would couple the module's lifecycle to the
// Server Action runtime, defeating the shell-module split.
export async function signInImpl(formData: FormData): Promise<SignInResult> {
  const parsed = loginInputSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    keepLoggedIn: formData.get('keepLoggedIn') === 'true',
  });

  if (!parsed.success) {
    // Identical error to invalid credentials so a probing attacker cannot
    // distinguish "valid email but wrong password" from "malformed email".
    // The Zod schema already runs on the client, so legitimate users have
    // seen inline errors before reaching the server. Do NOT touch lockout
    // counters or Supabase.
    return { ok: false, error: 'invalid_credentials' };
  }

  const { email, password, keepLoggedIn } = parsed.data;

  // ---- Pre-check: lookup profile by email for lockout state ----
  // We need the profile BEFORE calling Supabase to check lockout state.
  // If the profile does not exist, we still proceed to the dummy delay
  // path later (anti-enumeration).
  let existingProfile: {
    userId: string;
    lockoutUntil: Date | null;
    requiresPasswordReset: boolean;
  } | null = null;

  try {
    const rows = await db
      .select({
        userId: profiles.userId,
        lockoutUntil: profiles.lockoutUntil,
        requiresPasswordReset: profiles.requiresPasswordReset,
      })
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);
    existingProfile = rows[0] ?? null;
  } catch {
    // DB lookup failure — fall through to Supabase attempt. If both
    // fail, the unknown error path covers it.
  }

  // ---- Lockout pre-check ----
  if (existingProfile) {
    const lockout = isCurrentlyLockedOut(existingProfile);
    if (lockout.lockedOut) {
      void logAuthEvent({
        userId: existingProfile.userId,
        event: 'login_failure',
        metadata: { reason: 'locked_out' },
      });
      return {
        ok: false,
        error: 'locked_out',
        lockoutUntil: lockout.until?.toISOString(),
      };
    }
  }

  const supabase = await createServerClient();

  // ONLY the Supabase-touching calls live inside the try block. `redirect()`
  // below throws a `NEXT_REDIRECT` marker that MUST propagate to Next.js;
  // catching it here would silently break navigation.
  let supabaseError: {
    name?: string;
    message?: string;
    code?: string;
    status?: number;
  } | null = null;
  let redirectTarget: string | null = null;

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    supabaseError = error;

    if (!supabaseError) {
      // ---- requires_password_reset check ----
      // After successful auth, if the profile requires a password reset,
      // sign the user back out and return the error.
      if (existingProfile?.requiresPasswordReset) {
        await supabase.auth.signOut();
        void logAuthEvent({
          userId: existingProfile.userId,
          event: 'login_failure',
          metadata: { reason: 'requires_password_reset' },
        });
        return { ok: false, error: 'requires_password_reset' };
      }

      const profile = await getCurrentProfile(supabase);

      // Defensive: the SECURITY DEFINER trigger on `auth.users` guarantees a
      // `profiles` row by the time `signInWithPassword` returns success, so
      // `null` here implies either a race with the trigger commit or a
      // session that no longer maps to a user row.
      if (!profile) {
        await supabase.auth.signOut();
        logger.warn(
          { event: 'signin_profile_missing' },
          'profiles row missing after successful signIn',
        );
        return { ok: false, error: 'unknown' };
      }

      switch (profile.status) {
        case ProfileStatus.Active: {
          // Set keepLoggedIn cookie
          const cookieStore = await cookies();
          setKeepLoggedInCookie(cookieStore, keepLoggedIn);

          // Reset lockout counters on successful login
          await resetLoginCounters(db, profile.userId);

          // Log successful login
          void logAuthEvent({
            userId: profile.userId,
            event: 'login_success',
            metadata: { keepLoggedIn },
          });

          // Active users split by onboarding completion, mirroring the
          // middleware predicate (`onboarding_step == 'done'` OR
          // `onboarding_completed_at IS NOT NULL`). When onboarding is
          // incomplete we redirect straight to the first-run wizard and IGNORE
          // any `redirectTo`: the middleware would 307 every app/auth target to
          // `/onboarding/welcome` anyway, and that POST-stream redirect chain is
          // what leaves the client RSC router stuck showing `/dashboard` in the
          // URL bar while rendering the wizard. Resolving the final target here
          // removes the bounce so the URL bar matches the rendered page.
          const onboardingComplete =
            profile.onboardingStep === 'done' || profile.onboardingCompletedAt !== null;

          if (!onboardingComplete) {
            redirectTarget = WELCOME_TARGET;
            break;
          }

          const rawTarget = formData.get('redirectTo');
          redirectTarget = safeRedirect(
            typeof rawTarget === 'string' ? rawTarget : null,
            DEFAULT_TARGET,
          );
          break;
        }
        case ProfileStatus.PendingVerification:
        case ProfileStatus.PendingCrpValidation: {
          // Set keepLoggedIn cookie even for pending users
          const cookieStore = await cookies();
          setKeepLoggedInCookie(cookieStore, keepLoggedIn);

          // Reset lockout counters on successful login
          await resetLoginCounters(db, profile.userId);

          void logAuthEvent({
            userId: profile.userId,
            event: 'login_success',
            metadata: { keepLoggedIn },
          });

          redirectTarget = PENDING_TARGET;
          break;
        }
        case ProfileStatus.Suspended:
        case ProfileStatus.Cancelled: {
          await supabase.auth.signOut();
          logger.warn(
            { event: 'signin_account_unavailable', status: profile.status },
            'sign-in blocked: account unavailable',
          );
          void logAuthEvent({
            userId: profile.userId,
            event: 'login_failure',
            metadata: { reason: 'account_unavailable', status: profile.status },
          });
          return { ok: false, error: 'account_unavailable' };
        }
      }
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn({ event: 'signin_unknown_error', errorName: name }, 'signin failure');
    return { ok: false, error: 'unknown' };
  }

  // ---- Handle Supabase auth failure ----
  if (supabaseError) {
    // ---- email_not_confirmed (no lockout) ----
    // GoTrue returns `email_not_confirmed` (HTTP 422) ONLY after the password
    // has been validated — so reaching this branch proves the credentials were
    // correct and the account is merely blocked on email confirmation. This is
    // a legitimate login attempt, NOT a failed-credentials event: we MUST NOT
    // call `applyFailedLoginAttempt` and MUST NOT touch any lockout counter,
    // otherwise a user stuck on confirmation could lock themselves out. Set the
    // signed pending-email cookie so the public `/verifique-email` page can
    // resend the confirmation, then return the typed error. Branch FIRST so it
    // never falls through to the failed-credentials/lockout path below.
    const unconfirmed =
      supabaseError.code === 'email_not_confirmed' || supabaseError.status === 422;
    if (unconfirmed) {
      const cookieStore = await cookies();
      setPendingEmailCookie(cookieStore, email);
      void logAuthEvent({
        userId: existingProfile?.userId ?? null,
        event: 'login_failure',
        metadata: { reason: 'email_not_confirmed' },
      });
      return { ok: false, error: 'email_not_confirmed' };
    }

    if (existingProfile) {
      // Profile exists — apply failed login attempt (lockout counter)
      try {
        const lockoutResult = await applyFailedLoginAttempt(db, existingProfile.userId);

        void logAuthEvent({
          userId: existingProfile.userId,
          event: 'login_failure',
          metadata: { reason: 'invalid_credentials' },
        });

        // 6.2: If lockout just started, send lockout email best-effort
        if (lockoutResult.lockoutJustStarted) {
          void logAuthEvent({
            userId: existingProfile.userId,
            event: 'lockout_started',
          });
          // Best-effort: fire-and-forget, failure does not derail the action
          void sendAccountLockedEmail(email).catch(() => {
            // Swallowed — mail delivery is best-effort
          });
        }

        // Log if consecutive lockout threshold reached
        if (lockoutResult.requiresPasswordReset && lockoutResult.lockoutJustStarted) {
          void logAuthEvent({
            userId: existingProfile.userId,
            event: 'lockout_consecutive_threshold_reached',
          });
        }

        // If the atomic UPDATE just triggered lockout, return locked_out
        if (lockoutResult.lockoutUntil && lockoutResult.lockoutUntil > new Date()) {
          return {
            ok: false,
            error: 'locked_out',
            lockoutUntil: lockoutResult.lockoutUntil.toISOString(),
          };
        }
      } catch {
        // If lockout tracking fails, still return invalid_credentials
      }

      return { ok: false, error: 'invalid_credentials' };
    } else {
      // No profile — dummy delay for anti-enumeration timing
      await dummyDelay();
      void logAuthEvent({
        userId: null,
        event: 'login_failure',
        metadata: { reason: 'no_account' },
      });
      return { ok: false, error: 'invalid_credentials' };
    }
  }

  // Unreachable in normal flow: `redirectTarget` is always set after a
  // non-pending/non-blocked profile branch above.
  redirect(redirectTarget ?? DEFAULT_TARGET);
}
