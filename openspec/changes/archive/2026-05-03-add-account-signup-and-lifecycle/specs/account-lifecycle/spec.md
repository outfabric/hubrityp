## ADDED Requirements

### Requirement: `psychologist_profiles` table stores account profile and status

The system SHALL persist each psychologist's profile in a `psychologist_profiles` table keyed by Supabase Auth `user_id`. The table MUST hold full name, CRP number, CRP UF, account status, three LGPD consent timestamps with their document version strings, and bookkeeping (`created_at`, `updated_at`, `status_changed_at`). RLS MUST restrict each row to its owning `user_id`.

#### Scenario: Profile is created at signup

- **WHEN** a Server Action successfully creates a Supabase Auth user via the `signUp` flow
- **THEN** a row is inserted in `psychologist_profiles` with `user_id` matching the new Supabase user, `status='pending_verification'`, `status_changed_at=NOW()`, and the three `*_accepted_at`/`*_version` columns populated from the submitted form

#### Scenario: RLS blocks reads of other users' profiles

- **GIVEN** users A and B each have a `psychologist_profiles` row
- **WHEN** user A queries `select * from psychologist_profiles` with their session
- **THEN** the result contains only A's row; B's row is invisible

#### Scenario: `updated_at` and `status_changed_at` track distinct events

- **WHEN** a profile's `full_name` is updated
- **THEN** `updated_at` advances but `status_changed_at` does not change
- **WHEN** the profile's `status` transitions (via the helper)
- **THEN** both `updated_at` and `status_changed_at` advance to `NOW()`

### Requirement: Account status is one of a fixed set of values

The system SHALL constrain `psychologist_profiles.status` to one of `pending_verification`, `pending_crp_validation`, `active`, `suspended`, `cancelled` via a CHECK constraint. Inserting or updating to any other value MUST fail at the database level.

#### Scenario: Invalid status is rejected by the database

- **WHEN** an UPDATE sets `status='banana'`
- **THEN** Postgres returns a CHECK constraint violation and the row is unchanged

### Requirement: `transitionStatus` helper is the single writer of `status`

The system SHALL expose a typed helper `transitionStatus(currentStatus, event)` in `src/modules/account-lifecycle/lib/state-machine.ts` that returns the new status for valid `(currentStatus, event)` pairs and a typed error result for invalid pairs. All code paths that change `status` (Server Actions, Route Handlers, admin actions, background jobs) MUST go through this helper. Direct UPDATE statements against `status` outside the helper MUST be rejected at code review (and a unit test SHALL grep the codebase to enforce this).

The allowed transitions are:

| From | Event | To |
|---|---|---|
| `pending_verification` | `email_verified` | `pending_crp_validation` |
| `pending_crp_validation` | `crp_approved` | `active` |
| `pending_crp_validation` | `crp_rejected` | `suspended` |
| `active` | `admin_suspend` | `suspended` |
| `active` | `user_cancel` | `cancelled` |
| `suspended` | `admin_reinstate` | `active` |

Any other `(from, event)` pair MUST return `{ ok: false, error: 'invalid_transition' }`.

#### Scenario: Valid transition succeeds

- **WHEN** `transitionStatus('pending_verification', 'email_verified')` is called
- **THEN** the result is `{ ok: true, status: 'pending_crp_validation' }`

#### Scenario: Invalid transition is rejected

- **WHEN** `transitionStatus('cancelled', 'email_verified')` is called
- **THEN** the result is `{ ok: false, error: 'invalid_transition' }` and no DB call is made

#### Scenario: Helper persists the new status atomically

- **GIVEN** a profile in status `pending_crp_validation`
- **WHEN** the helper is invoked with event `crp_approved` for that user
- **THEN** the profile row's `status` becomes `active`, `status_changed_at` advances, and the JWT app_metadata mirror reflects the new status by the end of the same transaction

#### Scenario: Codebase has no direct `status` writes outside the helper

- **WHEN** a unit test greps `src/` for `\.status\s*=` (excluding the state-machine module and its tests)
- **THEN** the result is empty

### Requirement: Three LGPD consents are captured as separate timestamped records

