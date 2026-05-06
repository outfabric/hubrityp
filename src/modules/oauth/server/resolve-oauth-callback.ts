import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { getCurrentProfile } from '@/modules/registration/server/get-profile';
import { db } from '@/shared/db/client';
import { profiles } from '@/shared/db/schema/auth/tables';
import { logger } from '@/shared/lib/logger';

// `resolveOAuthCallback` implements the branching table from the
// `oauth-google` spec. It is called by the `/auth/callback` route handler
// after `exchangeCodeForSession` succeeds for an OAuth code. The function
// inspects the session's user, checks for an existing profile, and returns
// a `{ destination }` object that the route handler 307-redirects to.
//
// Branching table:
//   Session + profile exists + active          → /dashboard
//   Session + profile exists + pending_*       → /onboarding/pending
//   Session + no profile + only Google + no collision → /onboarding/complete-profile
//   Session + no profile + email collision     → /auth/link-account?pendingUserId=<id>
//   Code exchange fails                        → error (handled upstream)

export type ResolveOAuthCallbackInput = {
  supabase: SupabaseClient;
  code: string;
  next?: string | null;
};

export type ResolveOAuthCallbackResult =
  | { ok: true; destination: string }
  | { ok: false; error: 'exchange_failed' | 'no_session' };

export async function resolveOAuthCallback({
  supabase,
  code,
  next,
}: ResolveOAuthCallbackInput): Promise<ResolveOAuthCallbackResult> {
  // Exchange the code for a session.
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data?.user) {
    logger.warn(
      {
        event: 'oauth_callback_exchange_failed',
        errorName: error?.name ?? 'NoUser',
        errorCode: (error as { code?: string } | null)?.code,
      },
      'OAuth code exchange failed',
    );
    return { ok: false, error: 'exchange_failed' };
  }

  const user = data.user;

  // If there is a `next` parameter for recovery flow, honor it.
  if (next === '/reset-password') {
    return { ok: true, destination: '/reset-password' };
  }

  // Check if user has an existing profile.
  const profile = await getCurrentProfile(supabase);

  if (profile) {
    // User has a profile — redirect based on status.
    if (profile.status === 'active') {
      return { ok: true, destination: '/dashboard' };
    }
    // pending_verification or pending_crp_validation
    return { ok: true, destination: '/onboarding/pending' };
  }

  // No profile. Determine if this is an OAuth-only user (first time with
  // Google) or if there is an email collision with an existing account.
  const isOAuthUser = isOAuthOnlyUser(user);

  if (!isOAuthUser) {
    // User signed in with email provider but somehow has no profile.
    // This is a transient state (trigger race) — send to onboarding/pending.
    return { ok: true, destination: '/onboarding/pending' };
  }

  // OAuth-only user with no profile. Check for email collision: does
  // another profiles row exist with the same email?
  const email = user.email;
  if (!email) {
    logger.warn(
      { event: 'oauth_callback_no_email', userId: user.id },
      'OAuth user has no email — cannot check for collision',
    );
    return { ok: true, destination: '/onboarding/complete-profile' };
  }

  const collision = await checkEmailCollision(email, user.id);

  if (collision) {
    // Another user already has this email — redirect to link-account flow.
    return {
      ok: true,
      destination: `/auth/link-account?pendingUserId=${user.id}`,
    };
  }

  // No collision — first time OAuth user, send to complete-profile.
  return { ok: true, destination: '/onboarding/complete-profile' };
}

/**
 * Check if the user is an OAuth-only user (has only Google/social identity,
 * no email/password identity). Uses the identities array from the user
 * object (available after `getUser()` or `exchangeCodeForSession`).
 */
function isOAuthOnlyUser(user: { app_metadata?: Record<string, unknown> }): boolean {
  const provider = user.app_metadata?.provider;
  // Supabase sets `app_metadata.provider` to the primary provider.
  // For email/password users it's 'email'; for Google it's 'google'.
  return typeof provider === 'string' && provider !== 'email';
}

/**
 * Check if another profile row exists with the same email but a different
 * user ID. This indicates an email collision — the new OAuth user has the
 * same email as an existing traditional account.
 *
 * Uses the app-level Drizzle client (service-role, RLS-exempt) because
 * the new OAuth user does not own the colliding profile row.
 */
async function checkEmailCollision(email: string, currentUserId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.email, email))
    .limit(1);

  if (rows.length === 0) {
    return false;
  }

  // There is a profile with this email. If it belongs to the current user,
  // no collision (shouldn't happen since we already checked profile is null).
  return rows[0]!.userId !== currentUserId;
}
