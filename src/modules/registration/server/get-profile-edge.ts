import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Profile } from '@/modules/registration/lib/profile';
import type { ProfileStatus } from '@/modules/registration/lib/profile-status';

// `getCurrentProfileEdge` is the Edge-runtime sibling of `getCurrentProfile`.
//
// Why a separate function: the Next.js `middleware.ts` file convention runs
// on the **Edge runtime** (per Next.js 16 docs — only the new `proxy.ts`
// convention defaults to Node.js). The canonical `getCurrentProfile` reads
// `profiles` through Drizzle (`postgres-js`), which depends on Node-only
// APIs (`net`, `tls`, worker threads) and therefore cannot be bundled into
// an Edge worker. The two implementations honour the same contract so RSC
// callers (Node) and middleware callers (Edge) see the same `Profile | null`
// result for any given session.
//
// Implementation choice: we go through the Supabase REST surface instead of
// a direct Postgres connection. The middleware's `@supabase/ssr` client is
// authenticated via the user's session JWT, so the request is RLS-scoped
// to `auth.uid() = user_id` (matching the policy defined in
// `auth/policies.ts`). The query touches one row by primary key, costing a
// single PostgREST round-trip — the same performance budget as the Drizzle
// path.
//
// Returns `null` in two situations:
//   1. There is no session.
//   2. There is a session but the `profiles` row hasn't been materialized
//      yet (the SECURITY DEFINER trigger has not committed).
// The middleware treats both as "anonymous" per spec ("Authenticated user
// without a profile row is treated as anonymous for gating").
export async function getCurrentProfileEdge(supabase: SupabaseClient): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // PostgREST column list mirrors `profiles` so the returned shape matches
  // the Drizzle `Profile` type. The order is irrelevant — we map by name
  // below — but listing fields explicitly avoids accidentally over-fetching
  // if the table grows. `.maybeSingle()` returns `null` (not an error) when
  // the row is missing, which is exactly the race-window semantics we want.
  const { data, error } = await supabase
    .from('profiles')
    .select(
      [
        'user_id',
        'email',
        'full_name',
        'crp_number',
        'crp_uf',
        'crp_validated_at',
        'crp_validated_by',
        'email_verified_at',
        'status',
        'terms_accepted_at',
        'privacy_accepted_at',
        'sensitive_data_consent_at',
        'last_resend_at',
        'failed_login_count',
        'last_failed_login_at',
        'lockout_until',
        'consecutive_lockouts',
        'requires_password_reset',
        'onboarding_step',
        'onboarding_completed_at',
        'first_access_at',
        'reactivated_at',
        'nps_score',
        'nps_feedback',
        'nps_responded_at',
        'created_at',
        'updated_at',
      ].join(','),
    )
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  // PostgREST returns snake_case column names; the Drizzle-derived `Profile`
  // type uses camelCase. We rename here so the surface stays identical
  // across Edge and Node call sites. `as` casts on the timestamp fields are
  // safe because PostgREST encodes `timestamptz` as ISO-8601 strings — the
  // RSC consumer either renders them as strings (no Date conversion) or
  // wraps them in `new Date(...)` itself.
  // `supabase-js` infers a narrow type for `data` from the column list
  // string, but TS can't reconcile that inferred shape with our manual
  // mapping (it sees a string-literal column list and returns a
  // potentially-error union). Cast through `unknown` so we work with a
  // plain record — RLS + the explicit column list above are the real
  // shape guarantee.
  const row = data as unknown as Record<string, unknown>;
  return {
    userId: row.user_id as string,
    email: row.email as string,
    fullName: row.full_name as string,
    crpNumber: row.crp_number as string,
    crpUf: row.crp_uf as string,
    crpValidatedAt: parseTimestamp(row.crp_validated_at),
    crpValidatedBy: (row.crp_validated_by as string | null) ?? null,
    emailVerifiedAt: parseTimestamp(row.email_verified_at),
    status: row.status as ProfileStatus,
    termsAcceptedAt: parseTimestamp(row.terms_accepted_at) as Date,
    privacyAcceptedAt: parseTimestamp(row.privacy_accepted_at) as Date,
    sensitiveDataConsentAt: parseTimestamp(row.sensitive_data_consent_at) as Date,
    lastResendAt: parseTimestamp(row.last_resend_at),
    failedLoginCount: (row.failed_login_count as number) ?? 0,
    lastFailedLoginAt: parseTimestamp(row.last_failed_login_at),
    lockoutUntil: parseTimestamp(row.lockout_until),
    consecutiveLockouts: (row.consecutive_lockouts as number) ?? 0,
    requiresPasswordReset: (row.requires_password_reset as boolean) ?? false,
    onboardingStep: (row.onboarding_step as string) ?? 'welcome',
    onboardingCompletedAt: parseTimestamp(row.onboarding_completed_at),
    firstAccessAt: parseTimestamp(row.first_access_at),
    reactivatedAt: parseTimestamp(row.reactivated_at),
    npsScore: (row.nps_score as number | null) ?? null,
    npsFeedback: (row.nps_feedback as string | null) ?? null,
    npsRespondedAt: parseTimestamp(row.nps_responded_at),
    createdAt: parseTimestamp(row.created_at) as Date,
    updatedAt: parseTimestamp(row.updated_at) as Date,
  };
}

// PostgREST encodes `timestamptz` as ISO-8601 strings; the Drizzle-derived
// `Profile` type expects `Date`. We do the parse here so middleware
// callers don't have to. `null` round-trips for nullable columns.
function parseTimestamp(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  return new Date(value as string);
}
