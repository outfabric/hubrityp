import { redirect } from 'next/navigation';

import { loginInputSchema } from '@/modules/auth/lib/login-input-schema';
import { safeRedirect } from '@/modules/auth/lib/safe-redirect';
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

const DEFAULT_TARGET = '/dashboard';

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
  try {
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    supabaseError = error;
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

  // Contract: `redirectTo` is forwarded by `app/(auth)/login/page.tsx` →
  // `LoginForm` → `<input type="hidden" name="redirectTo">` → this FormData.
  // We deliberately read from FormData (NOT from headers/query) so the value
  // is bound to the submitted form, not to the request context. Any custom
  // login form that replaces `LoginForm` MUST forward the same hidden input,
  // or post-auth redirects silently fall back to `DEFAULT_TARGET`.
  const rawTarget = formData.get('redirectTo');
  const target = safeRedirect(typeof rawTarget === 'string' ? rawTarget : null, DEFAULT_TARGET);

  redirect(target);
}
