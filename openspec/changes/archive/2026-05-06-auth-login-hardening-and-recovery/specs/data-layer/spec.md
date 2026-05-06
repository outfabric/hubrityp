## ADDED Requirements

### Requirement: `profiles` is extended with lockout and password-reset state columns

The system SHALL extend the `profiles` table (introduced in `auth-account-creation`) with five additional columns:

- `failed_login_count INT NOT NULL DEFAULT 0`.
- `last_failed_login_at TIMESTAMPTZ`.
- `lockout_until TIMESTAMPTZ`.
- `consecutive_lockouts INT NOT NULL DEFAULT 0`.
- `requires_password_reset BOOLEAN NOT NULL DEFAULT false`.

The migration MUST add a partial index `CREATE INDEX profiles_lockout_until_idx ON profiles (lockout_until) WHERE lockout_until IS NOT NULL` so the "is this user currently locked out?" check at login time is cheap. Existing RLS policies (`profiles_select_own`, `profiles_update_own`) extend to the new columns by inheritance — no new policy needed. The Drizzle schema in `src/shared/db/schema/auth/tables.ts` MUST be updated to include the new fields with matching TypeScript types.

#### Scenario: Lockout columns are persisted and queryable

- **WHEN** a contributor inspects the `profiles` table after `npm run db:migrate`
- **THEN** the table contains `failed_login_count`, `last_failed_login_at`, `lockout_until`, `consecutive_lockouts`, `requires_password_reset` with the documented defaults and types, and the partial index `profiles_lockout_until_idx` exists

#### Scenario: Atomic increment SQL works under concurrency

- **GIVEN** two concurrent transactions executing the documented atomic UPDATE on the same `user_id` with `failed_login_count = 4`
- **WHEN** both UPDATEs commit
- **THEN** Postgres serialises them; the post-state is `failed_login_count = 5` (not 6) on the row that was first to commit, and the second commit either sees `failed_login_count = 5` (if it ran after the first) or applies its own increment ending at `failed_login_count = 5` as well — the test SHALL assert that exactly one of the two commits set `lockout_until` to a future time

#### Scenario: User can read but not directly write lockout columns

- **WHEN** a user with JWT claims `sub = userA` issues `UPDATE profiles SET failed_login_count = 0 WHERE user_id = userA`
- **THEN** the policy `profiles_update_own` allows the UPDATE statement, but application code MUST keep all lockout state mutations inside the `signIn` Server Action (this is an enforced invariant in code, not at DB level — out of scope to enforce via column-level RLS in this change)

### Requirement: `oauth_identities` table tracks linked OAuth identities

The system SHALL define `oauth_identities` in `src/shared/db/schema/auth/tables.ts` with the following columns:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`.
- `provider TEXT NOT NULL` (`'google'` for now; constrained by application code, not DB enum, to keep room for future providers).
- `provider_user_id TEXT NOT NULL`.
- `is_primary BOOLEAN NOT NULL DEFAULT false`.
- `linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- `UNIQUE (provider, provider_user_id)`.
- Index on `user_id` for "list my linked providers" queries.

RLS MUST be enabled. The only policy SHALL be `oauth_identities_select_own` (`user_id = auth.uid()`). All writes MUST go through service-role server code (no INSERT/UPDATE/DELETE policy for end-users).

#### Scenario: Schema barrel re-exports oauthIdentities

- **WHEN** any file imports from `@/shared/db/schema`
- **THEN** the named exports include `oauthIdentities`

#### Scenario: User reads their own linked identities

- **GIVEN** an `oauth_identities` row with `user_id = userA`
- **WHEN** a query is executed with the JWT claims set to `sub = userA`
- **THEN** the row is returned

#### Scenario: User cannot read another user's linked identities

- **GIVEN** an `oauth_identities` row with `user_id = userA`
- **WHEN** a query is executed with the JWT claims set to `sub = userB`
- **THEN** the row is not returned (zero rows)

#### Scenario: Direct INSERT is blocked for end-users

- **WHEN** a query is executed with the JWT claims set to `sub = userA` attempting `INSERT INTO oauth_identities (user_id, provider, provider_user_id) VALUES (userA, 'google', 'foo')`
- **THEN** the INSERT is rejected because no INSERT policy exists for end-users

#### Scenario: Service-role client can insert and read all rows

- **WHEN** queries are executed via the service-role client
- **THEN** SELECT returns all rows, INSERT/UPDATE/DELETE succeed (RLS bypassed)

#### Scenario: `(provider, provider_user_id)` uniqueness is enforced

- **WHEN** a second INSERT attempts to register the same `(provider, provider_user_id)` pair under a different `user_id`
- **THEN** Postgres raises a unique-constraint violation that the calling Server Action maps to `duplicate_oauth_identity`

### Requirement: `purge_old_auth_logs` function deletes records older than 6 months

The system SHALL declare a SECURITY DEFINER SQL function `public.purge_old_auth_logs()` that deletes rows from `auth_logs` where `created_at < NOW() - INTERVAL '6 months'` and returns the count of deleted rows. The function MUST be callable by the service-role client. Scheduling the function (via Inngest, `pg_cron`, or Vercel Cron) is OUT OF SCOPE for this change but MUST be documented as a TODO in the migration README and tracked for the housekeeping change.

