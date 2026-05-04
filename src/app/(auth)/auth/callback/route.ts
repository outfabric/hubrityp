import { NextResponse } from 'next/server';

import { logAuthEvent } from '@/modules/registration/server/log-auth-event';
import { logger } from '@/shared/lib/logger';
import { createServerClient } from '@/shared/supabase/server';

// Route Handler for `/auth/callback`. Supabase Auth redirects users here
// after they click the verification link in their signup email. Flow:
//
//   1. Read `code` from the query string. Missing / empty → redirect to the
//      error page with `?reason=missing`.
//   2. Call `supabase.auth.exchangeCodeForSession(code)`. The SSR helper
//      writes the new session cookies into the response automatically.
//   3. The DB trigger has already (atomically with the auth.users update)
//      transitioned `profile.status` from `pending_verification` to
//      `pending_crp_validation`. We do not re-read the profile here — the
//      pending page does the authoritative read on render.
//   4. Best-effort `logAuthEvent('email_verified')`, then 307-redirect to
//      `/onboarding/pending`.
//   5. On any exchange error (expired/tampered code), redirect to the
//      error page with a typed `?reason=...` so the UI can render a clear
//      pt-BR message and offer a resend.
//
// Why a Route Handler and not a Server Component: cookie writes happen in
// the response, and `exchangeCodeForSession` performs cookie writes — Server
// Components cannot mutate cookies. A Route Handler is the canonical
// boundary for code-exchange flows in `@supabase/ssr`.
//
// Note on redirect status code: the spec mandates HTTP 307 for the success
// path so a future POST/Action redirect contract stays consistent. The
// helpers default to 307; we pass it explicitly to make the contract
// readable in the source.

const ERROR_PATH = '/auth/callback/error';
const SUCCESS_PATH = '/onboarding/pending';

type FailureReason = 'missing' | 'invalid' | 'unknown';

function redirectToError(requestUrl: string, reason: FailureReason): Response {
  const url = new URL(ERROR_PATH, requestUrl);
  url.searchParams.set('reason', reason);
  return NextResponse.redirect(url, 307);
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code || code.length === 0) {
    logger.warn(
      { event: 'auth_callback_missing_code', route: '/auth/callback' },
      'auth callback hit without a code parameter',
    );
    return redirectToError(request.url, 'missing');
  }

  const supabase = await createServerClient();

  let exchangeError: { name?: string; message?: string; code?: string } | null = null;
  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeError = error;
    userId = data?.user?.id ?? null;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'auth_callback_exchange_threw', errorName: name, route: '/auth/callback' },
      'exchangeCodeForSession threw',
    );
    return redirectToError(request.url, 'unknown');
  }

  if (exchangeError) {
    logger.warn(
      {
        event: 'auth_callback_exchange_failed',
        errorName: exchangeError.name ?? 'AuthError',
        errorCode: exchangeError.code,
        route: '/auth/callback',
      },
      'exchangeCodeForSession returned an error',
    );
    return redirectToError(request.url, 'invalid');
  }

  // Best-effort audit log. `logAuthEvent` swallows its own errors, so this
  // call cannot break the user-facing flow.
  await logAuthEvent({
    userId,
    event: 'email_verified',
  });

  const url = new URL(SUCCESS_PATH, request.url);
  return NextResponse.redirect(url, 307);
}
