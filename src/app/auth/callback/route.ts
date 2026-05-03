import { NextResponse, type NextRequest } from 'next/server';

import { applyTransition } from '@/modules/account-lifecycle';
import { logger } from '@/shared/lib/logger';
import { createServerClient } from '@/shared/supabase/server';

// `/auth/callback` Route Handler.
//
// Why a Route Handler (GET) instead of a Server Action: the entry point is a
// browser navigation triggered by the user clicking a verification link in
// their email. Server Actions are POST-only and cannot be reached from a
// plain `<a href>` — only Route Handlers respond to GET. The handler:
//
//   1. Reads the `code` query parameter (Supabase email-confirmation flow).
//   2. Exchanges the code for a session via `supabase.auth.exchangeCodeForSession`.
//   3. Calls `applyTransition(userId, 'email_verified')` to advance the
//      profile from `pending_verification` to `pending_crp_validation`.
//      Treats `invalid_transition` as idempotent success (already-verified
//      user clicking the link again).
//   4. Redirects to `/dashboard`. The middleware (section 7) is responsible
//      for bouncing the post-transition user to `/auth/crp-review` based on
//      their new status — this handler intentionally does NOT do that
//      routing here, so the same logic stays in one place.
//
// Failure modes (any of these → /login?reason=verification_failed):
//   • `code` is missing
//   • `exchangeCodeForSession` returns an error or no user
//
// Errors AFTER a successful exchange (e.g. `applyTransition` throws or
// returns `profile_not_found`) are tolerated — the session is real, we log
// the anomaly, and we still redirect to /dashboard so the user is not
// stranded. The middleware will then route them based on their (still
// `pending_verification`) status.
//
// This file is placed at `src/app/auth/callback/route.ts` (NOT under the
// `(auth)` route group) per the section-6 brief. Next.js route groups only
// affect layout inheritance — route handlers ignore layouts, so the
// physical placement is purely organizational. Keeping this outside the
// group makes it explicit that the callback is not a page rendered inside
// the auth shell.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const failureUrl = new URL('/login?reason=verification_failed', request.url);
  const successUrl = new URL('/dashboard', request.url);

  if (!code) {
    logger.info(
      { event: 'auth_callback_missing_code' },
      'verification callback hit without a code',
    );
    return NextResponse.redirect(failureUrl, 307);
  }

  let userId: string;
  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error || !data.user) {
      logger.warn(
        {
          event: 'auth_callback_exchange_failed',
          errorName: error?.name ?? 'NoUserReturned',
        },
        'verification callback could not exchange code',
      );
      return NextResponse.redirect(failureUrl, 307);
    }

    userId = data.user.id;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'auth_callback_exchange_threw', errorName: name },
      'verification callback exchange threw',
    );
    return NextResponse.redirect(failureUrl, 307);
  }

  // Advance the profile lifecycle. We treat both `invalid_transition` and
  // `profile_not_found` as idempotent success:
  //
  //   • `invalid_transition` happens when the user clicks the link a second
  //     time (status is already `pending_crp_validation` or beyond). The
  //     spec calls this out explicitly — re-clicking must NOT regress the
  //     account to a worse state, and the user should still land somewhere
  //     reasonable. The middleware will route them based on their current
  //     status.
  //
  //   • `profile_not_found` is a rare edge (signup partially rolled back,
  //     row was hard-deleted by LGPD job between signup and verification).
  //     The session is real; we log the anomaly and let the middleware
  //     handle the orphan.
  try {
    const result = await applyTransition(userId, 'email_verified');
    if (!result.ok) {
      logger.info(
        {
          event: 'auth_callback_transition_noop',
          reason: result.error,
        },
        'verification callback transition was a no-op (treated as idempotent success)',
      );
    } else {
      logger.info(
        { event: 'auth_callback_transition_succeeded', newStatus: result.status },
        'verification callback advanced account status',
      );
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'auth_callback_transition_threw', errorName: name },
      'verification callback transition threw — session is real, falling through to /dashboard',
    );
    // Intentional: the session is established. Redirecting to
    // verification_failed would log the user out of a perfectly valid
    // session. Letting them through to /dashboard lets the middleware
    // route by their (possibly still pending) status on the next request.
  }

  return NextResponse.redirect(successUrl, 307);
}
