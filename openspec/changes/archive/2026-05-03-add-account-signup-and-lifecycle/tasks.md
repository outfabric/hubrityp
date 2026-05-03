## 1. Database schema and migrations

- [x] 1.1 Add `psychologist_profiles` Drizzle table at `src/shared/db/schema/auth/psychologist-profiles.ts` with columns for `user_id` (PK FK → `auth.users.id`), `full_name`, `crp_number`, `crp_uf`, `status` (CHECK in the five allowed values), `terms_accepted_at`, `privacy_accepted_at`, `sensitive_data_consent_at`, the three `*_version` strings, `status_changed_at`, `created_at`, `updated_at`. Wire it through `src/shared/db/schema/auth/tables.ts` and `src/shared/db/schema/index.ts`. [unit] [integration]
- [x] 1.2 Add `crp_validation_queue` Drizzle table at `src/shared/db/schema/auth/crp-validation-queue.ts` with `id`, `user_id`, `crp_number`, `crp_uf`, `status` (CHECK in `pending|approved|rejected`), `submitted_at`, `decided_at`, `decided_by`, `rejection_reason`. Add to barrels. [unit] [integration]
- [x] 1.3 Add UNIQUE constraint on `(crp_number, crp_uf)` to `psychologist_profiles` and document why it lives here (RN-01.02) in a comment. [integration]
- [x] 1.4 Add RLS policies: `psychologist_profiles` rows readable/writable only by their owning `user_id`; `crp_validation_queue` readable/writable only by the `service_role` (admin path is service-role for the MVP — see design.md Open Questions). Verify policies via integration tests. [integration]
- [x] 1.5 Add a Postgres `set_app_metadata(user_id uuid, status text)` SECURITY DEFINER function and an `AFTER UPDATE OF status` trigger on `psychologist_profiles` that calls it, mirroring `status` into `auth.users.raw_app_meta_data`. [integration]
- [x] 1.6 Generate and apply the Drizzle migration with `npm run db:migrate`; commit the generated SQL. Re-run `npm run db:migrate` against a fresh container to confirm idempotence. [integration]

## 2. Account-lifecycle module foundation

- [x] 2.1 Scaffold `src/modules/account-lifecycle/` with `lib/`, `server/`, `components/`, `index.ts` (empty barrel) following the existing `auth` module layout. [unit]
- [x] 2.2 Implement `lib/state-machine.ts` exporting `AccountStatus`, `TransitionEvent`, `TransitionResult` types and the pure `transitionStatus(current, event)` helper covering exactly the table in the spec (account-lifecycle Requirement: "transitionStatus helper is the single writer of status"). [unit]
- [x] 2.3 Add a Vitest unit test that grep-asserts `\.status\s*=` only appears in the state-machine module and its tests (CI guard against direct status writes). [unit]
- [x] 2.4 Implement `lib/document-versions.ts` exporting `documentVersions = { terms: '2026-05', privacy: '2026-05', sensitiveData: '2026-05' }` as `as const`, plus a typed accessor used by signup. [unit]
- [x] 2.5 Implement `server/get-account-status.ts` exposing `getAccountStatus(userId)` that reads the JWT app_metadata mirror first, falls back to a Drizzle query against `psychologist_profiles`, and emits the `status_mirror_drift` log when it falls back. [integration]
- [x] 2.6 Implement `server/transition.ts` exposing `applyTransition(userId, event)` that runs `transitionStatus`, persists the new status with a Drizzle UPDATE inside a transaction, and asserts the `status_changed_at` and `updated_at` columns advance. Returns the discriminated `TransitionResult`. [integration]
- [x] 2.7 Wire the public surface in `src/modules/account-lifecycle/index.ts` (re-export `transitionStatus`, `AccountStatus`, `TransitionEvent`, `getAccountStatus`, `applyTransition`, `documentVersions`). [unit]

## 3. CRP-validation module

