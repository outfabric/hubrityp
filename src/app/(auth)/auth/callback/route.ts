import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { logAuthEvent } from '@/modules/registration/server/log-auth-event';
import { logger } from '@/shared/lib/logger';
import { createServerClient } from '@/shared/supabase/server';

// Route Handler for `/auth/callback`. Supabase Auth redirects users here
// after they click the verification link in their signup email.
//
// Two flow shapes are supported, in priority order:
//
//   A) PKCE code-exchange (`?code=<one-time-code>`) — the modern
//      `@supabase/ssr` flow used when GoTrue is configured to emit
//      `{{ .ConfirmationURL }}` directly. We call
//      `supabase.auth.exchangeCodeForSession(code)`.
//   B) Verify-by-token-hash (`?token_hash=<hash>&type=email|signup|...`) —
//      the explicit PKCE template recommended by the Supabase docs, where
//      the email link points to `/auth/callback?token_hash=...&type=email`.
//      We call `supabase.auth.verifyOtp({ type, token_hash })`.
//
// Both calls write the new session cookies into the response automatically
// via the @supabase/ssr cookie adapter. On success we 307-redirect to
// `/onboarding/pending`. On failure we redirect to the error page with a
// typed `?reason=...` so the UI can render a pt-BR message + resend CTA.
//
// Host preservation (HIGH #3 fix): all redirect URLs are built from
// `request.nextUrl` (the user-facing URL with the original `Host` header)
// rather than `request.url` — in dev, Next binds to `0.0.0.0`, and using
// `request.url` would emit redirects to `0.0.0.0:3000` instead of
// `localhost:3000`, which is a different cookie origin and breaks the
// session.

const ERROR_PATH = '/auth/callback/error';
const SUCCESS_PATH = '/onboarding/pending';

type FailureReason = 'missing' | 'invalid' | 'unknown';

// Allow-listed `type` values for verify-by-token-hash. Anything outside
// this set is treated as `missing` so we don't proxy an attacker's free
// string into Supabase's verify endpoint.
const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  'signup',
  'email',
  'invite',
  'recovery',
  'magiclink',
  'email_change',
]);

function redirectToError(request: NextRequest, reason: FailureReason): Response {
  const url = new URL(ERROR_PATH, request.nextUrl);
  url.searchParams.set('reason', reason);
  return NextResponse.redirect(url, 307);
}

function redirectToSuccess(request: NextRequest): Response {
  const url = new URL(SUCCESS_PATH, request.nextUrl);
  return NextResponse.redirect(url, 307);
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const rawType = searchParams.get('type');

  // Branch A: PKCE code-exchange takes priority when both are present (a
  // misconfigured template that emits both should still resolve via the
  // canonical flow).
  if (code && code.length > 0) {
    return handleCodeExchange(request, code);
  }

  // Branch B: verify-by-token-hash.
  if (tokenHash && tokenHash.length > 0) {
    if (!rawType || !ALLOWED_OTP_TYPES.has(rawType as EmailOtpType)) {
      logger.warn(
        { event: 'auth_callback_unsupported_type', type: rawType, route: '/auth/callback' },
        'auth callback received token_hash with an unsupported type',
      );
      return redirectToError(request, 'invalid');
    }
    return handleTokenHashVerify(request, tokenHash, rawType as EmailOtpType);
  }

  logger.warn(
    { event: 'auth_callback_missing_code', route: '/auth/callback' },
    'auth callback hit without a code or token_hash parameter',
  );
  return redirectToError(request, 'missing');
}

async function handleCodeExchange(request: NextRequest, code: string): Promise<Response> {
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
    return redirectToError(request, 'unknown');
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
    return redirectToError(request, 'invalid');
  }

  // Best-effort audit log. `logAuthEvent` swallows its own errors, so this
  // call cannot break the user-facing flow.
  await logAuthEvent({
    userId,
    event: 'email_verified',
  });

  return redirectToSuccess(request);
}

async function handleTokenHashVerify(
  request: NextRequest,
  tokenHash: string,
  type: EmailOtpType,
): Promise<Response> {
  const supabase = await createServerClient();

  let verifyError: { name?: string; message?: string; code?: string } | null = null;
  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    verifyError = error;
    userId = data?.user?.id ?? null;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'auth_callback_verify_threw', errorName: name, route: '/auth/callback' },
      'supabase.auth.verifyOtp threw',
    );
    return redirectToError(request, 'unknown');
  }

  if (verifyError) {
    logger.warn(
      {
        event: 'auth_callback_verify_failed',
        errorName: verifyError.name ?? 'AuthError',
        errorCode: verifyError.code,
        route: '/auth/callback',
      },
      'supabase.auth.verifyOtp returned an error',
    );
    return redirectToError(request, 'invalid');
  }

  await logAuthEvent({
    userId,
    event: 'email_verified',
  });

  return redirectToSuccess(request);
}
