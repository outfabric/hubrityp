import 'server-only';

import { createHash } from 'node:crypto';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { signupInputSchema } from '@/modules/registration/lib/signup-input-schema';
import { serverEnv } from '@/shared/env';
import { logger } from '@/shared/lib/logger';
import { createServerClient } from '@/shared/supabase/server';

import { logAuthEvent } from './log-auth-event';

// Discriminated union returned to the page. Errors are typed string
// literals so the result stays serializable across the Server Action
// boundary and consumers can narrow exhaustively. `fieldErrors` is included
// only on `invalid_input` — the form surfaces inline messages from it.
export type SignUpResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'duplicate_email' | 'duplicate_crp' | 'unknown' };

const PENDING_REDIRECT = '/onboarding/pending';
const FALLBACK_ORIGIN = 'http://localhost:3000';

/**
 * Hash an email for audit-log storage. We never put a raw email in
 * `auth_logs.metadata` — the spec requires `emailHash` so investigators can
 * still correlate failed signups by recipient without keeping plaintext.
 */
function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

/**
 * Coerce a checkbox `FormData` value into a strict boolean so the Zod
 * schema's `z.literal(true)` consents resolve correctly. Standard browsers
 * send `'on'` for a checked input and omit the field entirely when
 * unchecked.
 */
function coerceCheckbox(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true';
}

/**
 * Detect a Postgres unique-violation on `(crp_number, crp_uf)`. Supabase
 * Auth surfaces trigger errors as a 5xx with the underlying Postgres
 * payload — we accept either the SQLSTATE code or the constraint name in
 * the message because the surfacing varies between Auth versions.
 */
function isDuplicateCrpViolation(error: { code?: string; message?: string }): boolean {
  if (error.code === '23505') return true;
  const message = error.message ?? '';
  return /profiles_crp_number_crp_uf_unique/.test(message);
}

/**
 * Detect a duplicate-email response from Supabase Auth. The SDK exposes
 * this either as the typed `code` `user_already_exists` / `email_exists`
 * or as a message string for older deployments.
 */
function isDuplicateEmailError(error: { code?: string; message?: string }): boolean {
  const code = error.code;
  if (code === 'user_already_exists' || code === 'email_exists') return true;
  const message = error.message ?? '';
  return /already registered|already exists/i.test(message);
}

/**
 * Resolve the absolute origin used as the email-verification link's base
 * URL. Browsers always attach the `Origin` header to a Server Action POST,
 * so the request-bound read is the production path. The localhost
 * fallback only fires in tests and non-browser callers — production
 * deployments enforce a Supabase redirect-URL allow-list, so an unexpected
 * fallback would simply cause Auth to refuse the email rather than send
 * to the wrong host.
 */
async function resolveOrigin(): Promise<string> {
  try {
    const h = await headers();
    const origin = h.get('origin');
    if (origin && origin.length > 0) return origin;
  } catch {
    // Outside a request context — fall through to the localhost fallback.
  }
  return FALLBACK_ORIGIN;
}

/**
 * Build a service-role Supabase client on demand. Used exclusively for the
 * `auth.admin.deleteUser` rollback path — kept local to this module so the
 * service-role key never leaks to other surfaces.
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

/**
 * Best-effort `auth.signOut` used by every failure branch in `signUpImpl`.
 *
 * Why a wrapper: Supabase has documented behaviour where, under email
 * obfuscation or certain edge cases, `auth.signUp` can attach a session
 * cookie to the response even when the action fails. Every failure return
 * defensively clears that cookie so a stranger's session can never ride
 * out a rejected signup. The cost is one round trip on a failure path —
 * acceptable.
 *
 * Errors thrown by `signOut` itself are swallowed: if Supabase is already
 * unreachable, the user-facing error code we are about to return is
 * already the right outcome and a secondary throw would mask it.
 */
async function safeSignOut(supabase: { auth: { signOut: () => Promise<unknown> } }): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'signup_signout_failed', errorName: name },
      'auth.signOut threw during signup failure cleanup',
    );
  }
}

/**
 * `signUpImpl` is the module-side implementation of the `signUp` Server
 * Action. This file MUST NOT carry a top-level `'use server'` directive —
 * that lives on the route shell (`app/(auth)/signup/actions.ts`) which
 * wraps this function. See `src/modules/auth/server/login.ts` for the same
 * rationale.
 *
 * Flow (per `design.md` D8):
 *   1. Coerce checkbox FormData entries to booleans, then `safeParse`.
 *   2. On schema failure → `invalid_input` with flat field errors. No DB
 *      or Supabase calls happen.
 *   3. Stamp ISO timestamps for the three consents (the trigger reads
 *      these from `raw_user_meta_data`).
 *   4. `supabase.auth.signUp` with `emailRedirectTo` and the metadata the
 *      trigger needs to materialize the `profiles` row.
 *   5. Map errors:
 *        - duplicate email → log `signup_failure_duplicate_email`,
 *          return `duplicate_email`.
 *        - unique-violation on (crp_number, crp_uf) → admin.deleteUser
 *          rollback (best-effort), log `signup_failure_duplicate_crp`,
 *          return `duplicate_crp`.
 *        - any other → return `unknown`.
 *   6. On success → log `signup_success` with crpNumber/crpUf metadata,
 *      then `redirect('/onboarding/pending')`.
 *
 * Note on `redirect()`: the call throws a `NEXT_REDIRECT` marker that
 * Next.js intercepts. That throw is the *expected* termination path on
 * success; we deliberately keep `redirect()` OUTSIDE any try/catch so the
 * marker propagates.
 */