The system SHALL record three independent consent timestamps at signup: `terms_accepted_at`, `privacy_accepted_at`, `sensitive_data_consent_at`. Each MUST be paired with a document version string (`terms_version`, `privacy_version`, `sensitive_data_consent_version`) sourced from `src/modules/account-lifecycle/lib/document-versions.ts`. All six fields MUST be NOT NULL — signup without all three consents MUST fail before any DB write.

#### Scenario: All three consents are persisted at signup

- **WHEN** a signup completes successfully
- **THEN** the inserted profile row has non-null values in all of `terms_accepted_at`, `privacy_accepted_at`, `sensitive_data_consent_at`, and the three matching `_version` columns
- **AND** the three timestamps are within 1 second of each other (set in the same transaction)

#### Scenario: Missing consent rejects signup

- **WHEN** the `signUp` Server Action receives form input where `sensitive_data_consent=false`
- **THEN** the action returns `{ ok: false, error: 'validation_failed', fieldErrors: { sensitive_data_consent: <message> } }` and no DB row is created

### Requirement: Status drives access to authenticated areas

The system SHALL provide a `getAccountStatus(userId)` helper in the `account-lifecycle` module that the root middleware calls for every authenticated request to a route under `(app)/`. The helper MUST return the status from the JWT app_metadata mirror when its `iat` is newer than `status_changed_at`, and fall back to a DB read otherwise. The middleware MUST then route as follows:

| Status | Authenticated request to `(app)/*` |
|---|---|
| `active` | passes through |
| `pending_verification` | redirects to `/auth/verify-email` (HTTP 307) |
| `pending_crp_validation` | redirects to `/auth/crp-review` (HTTP 307) |
| `suspended` | clears session cookies and redirects to `/login?reason=suspended` |
| `cancelled` | clears session cookies and redirects to `/login?reason=cancelled` |

#### Scenario: Active user reaches dashboard

- **GIVEN** an authenticated user with `status='active'`
- **WHEN** they request `/dashboard`
- **THEN** the middleware lets the request through and the dashboard renders

#### Scenario: Pending-verification user is redirected to the email page

- **GIVEN** an authenticated user with `status='pending_verification'`
- **WHEN** they request `/dashboard/patients`
- **THEN** the middleware returns HTTP 307 to `/auth/verify-email`

#### Scenario: Pending-CRP user is redirected to the review page

- **GIVEN** an authenticated user with `status='pending_crp_validation'`
- **WHEN** they request `/dashboard`
- **THEN** the middleware returns HTTP 307 to `/auth/crp-review`

#### Scenario: Suspended user is signed out

- **GIVEN** an authenticated user whose status was just changed to `suspended`
- **WHEN** they request any `(app)/*` route
- **THEN** the middleware clears the Supabase session cookies and returns HTTP 307 to `/login?reason=suspended`

#### Scenario: JWT mirror short-circuits the DB

- **GIVEN** an authenticated user with `status='active'` and a JWT issued after `status_changed_at`
- **WHEN** the middleware processes the request
- **THEN** `getAccountStatus` reads status from the JWT app_metadata mirror without querying `psychologist_profiles`

#### Scenario: Stale JWT triggers DB fallback

- **GIVEN** a JWT issued before the user's most recent `status_changed_at`
- **WHEN** the middleware processes the request
- **THEN** `getAccountStatus` queries `psychologist_profiles`, returns the fresh status, and emits a `status_mirror_drift` log warning

### Requirement: `/auth/verify-email` is the bloqueante page for `pending_verification`

The system SHALL provide a `/auth/verify-email` route under the `(auth)` route group that any authenticated `pending_verification` user can reach. The page MUST display:

- The email address the verification link was sent to
- A "Resend verification email" Server Action button
- A note that the link is valid for 24 hours
- A logout button

The page MUST NOT expose any other product navigation.

#### Scenario: Page renders for pending-verification users

- **GIVEN** an authenticated user with `status='pending_verification'` and email `psi@example.com`
- **WHEN** they reach `/auth/verify-email`
- **THEN** the page shows `psi@example.com`, a resend button, and a logout button

