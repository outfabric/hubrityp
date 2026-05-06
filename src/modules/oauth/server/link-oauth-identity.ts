import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { eq, sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { applyFailedLoginAttempt, isCurrentlyLockedOut } from '@/modules/auth/server/lockout';
import { linkAccountInputSchema } from '@/modules/oauth/lib/link-account-input-schema';
import { logAuthEvent } from '@/modules/registration/server/log-auth-event';
import { db } from '@/shared/db/client';
import { oauthIdentities, profiles } from '@/shared/db/schema/auth/tables';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';

// Discriminated union returned to the form.
export type LinkOAuthIdentityResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'invalid_credentials' | 'invalid_link_request' | 'unknown' };

/**
 * Link a Google OAuth identity to an existing traditional (email/password)
 * account.
 *
 * This is called when an OAuth sign-in detects an email collision: an
 * existing user already has a profile with the same email. The user must
 * confirm ownership by providing the existing account's password.
 *
 * On success:
 *   - Delete the pending OAuth user via admin API
 *   - INSERT into oauth_identities for the traditional user
 *   - Log `social_linked`
 *   - Redirect to `/login?banner=account_linked`
 *
 * On failure:
 *   - Log `login_failure` and increment failed-attempt counter
 *   - Return `{ ok: false, error: 'invalid_credentials' }`
 *
 * Never throws.
 */
export async function linkOAuthIdentityImpl(formData: FormData): Promise<LinkOAuthIdentityResult> {
  // 1. Validate input.
  const raw = {
    password: formData.get('password'),
    pendingUserId: formData.get('pendingUserId'),
  };

  const parsed = linkAccountInputSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { password, pendingUserId } = parsed.data;

  // 2. Look up the pending user to get the email for password verification.
  //    Use the admin client to read auth.users directly.
  const adminClient = createSupabaseClient(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: pendingUserData, error: pendingUserError } =
    await adminClient.auth.admin.getUserById(pendingUserId);

  if (pendingUserError || !pendingUserData?.user) {
    logger.warn(
      {
        event: 'link_oauth_pending_user_not_found',
        pendingUserId,
        errorName: pendingUserError?.name ?? 'NoUser',
      },
      'pending OAuth user not found',
    );
    return { ok: false, error: 'invalid_link_request' };
  }

  const pendingUser = pendingUserData.user;
  const email = pendingUser.email;

  if (!email) {
    return { ok: false, error: 'invalid_link_request' };
  }

  // 3. Find the existing traditional account with this email.
  const [existingProfile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.email, email))
    .limit(1);

  if (!existingProfile) {
    logger.warn(
      { event: 'link_oauth_no_existing_profile', email: '***' },
      'no existing profile found for link-account email',
    );
    return { ok: false, error: 'invalid_link_request' };
  }

  const traditionalUserId = existingProfile.userId;

  // 3b. Check lockout state before attempting password verification.
  //     Return `invalid_credentials` (not `locked_out`) for anti-enumeration.
  const lockout = isCurrentlyLockedOut(existingProfile);
  if (lockout.lockedOut) {
    void logAuthEvent({
      userId: traditionalUserId,
      event: 'login_failure',
      metadata: { source: 'link_account', reason: 'locked_out' },
    });
    return { ok: false, error: 'invalid_credentials' };
  }

  // 4. Verify password using an ISOLATED Supabase client (no cookie
  //    interaction). This client is created from scratch with the anon key
  //    and talks to GoTrue's password-sign-in endpoint, which validates the
  //    password without modifying the current request's cookies.
  const isolatedClient = createSupabaseClient(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  const { error: signInError } = await isolatedClient.auth.signInWithPassword({
    email,
    password,
  });

  if (!signInError) {
    // Clean up the isolated session created by signInWithPassword — best-effort.
    try {
      void isolatedClient.auth.signOut().catch(() => {});
    } catch {
      // signOut may not exist on minimal client instances (e.g., tests).
    }
  }

  if (signInError) {
    // Password verification failed — increment the failed-attempt counter
    // on the traditional user's profile.
    await applyFailedLoginAttempt(db, traditionalUserId);

    void logAuthEvent({
      userId: traditionalUserId,
      event: 'login_failure',
      metadata: { source: 'link_account', provider: 'google' },
    });

    return { ok: false, error: 'invalid_credentials' };
  }

  // 5. Password correct. Extract Google identity info from the pending user.
  const googleIdentity = pendingUser.identities?.find(
    (i: { provider: string }) => i.provider === 'google',
  );
  const providerUserId = googleIdentity?.id ?? pendingUserId;

  // 6. Delete the pending OAuth user (cleanup).
  try {
    await adminClient.auth.admin.deleteUser(pendingUserId);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'link_oauth_delete_pending_failed', errorName: name, pendingUserId },
      'failed to delete pending OAuth user — proceeding with link',
    );
    // Non-fatal: the link can still proceed. The orphan user will not cause
    // issues because it has no profile row.
  }

  // 7. INSERT oauth_identities for the traditional user.
  try {
    await db.insert(oauthIdentities).values({
      userId: traditionalUserId,
      provider: 'google',
      providerUserId,
      isPrimary: false,
      linkedAt: sql`now()`,
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'link_oauth_identity_insert_failed', errorName: name },
      'oauth_identities INSERT failed during link',
    );
    return { ok: false, error: 'unknown' };
  }

  // 8. Log the successful link.
  await logAuthEvent({
    userId: traditionalUserId,
    event: 'social_linked',
    metadata: { provider: 'google', linkedPendingUserId: pendingUserId },
  });

  // 9. Redirect to login with success banner.
  redirect('/login?banner=account_linked');
}
