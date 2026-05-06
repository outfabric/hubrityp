import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

import { resetLoginCounters } from '@/modules/auth/server/lockout';
import { resetPasswordInputSchema } from '@/modules/password-recovery/lib/reset-password-input-schema';
import { logAuthEvent } from '@/modules/registration/server/log-auth-event';
import { db } from '@/shared/db/client';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';
import { sendPasswordChangedEmail } from '@/shared/lib/mail/send-password-changed';
import { createServerClient } from '@/shared/supabase/server';

// ---------------------------------------------------------------------------
// 7.2 — resetPasswordImpl
//
// Server Action implementation for the "reset password" step. The user
// provides a new password (validated against `passwordPolicy`) after clicking
// the reset link in their email.
//
// Requires a valid recovery session (established by the `/auth/callback`
// code-exchange). If no session exists, returns `{ ok: false, error:
// 'invalid_session' }`.
//
// After updating the password:
//   1. Invalidates ALL sessions via `supabase.auth.admin.signOut(userId, 'global')`
//   2. Resets lockout state on profiles (failed_login_count, consecutive_lockouts, etc.)
//   3. Sends a "password changed" notification email (best-effort)
//   4. Logs `password_reset_completed`
//   5. Redirects to `/login?banner=password_changed`
//
// This file MUST NOT carry `'use server'` — the route shell
// (`app/(auth)/reset-password/actions.ts`) is the single Server Action
// entry point.
// ---------------------------------------------------------------------------

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'invalid_session' | 'update_failed' | 'unknown' };

/**
 * Build a service-role Supabase client on demand. Used for
 * `auth.admin.signOut(userId, 'global')` which requires service-role
 * privileges. Kept local to this module so the service-role key never
 * leaks to other surfaces.
 */
function buildAdminClient() {
  return createSupabaseClient(
    serverEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}

export async function resetPasswordImpl(formData: FormData): Promise<ResetPasswordResult> {
  const parsed = resetPasswordInputSchema.safeParse({
    password: formData.get('password'),
    passwordConfirm: formData.get('passwordConfirm'),
  });

  if (!parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }

  const { password } = parsed.data;

  // Verify the user has a valid recovery session.
  const supabase = await createServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    logger.warn(
      { event: 'password_reset_no_session', errorName: userError?.name },
      'resetPassword called without a valid session',
    );
    return { ok: false, error: 'invalid_session' };
  }

  const userId = userData.user.id;
  const userEmail = userData.user.email;

  try {
    // Update the password via the user-scoped Supabase client.
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      logger.warn(
        { event: 'password_reset_update_failed', errorName: updateError.name },
        'supabase.auth.updateUser failed',
      );
      return { ok: false, error: 'update_failed' };
    }

    // Invalidate ALL sessions globally via the admin client.
    // This forces the user to re-authenticate on all devices.
    try {
      const admin = buildAdminClient();
      await admin.auth.admin.signOut(userId, 'global');
    } catch (err) {
      // Best-effort: if the admin signOut fails, the password was still
      // changed. Log the failure but don't block the user.
      const name = err instanceof Error ? err.name : 'UnknownError';
      logger.warn(
        { event: 'password_reset_global_signout_failed', errorName: name },
        'admin.signOut(global) failed after password update',
      );
    }

    // Reset lockout state on the profiles table.
    try {
      await resetLoginCounters(db, userId);
    } catch (err) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      logger.warn(
        { event: 'password_reset_lockout_reset_failed', errorName: name },
        'resetLoginCounters failed after password update',
      );
    }

    // Send "password changed" notification email (best-effort).
    if (userEmail) {
      void sendPasswordChangedEmail(userEmail).catch(() => {
        // Swallowed — mail delivery is best-effort.
      });
    }

    // Audit log.
    void logAuthEvent({
      userId,
      event: 'password_reset_completed',
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn({ event: 'password_reset_unknown_error', errorName: name }, 'resetPassword failed');
    return { ok: false, error: 'unknown' };
  }

  redirect('/login?banner=password_changed');
}
