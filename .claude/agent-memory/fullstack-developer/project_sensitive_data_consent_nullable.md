---
name: sensitive-data-consent-nullable
description: profiles.sensitive_data_consent_at was NOT NULL + trigger-required; onboarding wizard step-3 gate needed it nullable — relaxed in migration 0037
metadata:
  type: project
---

`profiles.sensitive_data_consent_at` was originally `NOT NULL` (migrations 0001/0003) AND the `handle_new_user` SECURITY DEFINER trigger RAISEs if the `sensitiveDataConsentAt` metadata field is missing on signup. So in production every profile always had a consent timestamp — the state `IS NULL` was unreachable.

The onboarding-wizard change (section 7, "Importe pacientes") gates CSV import on `sensitive_data_consent_at IS NULL` (RN-11.03), and its integration test must exercise that NULL path. To make the gate reachable and testable, migration `0037_relax_sensitive_data_consent_not_null.sql` drops the NOT NULL constraint and `src/shared/db/schema/auth/tables.ts` made the Drizzle column nullable (so `Profile.sensitiveDataConsentAt` is now `Date | null`).

**Why:** LGPD consent WITHDRAWAL is a real right — clearing consent sets the column back to NULL, which must block clinical-data ingestion. Signup is unchanged (trigger still requires the field), so fresh profiles still have a value.

**How to apply:** When reading `sensitiveDataConsentAt`, treat NULL as "no consent on record → block sensitive-data ingestion". The server gate lives in `importOnboardingPatientsImpl` (onboarding module). There is NOT YET a privacy-settings UI that sets it to NULL (the revoke flow is referenced but unbuilt) — quick-add via `createPatientImpl` is intentionally NOT consent-gated (single patient via the standard create path). See [[testcontainers-reuse-dirty-state]] for why registration int tests appeared to break during this work.
