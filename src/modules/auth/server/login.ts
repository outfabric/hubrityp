import { redirect } from 'next/navigation';

import { loginInputSchema } from '@/modules/auth/lib/login-input-schema';
import { safeRedirect } from '@/modules/auth/lib/safe-redirect';
import { getCurrentProfile, ProfileStatus } from '@/modules/registration';
import { logger } from '@/shared/lib/logger';
import { createServerClient } from '@/shared/supabase/server';

// Discriminated union returned to the page. Errors are typed string literals,
// never `Error` instances, so the result stays serializable across the
// Server Action boundary and consumers can narrow exhaustively.
//
// `account_unavailable` is surfaced when authentication succeeds but the
// user's `profiles.status` is `suspended` or `cancelled` — the action signs
// the user back out and returns this error so the form can render a
// support-contact message instead of redirecting into the app shell.
//
// Additional variants (e.g. `rate_limited`) MUST be added here before the
// action starts returning them, so the consumer's exhaustive switch keeps
// compiling.
export type SignInResult =
  | { ok: true }
  | { ok: false; error: 'invalid_credentials' | 'account_unavailable' | 'unknown' };

const DEFAULT_TARGET = '/dashboard';
const PENDING_TARGET = '/onboarding/pending';

// `signInImpl` is the module-side implementation of the `signIn` Server
// Action. This file MUST NOT carry a top-level `'use server'` directive —
// that lives on the route shell (`app/(auth)/login/actions.ts`) which wraps
// this function. Marking the module as `'use server'` would force every
// export to be RPC-able and would couple the module's lifecycle to the
// Server Action runtime, defeating the shell↔module split.
export async function signInImpl(formData: FormData): Promise<SignInResult> {
  const parsed = loginInputSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    keepLoggedIn: formData.get('keepLoggedIn') === 'true',
  });

  if (!parsed.success) {
    // Identical error to invalid credentials so a probing attacker cannot
    // distinguish "valid email but wrong password" from "malformed email" by
    // reading the response body. The Zod schema already runs on the client,
    // so legitimate users have seen inline errors before reaching the server.
    return { ok: false, error: 'invalid_credentials' };
  }

  const supabase = await createServerClient();

  // Status-aware sign-in:
  //   1. `signInWithPassword` writes the session cookies (single network call).
  //   2. `getCurrentProfile` loads the typed `profiles` row via the same
  //      cookie context (PK lookup, no extra round trip beyond the user fetch).
  //   3. Branch on `profile.status` to decide redirect target / signOut /
  //      typed error result.
  //
  // ONLY the Supabase-touching calls live inside the try block. `redirect()`
  // below throws a `NEXT_REDIRECT` marker that MUST propagate to Next.js;
  // catching it here would silently break navigation. We therefore compute
  // the redirect TARGET inside the try block and call `redirect()` outside.
  let supabaseError: { name?: string; message?: string } | null = null;
  let redirectTarget: string | null = null;
  try {
    const { email, password } = parsed.data;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    supabaseError = error;

    if (!supabaseError) {
      const profile = await getCurrentProfile(supabase);

      // Defensive: the SECURITY DEFINER trigger on `auth.users` guarantees a
      // `profiles` row by the time `signInWithPassword` returns success, so
      // `null` here implies either a race with the trigger commit or a
      // session that no longer maps to a user row. In either case the safe
      // path is to clear the session and surface `unknown` — letting the
      // user retry rather than land on a half-bound shell.
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
          // Contract: `redirectTo` is forwarded by `app/(auth)/login/page.tsx`
          // → `LoginForm` → `<input type="hidden" name="redirectTo">` → this
          // FormData. We deliberately read from FormData (NOT from
          // headers/query) so the value is bound to the submitted form, not
          // to the request context. Any custom login form that replaces
          // `LoginForm` MUST forward the same hidden input, or post-auth
          // redirects silently fall back to `DEFAULT_TARGET`.
          const rawTarget = formData.get('redirectTo');
          redirectTarget = safeRedirect(
            typeof rawTarget === 'string' ? rawTarget : null,
            DEFAULT_TARGET,
          );
          break;
        }
        case ProfileStatus.PendingVerification:
        case ProfileStatus.PendingCrpValidation: {
          // Pending users MUST land on the onboarding hold page regardless
          // of any `redirectTo` they (or a deep link) supplied — sending
          // them deeper into the app would bypass the onboarding gate and
          // surface a half-functional shell.
          redirectTarget = PENDING_TARGET;
          break;
        }
        case ProfileStatus.Suspended:
        case ProfileStatus.Cancelled: {
          // Authentication succeeded but the account is no longer usable.
          // Clear the session cookie that `signInWithPassword` just wrote,
          // log the event for support triage, and surface the typed error
          // so the form renders a support-contact message. NO redirect:
          // returning a result keeps the user on `/login` with the alert.
          await supabase.auth.signOut();
          logger.warn(
            { event: 'signin_account_unavailable', status: profile.status },
            'sign-in blocked: account unavailable',
          );
          return { ok: false, error: 'account_unavailable' };
        }
      }
    }
  } catch (err) {
    // Network failure, Supabase 5xx, profile lookup error, or any other
    // unexpected throw. Logger redaction strips email/password if they ever
    // leak into the error payload — see `src/shared/lib/logger.ts`
    // `redactPaths`. NOTE: `redirect()` is NOT called inside this try block,
    // so `NEXT_REDIRECT` markers cannot be swallowed here.
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn({ event: 'signin_unknown_error', errorName: name }, 'signin failure');
    return { ok: false, error: 'unknown' };
  }

  if (supabaseError) {
    logger.warn(
      { event: 'signin_failed', errorName: supabaseError.name ?? 'AuthError' },
      'invalid credentials',
    );
    return { ok: false, error: 'invalid_credentials' };
  }

  // Unreachable in normal flow: `redirectTarget` is always set after a
  // non-pending/non-blocked profile branch above. Fall back defensively to
  // the default target so a future status enum addition that forgets to set
  // a target here doesn't dead-end the user.
  redirect(redirectTarget ?? DEFAULT_TARGET);
}
