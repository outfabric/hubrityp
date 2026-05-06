import { and, eq, isNull } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { logAuthEvent } from '@/modules/registration/server/log-auth-event';
import { db } from '@/shared/db/client';
import { authSessions } from '@/shared/db/schema/auth/tables';
import { clearKeepLoggedInCookie } from '@/shared/lib/cookies/keep-logged-in';
import { logger } from '@/shared/lib/logger';
import { createServerClient } from '@/shared/supabase/server';

// `signOutImpl` is the module-side implementation of the `signOut` Server
// Action. This file MUST NOT carry a top-level `'use server'` directive —
// that lives on the route shell (`app/(app)/actions.ts`) which wraps this
// function. See `src/modules/auth/server/login.ts` for the same rationale.
//
// The action performs a GLOBAL signout (revokes all sessions for this user,
// not just the current one) so that a compromised token on another device
// is immediately invalidated.
export async function signOutImpl(): Promise<void> {
  const supabase = await createServerClient();

  // Capture user id BEFORE signing out — once the session is revoked,
  // `getUser()` will return null.
  let userId: string | null = null;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    // If getUser fails, proceed with signOut anyway — best-effort.
  }

  // Best effort: we still redirect to /login even if Supabase fails.
  // Clearing the session is idempotent from the user's perspective.
  try {
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) {
      logger.warn(
        { event: 'signout_failed', errorName: error.name ?? 'AuthError' },
        'supabase signOut returned an error',
      );
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn({ event: 'signout_unknown_error', errorName: name }, 'supabase signOut threw');
  }

  // UPDATE `auth_sessions.revokedAt` for all non-revoked sessions of this
  // user — best-effort, failure does not prevent redirect.
  if (userId) {
    try {
      await db
        .update(authSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
    } catch (err) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      logger.warn(
        { event: 'signout_sessions_update_failed', errorName: name },
        'failed to revoke auth_sessions rows',
      );
    }
  }

  // Clear the keep-logged-in sidecar cookie — best-effort.
  try {
    const cookieStore = await cookies();
    clearKeepLoggedInCookie(cookieStore);
  } catch {
    // Cookie clearing is best-effort — the redirect still happens.
  }

  // Log the logout event — best-effort.
  if (userId) {
    void logAuthEvent({
      userId,
      event: 'logout',
    });
  }

  redirect('/login');
}
