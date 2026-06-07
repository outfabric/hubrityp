---
name: onboarding-module-patterns
description: Schema, RLS, Zod validators, and test patterns established in the onboarding-data-model change (2026-05). Covers profiles columns, singleton tables, read helpers, and integration test structure.
metadata:
  type: project
---

Established by `feature/onboarding-data-model` (reviewed 2026-05-31).

## Schema

**New `profiles` columns** (onboarding-data-model change): `onboarding_step` (text NOT NULL default 'welcome'), `onboarding_completed_at`, `tour_completed_at`, `first_access_at`, `reactivated_at` (nullable timestamptz), `nps_score` (integer nullable, CHECK 0..10), `nps_feedback` (text nullable, PII-adjacent), `nps_responded_at` (nullable timestamptz).

**`onboarding_checklist` table**: singleton per user (UNIQUE on `user_id`), seven boolean columns all DEFAULT FALSE. Cross-schema FK to `auth.users(id)` ON DELETE CASCADE (emitted by hand in migration — same pattern as `profiles.user_id`).

**`notification_preferences` table**: singleton per user (UNIQUE on `user_id`), four boolean columns all DEFAULT TRUE. `email_critical` is NON-DISABLEABLE by design.

## RLS

Both new tables: SELECT/INSERT/UPDATE policies scoped `auth.uid() = user_id`; WITH CHECK on INSERT and UPDATE; **no DELETE policy** (account deletion cascades via FK). No `USING (true)`. Mirrors `onboarding/policies.ts`.

Existing `profiles` UPDATE policy is unrestricted by column — new NPS/onboarding columns added to `profiles` are therefore user-writable via PostgREST (pre-existing gap, not introduced by this change).

## Zod validators

`onboardingStepSchema`, `npsAnswerSchema`, `notificationPreferencesSchema` in `src/modules/onboarding/lib/schemas.ts`. `NpsScore` branded type + `toNpsScore()` constructor in `branded.ts`.

**Known schema/business-rule mismatch (flagged 2026-05-31)**: `notificationPreferencesSchema` accepts `emailCritical: false` (z.boolean()) but the table says the field is non-disableable. The write path should either omit `emailCritical` from the write schema or use `z.literal(true)`. This was flagged as HIGH before any write action was landed. See [[feedback_pii_in_logs]] for related LGPD discipline.

## Read helpers

`getOnboardingChecklist(db: AppDb, userId: string)` and `getNotificationPreferences(db: AppDb, userId: string)` in `src/modules/onboarding/server/`. Both import `server-only`. Both accept an **injected** RLS-scoped `AppDb` (not a module-level singleton). Return `null` if no row exists yet (lazy-upsert pattern).

## Test patterns

- Unit: `src/__tests__/unit/modules/onboarding/lib/branded.test.ts` and `schemas.test.ts`.
- Integration (data-model): `src/__tests__/integration/onboarding/data-model.int.test.ts` — uses `runAsService` for fixture setup/teardown and `runAsUser` for RLS-scoped assertions.
- Integration (read-helpers): `src/__tests__/integration/onboarding/read-helpers.int.test.ts` — injects `runAsUser` `db` directly into the helpers (not a Supabase client).
- `seedAuthUser()` helper pattern: inserts into `auth.users` with required `raw_user_meta_data` (fullName, crpNumber, crpUf, three consent timestamps) to satisfy the `handle_new_user()` trigger; uses `userId.slice(0, 6)` as CRP number to avoid unique constraint collision.

## Migration pattern (0034)

- Drizzle-generated table DDL first.
- Manual edits section: CHECK constraints, cross-schema FKs, explicit named indexes on `user_id` (with `IF NOT EXISTS` guard), RLS ENABLE + CREATE POLICY statements.
- All policies end with `;` and `-->statement-breakpoint` separators (last statement has no trailing breakpoint).

## Known test gaps (flagged for follow-up)

- No integration test for `nps_score = 0` (lower boundary acceptance) or `nps_score = -1` (rejection) at the DB CHECK level.
- No integration test for invalid `onboarding_step` value being rejected by the CHECK constraint.

## Onboarding wizard patterns (2026-05-31, feature/onboarding-wizard)

