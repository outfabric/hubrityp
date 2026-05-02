'use server';

import { redirect } from 'next/navigation';

import { loginInputSchema } from '@/lib/auth/login-input-schema';
import { safeRedirect } from '@/lib/auth/safe-redirect';
import { logger } from '@/lib/logger';
import { createServerClient } from '@/lib/supabase/server';

// Discriminated union returned to the page. Errors are typed string literals,
// never `Error` instances, so the result stays serializable across the
// Server Action boundary and consumers can narrow exhaustively.
//
// Only `invalid_credentials` and `unknown` are surfaced today. Additional
// variants (e.g. `rate_limited`) MUST be added here before the action starts
// returning them, so the consumer's exhaustive switch keeps compiling.
export type SignInResult = { ok: true } | { ok: false; error: 'invalid_credentials' | 'unknown' };

const DEFAULT_TARGET = '/dashboard';

export async function signIn(formData: FormData): Promise<SignInResult> {
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
    // payload — see `lib/logger.ts` `redactPaths`.
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

  const rawTarget = formData.get('redirectTo');
  const target = safeRedirect(typeof rawTarget === 'string' ? rawTarget : null, DEFAULT_TARGET);

  redirect(target);
}
