import 'server-only';

import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { completeProfileInputSchema } from '@/modules/oauth/lib/complete-profile-input-schema';
import { logAuthEvent } from '@/modules/registration/server/log-auth-event';
import { db } from '@/shared/db/client';
import { oauthIdentities, profiles } from '@/shared/db/schema/auth/tables';
import { logger } from '@/shared/lib/logger';
import { createServerClient } from '@/shared/supabase/server';

// Discriminated union returned to the form. Errors are typed string literals
// so the result stays serializable across the Server Action boundary.
export type CompleteOAuthProfileResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'duplicate_crp' | 'invalid_session' | 'unknown' };

/**
 * Coerce a checkbox FormData value into a strict boolean.
 */
function coerceCheckbox(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true';
}

/**
 * Detect a Postgres unique-violation on `(crp_number, crp_uf)`.
 */
function isDuplicateCrpViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message ?? '';
  // postgres-js wraps the cause; check both the outer message and nested cause.
  const cause = (error as unknown as { cause?: unknown }).cause;
  const causeMessage = cause instanceof Error ? cause.message : '';
  const combined = `${message} ${causeMessage}`;
  return /profiles_crp_number_crp_uf_unique/.test(combined) || /23505/.test(combined);
}

/**
 * Complete an OAuth user's profile after their first Google sign-in.
 *
 * The user already has a session (created by `exchangeCodeForSession` in the
 * callback route) but no `profiles` row yet. This function validates the
 * professional fields (CRP, UF, consents), INSERTs the profile and
 * `oauth_identities` rows via the service-role Drizzle client, logs the
 * `oauth_signup` event, and redirects to `/onboarding/pending`.
 *
 * Never throws — all failure modes return typed error objects.
 */
export async function completeOAuthProfileImpl(
  formData: FormData,
): Promise<CompleteOAuthProfileResult> {
  // 1. Authenticate: verify a session exists.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: 'invalid_session' };
  }

  // 2. Validate input.
  const raw = {
    fullName: formData.get('fullName'),
    crpNumber: formData.get('crpNumber'),
    crpUf: formData.get('crpUf'),
    acceptedTerms: coerceCheckbox(formData.get('acceptedTerms')),
    acceptedPrivacy: coerceCheckbox(formData.get('acceptedPrivacy')),
    acceptedSensitiveData: coerceCheckbox(formData.get('acceptedSensitiveData')),
  };

  const parsed = completeProfileInputSchema.safeParse(raw);

  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const input = parsed.data;

  // 3. Extract Google identity info from the user's identities.
  const googleIdentity = user.identities?.find((i) => i.provider === 'google');
  const providerUserId = googleIdentity?.id ?? user.id;

  // 4. INSERT profile + oauth_identities in a single transaction.
  const email = user.email ?? '';
  const now = sql`now()`;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(profiles).values({
        userId: user.id,
        email,
        fullName: input.fullName,
        crpNumber: input.crpNumber,
        crpUf: input.crpUf,
        status: 'pending_crp_validation',
        emailVerifiedAt: new Date(),
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
        sensitiveDataConsentAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await tx.insert(oauthIdentities).values({
        userId: user.id,
        provider: 'google',
        providerUserId,
        isPrimary: true,
        linkedAt: now,
      });
    });
  } catch (err) {
    if (isDuplicateCrpViolation(err)) {
      return { ok: false, error: 'duplicate_crp' };
    }
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'complete_oauth_profile_insert_failed', errorName: name },
      'profile INSERT for OAuth user failed',
    );
    return { ok: false, error: 'unknown' };
  }

  // 5. Best-effort audit log.
  await logAuthEvent({
    userId: user.id,
    event: 'oauth_signup',
    metadata: {
      provider: 'google',
      crpNumber: input.crpNumber,
      crpUf: input.crpUf,
    },
  });

  // 6. Redirect to onboarding/pending.
  redirect('/onboarding/pending');
}