- [x] 3.1 Scaffold `src/modules/crp-validation/` with `lib/`, `server/`, `index.ts`. [unit]
- [x] 3.2 Implement `lib/regional-codes.ts` with the constant mapping `01..24 → UF` from PRD 01 Apêndice A and the `regionalCodeToUf(code): UF | null` helper. Cover every code in a unit test. [unit]
- [x] 3.3 Implement `lib/crp-format.ts` exporting `crpNumberSchema` (regex + regional-code refinement against `regionalCodes`) and `crpUfSchema` (Zod enum of 27 UFs). Cover the spec's positive and negative scenarios. [unit]
- [x] 3.4 Implement `server/approve.ts` exposing `approveCrpValidation(queueId)` that, gated on a service-role caller, updates the queue row, emits `crp_approved` into `applyTransition`, and logs `crp_validation_decided`. Return a typed result (`forbidden`, `already_decided`, `invalid_transition`, `ok`). [integration]
- [x] 3.5 Implement `server/reject.ts` exposing `rejectCrpValidation(queueId, reason)` mirroring 3.4 but emitting `crp_rejected` and requiring a non-empty reason. [integration]
- [x] 3.6 Wire `src/modules/crp-validation/index.ts` to expose `crpNumberSchema`, `crpUfSchema`, `regionalCodeToUf`, `regionalCodes`, `approveCrpValidation`, `rejectCrpValidation`. [unit]

## 4. Signup Server Action and module surface

- [x] 4.1 Implement `src/modules/auth/lib/signup-input-schema.ts` with `signupInputSchema` covering every field in the spec (full name length, password complexity classes including special chars, confirmation match, three required `literal(true)` consents, delegated CRP/UF validation). Cover every spec scenario in unit tests. [unit]
- [x] 4.2 Implement `src/modules/auth/lib/post-login-redirect.ts` with `postLoginRedirect(status, requestedRedirect): string` returning the right destination per the modified `signIn` requirement. Cover all five status branches in unit tests. [unit]
- [x] 4.3 Implement `src/modules/auth/server/signup.ts` with `signUpImpl(formData): Promise<SignUpResult>`. Steps: parse with `signupInputSchema`; call Supabase Auth `signUp`; inside a Drizzle transaction insert `psychologist_profiles` (status `pending_verification`, three consent timestamps + versions from `documentVersions`) and `crp_validation_queue` (status `pending`); compensating-delete the Supabase user on rollback. Map known errors to `email_already_registered` / `crp_already_registered` / `validation_failed` / `unknown`. Never throw across the boundary. [integration]
- [x] 4.4 Implement `src/modules/auth/server/resend-verification.ts` with `resendVerificationEmailImpl()` enforcing the spec's auth + status + 3-in-5-min rate limit (track via a small `auth_resend_log` table or an in-memory KV — pick the cheapest implementation that satisfies the spec; document the choice in a code comment). [integration]
- [x] 4.5 Update `src/modules/auth/server/login.ts` so that after a successful Supabase signin it loads the profile, calls `postLoginRedirect` with the resolved status, and signs the user out for `suspended` / `cancelled`. Update existing scenarios and add the new ones from the modified spec. [integration]
- [x] 4.6 Update `src/modules/auth/index.ts` to additionally re-export `signUpImpl as signUp`, `resendVerificationEmailImpl as resendVerificationEmail`, `signupInputSchema`, `SignupForm`, `postLoginRedirect`, `SignUpResult`. [unit]

## 5. Signup form Client Component and route shell

- [x] 5.1 Build `src/modules/auth/components/signup-form.tsx` (Client Component) using React Hook Form + Zod resolver against `signupInputSchema`. Render every field with the `data-testid` names from the spec. Render server-side errors. Surface a per-consent error label when checkbox is unchecked. [unit] [e2e]
- [x] 5.2 Add the route shell `src/app/(auth)/signup/actions.ts` containing `'use server'; export { signUp } from '@/modules/auth';`. [integration]
- [x] 5.3 Add the route shell `src/app/(auth)/signup/page.tsx` as a Server Component that imports `<SignupForm/>` from `@/modules/auth` and composes the layout (mirroring `login/page.tsx`). [integration] [e2e]
- [x] 5.4 Update `src/modules/auth/components/login-form.tsx` to expose a "Criar conta" link to `/signup` so a user landing on `/login` can self-serve to signup. [unit] [e2e]

## 6. Bloqueante pages and email verification callback