### Middleware gating
- `/onboarding/welcome` and `/onboarding/setup` added to `APP_PREFIXES` in `classifyPath()`. Both use strict `pathname === prefix || pathname.startsWith(prefix + '/')` guard. Near-miss `/onboarding/welcomex` correctly falls through to public. Decision-table comment updated.
- `withPathnameHeader()` function added to middleware: injects `x-pathname` request header on pass responses so layouts can read the path (Next.js doesn't expose this natively). Correctly copies Supabase Set-Cookie headers onto the new NextResponse.

### Server Actions pattern
- All 7 impl files (`save-onboarding-step.ts`, `complete-onboarding.ts`, `skip-onboarding.ts`, `resume-step.ts`, `upload-profile-photo.ts`, `configure-location.ts`, `import-onboarding-patients.ts`) follow: `server-only` import, `supabase.auth.getUser()` first, `userId = user.id` from session, explicit IDOR guard (client `userId` field typed but silently ignored), module-level `db` for writes with `WHERE user_id = userId`, sanitized result shape, no PII in logs.
- Thin `'use server'` wrappers in `src/app/(app)/onboarding/*/actions.ts` — directive stays at the call-site boundary, not in module server/ files.

### Known functional gap (HIGH, review-1.md)
- `saveProfileStep()` action takes **no arguments**. `StepProfile` collects `displayName`, `phone`, `bio` but these are never sent to the server. The form data is silently discarded. The `profiles` table has no `display_name`, `bio`, or phone column. Fix: either (a) add the columns and wire the action to write them, or (b) remove the form controls until the schema supports them.

### RLS contract violation (MEDIUM, review-1.md)
- `readSummary(userId)` in `src/app/(app)/onboarding/setup/[step]/page.tsx` calls `getOnboardingChecklist(db, userId)` with the module-level bypass `db`. The function's docstring requires an RLS-scoped client. Not exploitable (userId is session-verified), but violates the API contract. Fix: use `createServerClient()` or restructure to avoid the bypass client.

### Storage bucket
- `onboarding-profile-photos` (private). Objects keyed `<auth.uid()>/<uuid>.<ext>`. Four per-operation RLS policies in migration 0035 using `(storage.foldername(name))[1] = auth.uid()::text`. Extension derived from MIME type allowlist (jpeg/png/webp), never from user filename.

### Advisory lock pattern (E2E)
- `ONBOARDING_PROFILE_LOCK_KEY = 770_011` in `seed-state.ts`. `welcome.spec.ts` and `wizard-flow.spec.ts` both mutate the shared seeded profile's `onboarding_step`. They acquire `pg_advisory_lock` on a dedicated connection per `beforeEach`/`afterEach` to prevent parallel-worker races.

### Migration 0037
- Relaxes `profiles.sensitive_data_consent_at` from NOT NULL to nullable (LGPD consent withdrawal path). Signup still stamps it via trigger. Server gate in `importOnboardingPatientsImpl` enforces the NULL = no consent rule.

### getOnboardingChecklist API contract
- Function signature: `getOnboardingChecklist(db: AppDb, userId: string)`. The `db` argument MUST be the RLS-scoped Drizzle client (not the module-level bypass singleton). Current wizard page violates this. See Known RLS contract violation above.

## Checklist + Tour patterns (2026-06-04, feature/onboarding-checklist-and-tour)

### DB migration 0038
- Adds `first_consent_sent boolean NOT NULL DEFAULT false` to `onboarding_checklist`. Additive only — safe.
- `whatsapp_connected` and `billing_configured` remain in the table schema but are **never written by `recomputeChecklistImpl`** (post-MVP features). They stay permanently `false` until those modules ship. Flag for follow-up.

### `recomputeChecklistImpl` pattern
- Located at `src/modules/onboarding/server/recompute-checklist.ts`. Wrapped in `React.cache()` for per-request deduplication (cache key is the `supabase` argument reference, NOT the user ID — comment in integration test is misleading).
- Uses module-level `db` (bypass-RLS Drizzle) with explicit `eq(*.userId, userId)` predicates on every query — 8 parallel probes via `Promise.all`. Owner-scoped, IDOR-safe by construction.
- Upserts via `onConflictDoUpdate({ target: onboardingChecklist.userId, set: { ...flags, updatedAt } })` — conflict on the UNIQUE(`user_id`) constraint.
- `getUser()` for auth, result typed as `RecomputeChecklistOk | RecomputeChecklistUnauthorized`.

### `completeTourImpl` pattern
- Located at `src/modules/onboarding/server/complete-tour.ts`. Stamps `profiles.tour_completed_at = now()` with `IS NULL` guard (idempotent — subsequent calls are no-ops, `stamped: false`).
- `getUser()` for auth; writes to `profiles` via bypass `db` with explicit `eq(profiles.userId, userId)` + `isNull(profiles.tourCompletedAt)`.

### Dashboard integration
- `DashboardTour` component: client leaf with `dynamic(ssr:false)` — Driver.js never reaches server/Edge bundle.
- Auto-run gate: `tourCompletedAt` prop from server (not localStorage). Replay via `?tour=replay` query param (stripped after reading to avoid loop). Same-page replay via `REPLAY_TOUR_EVENT` custom DOM event.
- `completeTour` Server Action in `src/app/(app)/dashboard/actions.ts` (thin `'use server'` shell, impl in module barrel).

### Tour spec timing heuristic
- `endTourAndAwaitStamp()` uses `waitForTimeout(1_500)` before ending the tour to let the `dynamic(ssr:false)` leaf hydrate and bind `completeTour`. Flagged as MEDIUM — not masking a functional bug but fragile on slow CI. Consider `page.waitForLoadState('networkidle')` or a functional check.

### `dedicated-user-auth.ts` pattern
- Shared helper for E2E specs needing a second authenticated user (checklist, tour, empty-dashboard). Registers user with mock GoTrue via `/_test/register-oauth-user`, builds Supabase auth cookie client-side with `@supabase/ssr`, injects into browser context. Per-user refresh token prevents session-ownership confusion on Server Action refresh.

### Mock GoTrue scoped clear
- `/_test/clear-oauth-users` now accepts `{ code }` body for surgical per-registration removal. Full-registry clear remains available for blanket global resets. This prevents Google OAuth stub teardown from wiping dedicated users registered by parallel specs.
