import { and, eq } from 'drizzle-orm';

import { documentVersions } from '@/modules/account-lifecycle';
import { db } from '@/shared/db/client';
import { crpValidationQueue } from '@/shared/db/schema/auth/crp-validation-queue';
import { psychologistProfiles } from '@/shared/db/schema/auth/psychologist-profiles';
import { logger } from '@/shared/lib/logger';
import { createAdminClient } from '@/shared/supabase/admin';
import { createServerClient } from '@/shared/supabase/server';

import { type SignupInput, signupInputSchema } from '../lib/signup-input-schema';

// Discriminated union returned to the page. Errors are typed string literals,
// never `Error` instances, so the result stays serializable across the
// Server Action boundary and consumers can narrow exhaustively.
//
// `fieldErrors` is only populated for `validation_failed` and carries a
// per-field string ready for the form to render inline. Other branches do
// not need field-level granularity.
export type SignUpResult =
  | { ok: true; redirectTo: '/auth/verify-email' }
  | {
      ok: false;
      error:
        | 'email_already_registered'
        | 'crp_already_registered'
        | 'validation_failed'
        | 'unknown';
      fieldErrors?: Partial<Record<keyof SignupInput, string>>;
    };

// Postgres error code for `unique_violation`. We pin on the wire-protocol
// code rather than message strings, which can drift across server versions.
const PG_UNIQUE_VIOLATION = '23505';

// `signUpImpl` is the module-side implementation of the `signUp` Server
// Action. This file MUST NOT carry a top-level `'use server'` directive —
// that lives on the route shell (`app/(auth)/signup/actions.ts`) which wraps
// this function. See `src/modules/auth/server/login.ts` for the same
// rationale.
//
// Accepts either a `FormData` (the Next.js form-post path) or a typed
// `SignupInput`-shaped object (typed callers from tests). The internal
// `parseInput` does the right thing for either.
export async function signUpImpl(input: unknown): Promise<SignUpResult> {
  // 1. Validate the payload BEFORE any side-effect. A failure here returns
  //    the field errors and never touches Supabase or the DB.
  const parsed = signupInputSchema.safeParse(parseInput(input));
  if (!parsed.success) {
    const flat = parsed.error.flatten().fieldErrors;
    const fieldErrors: SignUpResult & { fieldErrors?: Partial<Record<keyof SignupInput, string>> } =
      // Take the FIRST message per field — the form renders one error per
      // input. Multiple-message-per-field is preserved at the schema level
      // (we use `superRefine` for password) so the user can iterate; the
      // action just hands the topmost message back.
      { ok: false, error: 'validation_failed' };
    const collected: Partial<Record<keyof SignupInput, string>> = {};
    for (const [key, messages] of Object.entries(flat)) {
      if (messages && messages.length > 0) {
        collected[key as keyof SignupInput] = messages[0]!;
      }
    }
    fieldErrors.fieldErrors = collected;
    logger.info({ event: 'signup_failed', reason: 'validation_failed' }, 'signup validation');
    return fieldErrors;
  }

  const data = parsed.data;

  // 2. Pre-flight CRP uniqueness check. This is racy (the UNIQUE constraint
  //    in the DB is the real authority — see step 5b), but it lets us avoid
  //    creating a Supabase user that we would have to compensating-delete
  //    in the most common duplicate case. The race only matters when two
  //    signups submit the same CRP within milliseconds of each other.
  try {
    const existing = await db
      .select({ userId: psychologistProfiles.userId })
      .from(psychologistProfiles)
      .where(
        and(
          eq(psychologistProfiles.crpNumber, data.crpNumber),
          eq(psychologistProfiles.crpUf, data.crpUf),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      logger.info({ event: 'signup_failed', reason: 'crp_already_registered' }, 'signup duplicate');
      return { ok: false, error: 'crp_already_registered' };
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn({ event: 'signup_unknown_error', errorName: name }, 'signup pre-flight failed');
    return { ok: false, error: 'unknown' };
  }

  // 3. Create the Supabase Auth user. Using the in-flow `signUp` API (anon
  //    key) instead of `admin.createUser` so the verification email is
  //    triggered automatically by GoTrue's email-confirmation flow. The user
  //    is created with `email_confirmed_at IS NULL` until the link is
  //    clicked — exactly the pre-condition `pending_verification` expects.
  const createResult = await createSupabaseUser(data.email, data.password);
  if (!createResult.ok) {
    return createResult.result;
  }
  const supabaseUserId = createResult.userId;

  // 4. Insert the profile and queue rows in a single Drizzle transaction.
  //    Any failure here triggers a compensating delete of the Supabase user
  //    so the email is free to retry.
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(psychologistProfiles).values({
        userId: supabaseUserId,
        fullName: data.fullName,
        crpNumber: data.crpNumber,
        crpUf: data.crpUf,
        status: 'pending_verification',
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
        sensitiveDataConsentAt: now,
        termsVersion: documentVersions.terms,
        privacyVersion: documentVersions.privacy,
        sensitiveDataConsentVersion: documentVersions.sensitiveData,
      });

      await tx.insert(crpValidationQueue).values({
        userId: supabaseUserId,
        crpNumber: data.crpNumber,
        crpUf: data.crpUf,
        status: 'pending',
      });
    });
  } catch (err) {
    // Detect UNIQUE constraint races on `(crp_number, crp_uf)` so we surface
    // a typed `crp_already_registered` instead of a generic `unknown`.
    // Drizzle wraps the postgres-js error; the original error code is on
    // `.cause.code` (postgres-js) or `.code` directly depending on driver
    // version. We inspect both.
    const compensated = await compensatingDelete(supabaseUserId);
    const code = extractPostgresCode(err);
    const reason = code === PG_UNIQUE_VIOLATION ? 'crp_already_registered' : 'unknown';
    logger.warn(
      {
        event: 'signup_failed',
        reason,
        compensated,
        errorName: err instanceof Error ? err.name : 'UnknownError',
      },
      'signup transaction failed; supabase user rolled back',
    );
    if (reason === 'crp_already_registered') {
      return { ok: false, error: 'crp_already_registered' };
    }
    return { ok: false, error: 'unknown' };
  }

  logger.info({ event: 'signup_succeeded' }, 'signup complete');
  return { ok: true, redirectTo: '/auth/verify-email' };
}