#### Scenario: Function deletes only logs older than 6 months

- **GIVEN** `auth_logs` contains 10 rows with `created_at = NOW() - INTERVAL '7 months'` and 5 rows with `created_at = NOW() - INTERVAL '1 month'`
- **WHEN** the service-role client calls `SELECT purge_old_auth_logs()`
- **THEN** the function returns `10`, the table contains only the 5 recent rows, and `auth_logs_select_own` policy still applies for end-users

#### Scenario: Function handles empty table gracefully

- **WHEN** the service-role client calls `SELECT purge_old_auth_logs()` on an empty `auth_logs` table
- **THEN** the function returns `0` without error

#### Scenario: Function is not callable by end-users

- **WHEN** a query is executed with the JWT claims set to `sub = userA` attempting `SELECT purge_old_auth_logs()`
- **THEN** the call is rejected (function is owned by the service-role/postgres user; SECURITY DEFINER does not grant EXECUTE to `anon` or `authenticated` roles)

### Requirement: New auth_logs events are documented

The system SHALL document the canonical set of `auth_logs.event` values in `src/shared/db/migrations/README.md` (a comment block listing every value the application emits). After this change the canonical set MUST include: `signup_success`, `signup_failure_duplicate_email`, `signup_failure_duplicate_crp`, `email_verified`, `login_success`, `login_failure`, `lockout_started`, `lockout_consecutive_threshold_reached`, `password_reset_requested`, `password_reset_completed`, `oauth_signup`, `social_linked`, `logout`. The set MAY grow in future changes without a schema change (column is `TEXT`).

#### Scenario: README lists the canonical set

- **WHEN** a contributor reads `src/shared/db/migrations/README.md`
- **THEN** the file contains a comment block listing every documented event with a one-line description

#### Scenario: Tests assert the application emits only documented events

- **WHEN** the integration suite runs
- **THEN** a sentinel test scans the codebase for string literals passed as the `event` argument to the auth-log helper and asserts each one is in the documented canonical set

## MODIFIED Requirements

### Requirement: Database trigger creates `profiles` row on `auth.users` insert

The system SHALL provide a SECURITY DEFINER function `public.handle_new_user()` and an `AFTER INSERT` trigger on `auth.users` that materializes a row in `public.profiles` for traditional email signups, and that performs no insert for OAuth-provider signups (so the OAuth flow can populate the profile via the `completeOAuthProfile` Server Action after collecting CRP/UF/aceites).

The function MUST branch on `NEW.raw_app_meta_data ->> 'provider'`:

- When the provider is `'email'` (or `raw_app_meta_data ->> 'provider'` is NULL and `raw_user_meta_data` carries the expected fields), the function MUST read `raw_user_meta_data` to populate `fullName`, `crpNumber`, `crpUf`, `termsAcceptedAt`, `privacyAcceptedAt`, `sensitiveDataConsentAt`, set `status = 'pending_verification'`, set `email = NEW.email`, and INSERT into `profiles`. If required metadata is missing, the function MUST raise an exception so the entire signup transaction rolls back.
- When the provider is anything else (`'google'`, future OAuth providers), the function MUST NOT INSERT into `profiles` and MUST `RETURN NEW` so the `auth.users` row is created without a paired profile (the `completeOAuthProfile` Server Action takes over).

The function MUST run with `STRICT` ownership and write only to `profiles` (no other tables). The migration MUST commit the function with a stable owner so SECURITY DEFINER cannot be exploited by ownership flips.

#### Scenario: Email signup via Supabase Auth produces a profile row

- **WHEN** `supabase.auth.signUp({ email, password, options: { data: { fullName, crpNumber, crpUf, ... } } })` succeeds and `auth.users.raw_app_meta_data->>'provider' = 'email'`
- **THEN** within the same transaction, `profiles` contains a row keyed by the new `auth.users.id` with the metadata fields populated and `status = 'pending_verification'`

#### Scenario: Email signup with missing metadata fails the transaction

- **WHEN** `supabase.auth.signUp` is called with an email payload but without the required metadata (e.g., `crpNumber` absent)
- **THEN** the trigger raises an exception, the entire transaction rolls back, and `auth.users` does not retain the partial signup

#### Scenario: Google OAuth signup leaves `profiles` empty for the new user

- **WHEN** a user completes the Google OAuth flow for the first time and Supabase inserts an `auth.users` row with `raw_app_meta_data->>'provider' = 'google'`
- **THEN** the trigger does NOT INSERT into `profiles`; the `auth.users` row exists but has no paired profile until `completeOAuthProfile` runs

#### Scenario: Trigger fails on duplicate CRP for email signups

- **WHEN** an email signup attempts an INSERT that violates `UNIQUE (crp_number, crp_uf)`
- **THEN** the unique-constraint error propagates back to the Server Action so it can roll back the auth user via `supabase.auth.admin.deleteUser`

#### Scenario: Trigger does not regress for the email path on missing provider metadata

- **GIVEN** `raw_app_meta_data->>'provider'` is NULL but `raw_user_meta_data` carries the expected email-signup fields
- **WHEN** the trigger fires
- **THEN** the function applies the email-path INSERT (provider NULL is treated as email) and the existing email-signup integration tests continue to pass