export async function signUpImpl(formData: FormData): Promise<SignUpResult> {
  const raw = {
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
    passwordConfirm: formData.get('passwordConfirm'),
    crpNumber: formData.get('crpNumber'),
    crpUf: formData.get('crpUf'),
    acceptedTerms: coerceCheckbox(formData.get('acceptedTerms')),
    acceptedPrivacy: coerceCheckbox(formData.get('acceptedPrivacy')),
    acceptedSensitiveData: coerceCheckbox(formData.get('acceptedSensitiveData')),
  };

  const parsed = signupInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { fullName, email, password, crpNumber, crpUf } = parsed.data;
  const origin = await resolveOrigin();
  const emailRedirectTo = `${origin}/auth/callback`;

  // ISO timestamps stamped server-side at submission time. The booleans
  // are kept in metadata as audit context (so the auth_logs row history
  // captures *what was offered*), but the trigger reads the timestamps
  // (which are the authoritative legal record).
  const consentStampedAt = new Date().toISOString();

  // Wrap ONLY the Supabase boundary in try/catch. `redirect()` and
  // `logAuthEvent()` (best-effort, never throws) are called outside this
  // block so the redirect marker propagates and so a logging hiccup
  // cannot mask a real signup failure.
  //
  // We hold a reference to the SSR Supabase client so the failure branches
  // below can call `supabase.auth.signOut()` defensively — see the
  // duplicate-email comment for the obfuscation scenario this guards
  // against.
  const supabase = await createServerClient();
  let signUpData: { user: { id: string } | null } | null = null;
  let signUpError: { code?: string; message?: string; name?: string; status?: number } | null =
    null;
  try {
    const result = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
        data: {
          fullName,
          crpNumber,
          crpUf,
          acceptedTerms: parsed.data.acceptedTerms,
          acceptedPrivacy: parsed.data.acceptedPrivacy,
          acceptedSensitiveData: parsed.data.acceptedSensitiveData,
          termsAcceptedAt: consentStampedAt,
          privacyAcceptedAt: consentStampedAt,
          sensitiveDataConsentAt: consentStampedAt,
        },
      },
    });
    signUpData = result.data;
    signUpError = result.error;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn({ event: 'signup_unknown_error', errorName: name }, 'signup failure');
    // Defensive: even on a thrown boundary error Supabase may have set
    // partial cookies before throwing. Clear them so a stranger's session
    // cannot ride out a failed signup. `signOut` swallows its own errors;
    // we still wrap defensively because we never want this branch to
    // bubble a secondary failure into the user-facing flow.
    await safeSignOut(supabase);
    return { ok: false, error: 'unknown' };
  }

  if (signUpError) {
    if (isDuplicateEmailError(signUpError)) {
      // Defensive: Supabase has a documented "email obfuscation" mode
      // where, on a re-signup against an *unconfirmed* prior account,
      // GoTrue returns `200 OK` with a shadow user object AND sets
      // session cookies on the response — even though `data.user` may be
      // null and the request was effectively rejected. If obfuscation is
      // ever enabled (it varies by project config), the user would
      // receive "email já cadastrado" while quietly carrying a session
      // cookie for someone else's pending-verification account. Calling
      // `signOut` here is one round trip on a failure path — cheap
      // belt-and-suspenders that closes the hole regardless of project
      // configuration.
      await safeSignOut(supabase);
      await logAuthEvent({
        userId: null,
        event: 'signup_failure_duplicate_email',
        metadata: { emailHash: hashEmail(email) },
      });
      return { ok: false, error: 'duplicate_email' };
    }

    if (isDuplicateCrpViolation(signUpError)) {
      // The trigger raised `unique_violation` inside the signup
      // transaction. In modern Supabase Auth the entire transaction
      // rolls back and `data.user` is null — but older deployments may
      // leave the auth.user behind, so we still attempt admin.deleteUser
      // when an id is available. The call is best-effort: if it fails,
      // a sweep job (future change) will clean up any orphan rows.
      const orphanUserId = signUpData?.user?.id ?? null;
      if (orphanUserId) {
        try {
          const admin = buildAdminClient();
          await admin.auth.admin.deleteUser(orphanUserId);
        } catch (err) {
          const name = err instanceof Error ? err.name : 'UnknownError';
          logger.warn(
            { event: 'signup_rollback_failed', errorName: name },
            'admin.deleteUser threw during duplicate-CRP rollback',
          );
        }
      }
      // Same defense as duplicate_email above: if the signup transaction
      // somehow set a session cookie for the orphan user before being
      // rolled back, clear it so the rejected attempt cannot leak a
      // session. The `admin.deleteUser` rollback above only removes the
      // server-side row — the cookie on the response is independent.
      await safeSignOut(supabase);
      await logAuthEvent({
        userId: null,
        event: 'signup_failure_duplicate_crp',
        metadata: { crpNumber, crpUf, emailHash: hashEmail(email) },
      });
      return { ok: false, error: 'duplicate_crp' };
    }

    logger.warn(
      {
        event: 'signup_supabase_error',
        errorName: signUpError.name ?? 'AuthError',
        errorCode: signUpError.code,
      },
      'supabase.auth.signUp returned an unexpected error',
    );
    // Same defense as the other failure branches: an unrecognized
    // Supabase error must never leave a session cookie attached to a
    // failed signup.
    await safeSignOut(supabase);
    return { ok: false, error: 'unknown' };
  }

  // Success path. The trigger has already materialized `profiles` with
  // `status='pending_verification'` (atomic with the auth.users insert).
  // We log the audit row and then hand off via `redirect()` — note that
  // `redirect()` THROWS a `NEXT_REDIRECT` marker which is the expected
  // termination, so it MUST be outside the try/catch above.
  await logAuthEvent({
    userId: signUpData?.user?.id ?? null,
    event: 'signup_success',
    metadata: { crpNumber, crpUf },
  });

  redirect(PENDING_REDIRECT);
}