// `parseInput` accepts either FormData (the form-post path used by the
// Server Action surface) or any object (typed callers from tests). Returning
// `unknown` keeps the type honest — the schema is the only thing that
// guarantees the shape.
function parseInput(input: unknown): unknown {
  if (input instanceof FormData) {
    const get = (key: string): string | undefined => {
      const value = input.get(key);
      return typeof value === 'string' ? value : undefined;
    };
    // Checkbox inputs come through as the literal string `'on'` when checked
    // and missing entirely when not. Normalise to boolean so the literal-true
    // schema can validate.
    const checked = (key: string): boolean => input.get(key) !== null;
    return {
      fullName: get('fullName'),
      email: get('email'),
      password: get('password'),
      passwordConfirm: get('passwordConfirm'),
      crpNumber: get('crpNumber'),
      crpUf: get('crpUf'),
      acceptedTerms: checked('acceptedTerms'),
      acceptedPrivacy: checked('acceptedPrivacy'),
      acceptedSensitiveData: checked('acceptedSensitiveData'),
    };
  }
  return input;
}

// Internal helper: create the Supabase Auth user via the in-flow `signUp`
// API (anon key + email-confirmation flow). Discriminated-union return so
// the caller can short-circuit with the typed result for any non-success
// branch. Keeping the side-effect in its own function lets `signUpImpl`
// stay readable as a step-by-step orchestration.
async function createSupabaseUser(
  email: string,
  password: string,
): Promise<{ ok: true; userId: string } | { ok: false; result: SignUpResult }> {
  try {
    const supabase = await createServerClient();
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      // `AuthApiError` with `status` 400/422 typically signals duplicate
      // email; the backend phrasing varies. We surface the typed error
      // verbatim — the spec accepts the small enumeration risk in exchange
      // for usability (PRD §8). Other auth errors collapse to `unknown`.
      const message = (signUpError.message ?? '').toLowerCase();
      if (
        message.includes('already registered') ||
        message.includes('already exists') ||
        message.includes('user already')
      ) {
        logger.info(
          { event: 'signup_failed', reason: 'email_already_registered' },
          'duplicate email',
        );
        return { ok: false, result: { ok: false, error: 'email_already_registered' } };
      }
      logger.warn(
        { event: 'signup_unknown_error', errorName: signUpError.name ?? 'AuthError' },
        'supabase signUp returned an error',
      );
      return { ok: false, result: { ok: false, error: 'unknown' } };
    }

    const userId = signUpData.user?.id;
    if (!userId) {
      logger.warn(
        { event: 'signup_unknown_error', reason: 'missing_user_id' },
        'supabase signUp returned no user id',
      );
      return { ok: false, result: { ok: false, error: 'unknown' } };
    }
    return { ok: true, userId };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn({ event: 'signup_unknown_error', errorName: name }, 'supabase signUp threw');
    return { ok: false, result: { ok: false, error: 'unknown' } };
  }
}

// Compensating delete for the Supabase Auth user we created in step 3. Runs
// when steps 4+ fail. MUST NOT throw across the boundary itself — we already
// have a typed error to return; an exception here would replace it with a
// raw Next.js overlay.
async function compensatingDelete(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      logger.warn(
        { event: 'signup_compensating_delete_failed', errorName: error.name ?? 'AuthError' },
        'supabase admin.deleteUser returned an error',
      );
      return false;
    }
    return true;
  } catch (err) {
    const name = err instanceof Error ? err.name : 'UnknownError';
    logger.warn(
      { event: 'signup_compensating_delete_failed', errorName: name },
      'supabase admin.deleteUser threw',
    );
    return false;
  }
}

// Drizzle wraps postgres-js errors. Different driver versions surface the
// SQLSTATE code on different shapes — `.code` directly, `.cause.code`, or
// nested deeper. We unwrap defensively and return `null` if we cannot find
// a code.
function extractPostgresCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const direct = (err as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === 'string') return causeCode;
  }
  return null;
}