- [x] 6.1 Build `src/modules/account-lifecycle/components/verify-email-page.tsx` rendering the user's email, a resend Server Action button (wired to `resendVerificationEmail` via the route shell), the 24h note, and a logout button. [unit] [e2e]
- [x] 6.2 Build `src/modules/account-lifecycle/components/crp-review-page.tsx` rendering the submitted CRP/UF, the 24h note, a contact email, and a logout button. [unit]
- [x] 6.3 Add route shell `src/app/(auth)/auth/verify-email/page.tsx` (Server Component reading the session, picking the email, redirecting active users to `/dashboard`) plus `src/app/(auth)/auth/verify-email/actions.ts` for the resend action. [integration] [e2e]
- [x] 6.4 Add route shell `src/app/(auth)/auth/crp-review/page.tsx` analogously. [integration]
- [x] 6.5 Implement `src/app/auth/callback/route.ts` (Route Handler) that exchanges the Supabase code, calls `applyTransition(userId, 'email_verified')`, treats `invalid_transition` as idempotent success, and routes invalid codes to `/login?reason=verification_failed`. [integration] [e2e]

## 7. Status-aware middleware

- [x] 7.1 Update `src/middleware.ts` (and any helper at `src/shared/supabase/middleware.ts`) to call `getAccountStatus` after the existing session refresh, then route per the modified middleware spec (active passes, pending_* redirects to bloqueante page, suspended/cancelled clears cookies + `/login?reason=`). Preserve the existing anonymous-redirect behavior for `/dashboard/*`. [integration] [e2e]
- [x] 7.2 Update middleware to bounce authenticated `/login` and `/signup` requests by status (active → `/dashboard`, pending_verification → `/auth/verify-email`, pending_crp_validation → `/auth/crp-review`, suspended/cancelled → cookie clear + `/login?reason=`). [integration] [e2e]
- [x] 7.3 Confirm the matcher does not accidentally gate `/auth/callback`, `/api/health`, or static assets. Add explicit "skip" tests. [integration]

## 8. Integration test fixtures and seeded e2e

- [x] 8.1 Add factories `seedPendingVerificationUser()`, `seedPendingCrpUser()`, `seedActiveUser()`, `seedSuspendedUser()`, `seedCancelledUser()` to `src/__tests__/integration/factories/users.ts`, all driving `applyTransition` rather than touching `status` directly. [integration]
- [x] 8.2 Update the seeded e2e Supabase bootstrap (`src/__tests__/e2e/_shared/postgres-container.ts` and the seeded e2e setup) to apply the new tables, RLS, and trigger so seeded e2e tests can rely on them. [e2e]
- [x] 8.3 Add a seeded e2e Playwright test covering the happy path: anonymous user signs up → lands on `/auth/verify-email` → callback advances status → middleware bounces to `/auth/crp-review` → admin Server Action approves → user can reach `/dashboard`. [e2e]
- [x] 8.4 Add a seeded e2e Playwright test for the duplicate-email and duplicate-CRP rejection paths (form shows the typed error, no DB rows appear, retry succeeds with a fresh email/CRP). [e2e]
- [x] 8.5 Add a seeded e2e Playwright test for the suspended-at-login flow (admin rejects CRP → user attempts `/login` with valid credentials → redirected to `/login?reason=suspended` and session is not established). [e2e]

## 9. Documentation

- [x] 9.1 Create `docs/account-lifecycle.md` covering purpose, paths, public surface (`transitionStatus`, `getAccountStatus`, `applyTransition`, bloqueante pages, `documentVersions`), invariants (state machine table, RLS, JWT mirror, three independent consent timestamps), tests by layer, and an empty change-history section. [integration]
- [x] 9.2 Create `docs/crp-validation.md` covering format validation, regional-codes table, manual queue, admin actions, RLS, RN-01.05 no-photo invariant, and the eventual upgrade path to automated CFP lookup. [integration]
- [x] 9.3 Update `docs/authentication.md` (or create it if absent) to reflect the new signup surface, password complexity, status-aware login redirect, and the resend-verification action. [integration]

## 10. Final validation

- [x] 10.1 Run `npm run check` (lint + format + typecheck) and confirm clean. [unit]
- [x] 10.2 Run the full Vitest suite (`npm run test:unit`), the integration suite (`npm run test:integration`), and the seeded e2e suite (`npm run test:e2e:seeded`). All green. [unit] [integration] [e2e]
- [x] 10.3 Run `openspec validate add-account-signup-and-lifecycle` and `openspec status --change add-account-signup-and-lifecycle` and confirm `isComplete: true`. [unit]