#### Scenario: Resend rate is bounded

- **WHEN** the user clicks the resend button more than 3 times in 5 minutes
- **THEN** the action returns `{ ok: false, error: 'rate_limited' }` and the UI shows "Aguarde alguns minutos antes de pedir novamente"

#### Scenario: Active user is redirected away from the verify-email page

- **GIVEN** an authenticated user with `status='active'`
- **WHEN** they request `/auth/verify-email`
- **THEN** the middleware (or the page server component) redirects them to `/dashboard`

### Requirement: `/auth/crp-review` is the bloqueante page for `pending_crp_validation`

The system SHALL provide a `/auth/crp-review` route under the `(auth)` route group displayed to authenticated users in `pending_crp_validation`. The page MUST display:

- The submitted CRP number and UF
- A note that manual validation can take up to 24 hours
- A contact email for follow-up
- A logout button

#### Scenario: Page renders for pending-CRP users

- **GIVEN** an authenticated user with `status='pending_crp_validation'`, CRP `06/123456`
- **WHEN** they reach `/auth/crp-review`
- **THEN** the page shows the CRP number, the UF "SP", and a logout button

#### Scenario: Active user bypasses the CRP review page

- **GIVEN** an authenticated user with `status='active'`
- **WHEN** they request `/auth/crp-review`
- **THEN** they are redirected to `/dashboard`

### Requirement: `/auth/callback` advances status when the email link is consumed

The system SHALL provide a `/auth/callback` Route Handler that exchanges a Supabase verification `code` for a session, then transitions the account from `pending_verification` to `pending_crp_validation` via `transitionStatus`. On success, it MUST redirect to `/dashboard` (which the middleware will then bounce to `/auth/crp-review`).

#### Scenario: Successful verification advances status

- **WHEN** Supabase redirects the user to `/auth/callback?code=<valid>` after they click the verification link
- **THEN** the handler establishes the session, calls `transitionStatus(currentStatus, 'email_verified')`, and the profile row's status is `pending_crp_validation`

#### Scenario: Already-verified user does not regress

- **GIVEN** a user already in `pending_crp_validation` (or beyond)
- **WHEN** they click the verification link a second time
- **THEN** the handler establishes the session, the `transitionStatus` call returns `{ ok: false, error: 'invalid_transition' }`, the handler treats this as success (idempotent), and redirects to `/dashboard` without changing status

#### Scenario: Invalid or expired code surfaces an error

- **WHEN** the callback is hit with an invalid or expired `code`
- **THEN** the handler redirects to `/login?reason=verification_failed` and does not establish a session

### Requirement: `account-lifecycle` module exposes its surface via a barrel

The system SHALL place the account-lifecycle code at `src/modules/account-lifecycle/` with an `index.ts` barrel that re-exports the public API. Consumers MUST import from `@/modules/account-lifecycle`, never from internal paths.

The public surface MUST include:

- `transitionStatus`, `AccountStatus`, `TransitionEvent`, `TransitionResult` (from `lib/state-machine.ts`)
- `getAccountStatus` (from `server/get-account-status.ts`)
- `documentVersions` (from `lib/document-versions.ts`)
- `VerifyEmailPage`, `CrpReviewPage` Client/Server Components (from `components/`)
- `resendVerificationEmail` Server Action implementation (from `server/resend-verification.ts`)

#### Scenario: Module exposes the documented public API

- **WHEN** any code outside `src/modules/account-lifecycle/` needs `transitionStatus`, `getAccountStatus`, `VerifyEmailPage`, `CrpReviewPage`, `resendVerificationEmail`, or `documentVersions`
- **THEN** it imports from `@/modules/account-lifecycle`; no consumer imports from `@/modules/account-lifecycle/lib/*` or `@/modules/account-lifecycle/server/*` directly

#### Scenario: Server-only chain is not dragged into client bundles

- **WHEN** a Client Component imports from `@/modules/account-lifecycle`
- **THEN** the build does not pull `server-only` modules into the browser bundle (because Server Action and DB-touching exports are consumed via route shells, mirroring the pattern in `authentication`)
