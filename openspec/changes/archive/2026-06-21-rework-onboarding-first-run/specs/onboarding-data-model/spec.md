## MODIFIED Requirements

### Requirement: Profiles table carries onboarding and NPS state
The system SHALL extend the existing `profiles` table with additive columns to track onboarding progress and NPS: `onboarding_step` (text NOT NULL DEFAULT 'welcome'), `onboarding_completed_at` (timestamptz nullable), `first_access_at` (timestamptz nullable — set on the first authenticated onboarding-wizard render, used to compute the day-7 NPS trigger), `reactivated_at` (timestamptz nullable — set when a cancelled account is reactivated, drives the welcome-back path), `nps_score` (integer nullable, CHECK between 0 and 10), `nps_feedback` (text nullable), `nps_responded_at` (timestamptz nullable). The `tour_completed_at` column is REMOVED (the guided tour no longer exists). All remaining columns are additive and do not alter existing `profiles` behavior or its RLS policies; the drop of `tour_completed_at` does not touch any RLS policy (no policy references it).

#### Scenario: Existing profile rows get defaults after migration
- **WHEN** the migration is applied to a database with existing `profiles` rows
- **THEN** every existing row has `onboarding_step = 'welcome'` and `NULL` for `onboarding_completed_at`, `first_access_at`, `reactivated_at`, `nps_score`, `nps_feedback`, `nps_responded_at`

#### Scenario: The tour_completed_at column no longer exists
- **WHEN** the schema is inspected after this change's migration
- **THEN** the `profiles` table has no `tour_completed_at` column, and `getCurrentProfileEdge` no longer selects or maps it

#### Scenario: NPS score outside 0–10 is rejected
- **WHEN** an UPDATE sets `nps_score = 11`
- **THEN** the database rejects the write with a CHECK constraint violation

#### Scenario: Existing profiles RLS still scopes to the owner
- **WHEN** user B reads a `profiles` row owned by user A through the RLS-scoped client
- **THEN** the query returns zero rows, exactly as before this change
