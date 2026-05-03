import { redirect } from 'next/navigation';

import { getAccountStatus } from '@/modules/account-lifecycle';
import { loginInputSchema } from '@/modules/auth/lib/login-input-schema';
import { postLoginRedirect } from '@/modules/auth/lib/post-login-redirect';
import { logger } from '@/shared/lib/logger';
import { createServerClient } from '@/shared/supabase/server';

// Discriminated union returned to the page. Errors are typed string literals,
// never `Error` instances, so the result stays serializable across the
// Server Action boundary and consumers can narrow exhaustively.
//
// Only `invalid_credentials` and `unknown` are surfaced today. Additional
// variants (e.g. `rate_limited`) MUST be added here before the action starts
// returning them, so the consumer's exhaustive switch keeps compiling.
export type SignInResult = { ok: true } | { ok: false; error: 'invalid_credentials' | 'unknown' };

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
  });

  if (!parsed.success) {
    // Identical error to invalid credentials so a probing attacker cannot
    // distinguish "valid email but wrong password" from "malformed email" by
    // reading the response body. The Zod schema already runs on the client,
    // so legitimate users have seen inline errors before reaching the server.
    return { ok: false, error: 'invalid_credentials' };
  }

  const supabase = await createServerClient();

  // ONLY the Supabase call is wrapped in try/catch. `redirect()` below throws
  // a `NEXT_REDIRECT` marker that MUST propagate to Next.js; catching it here
  // would silently break navigation. Keep `redirect` outside the try block.
  let supabaseError: { name?: string; message?: string } | null = null;
  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    supabaseError = error;
    userId = data?.user?.id ?? null;
  } catch (err) {
    // Network failure, Supabase 5xx, or any other unexpected throw. Logger
    // redaction strips email/password if they ever leak into the error
    // payload — see `src/shared/lib/logger.ts` `redactPaths`.
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

  if (!userId) {
    // Supabase reported success without a user id. We cannot determine the
    // user's status without it, so we treat this as `unknown`. The cookie
    // (if any) clears on the next middleware pass.
    logger.warn(
      { event: 'signin_unknown_error', reason: 'missing_user_id' },
      'signInWithPassword returned no user id',
    );
    return { ok: false, error: 'unknown' };
  }

  // Status-aware redirect: load the profile, decide where the user should
  // land, and (for `suspended`/`cancelled`) sign them out before bouncing
  // back to /login. A missing profile is unexpected post-signup — we treat
  // it as `unknown` so a stuck mid-signup row never lets the user past the
  // gate. The middleware enforces the same status map on every navigation.
  let status;
  try {
    const result = await getAccountStatus(userId);
    status = result.status;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'signin_unknown_error', errorName: name },
      'getAccountStatus threw after signin',
    );
    return { ok: false, error: 'unknown' };
  }

  if (status === null) {
    // No profile row — either signup did not finish or the row was
    // hard-deleted by the LGPD job. Sign the orphaned session out so the
    // user does not loop on a dashboard their middleware will reject anyway.
    try {
      await supabase.auth.signOut();
    } catch {
      // Best effort — if signOut fails the cookie clears on the next
      // middleware pass.
    }
    logger.warn(
      { event: 'signin_unknown_error', reason: 'profile_not_found' },
      'signin succeeded but no psychologist_profiles row',
    );
    return { ok: false, error: 'unknown' };
  }

  // For terminal statuses we sign the user out at login: the cookie is
  // cleared and the page renders the reason banner from the query param.
  // The redirect itself happens below; we do NOT redirect from inside the
  // try/catch so the NEXT_REDIRECT marker propagates cleanly.
  if (status === 'suspended' || status === 'cancelled') {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      logger.warn(
        { event: 'signin_unknown_error', errorName: name },
        'signOut after terminal-status login failed',
      );
      // Even on failure we proceed with the redirect — the middleware will
      // re-evaluate the cookie on the next request anyway.
    }
  }

  // Contract: `redirectTo` is forwarded by `app/(auth)/login/page.tsx` →
  // `LoginForm` → `<input type="hidden" name="redirectTo">` → this FormData.
  // We deliberately read from FormData (NOT from headers/query) so the value
  // is bound to the submitted form, not to the request context. Any custom
  // login form that replaces `LoginForm` MUST forward the same hidden input,
  // or post-auth redirects silently fall back to the status default.
  const rawTarget = formData.get('redirectTo');
  const requested = typeof rawTarget === 'string' ? rawTarget : null;
  const target = postLoginRedirect(status, requested);

  redirect(target);
}
