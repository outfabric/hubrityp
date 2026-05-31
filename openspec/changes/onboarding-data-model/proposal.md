## Why

PRD 11 (Onboarding e Dashboard) introduces persistent state that does not yet
exist in the schema: where each psychologist is in the onboarding flow, which
first-steps checklist items are done, their NPS answer, and their notification
preferences. The existing `notifications` table only covers in-app notification
rows; it has no companion preferences table, and the `profiles` table has no
onboarding/NPS columns. This change lays the **data foundation** that the
wizard, dashboard, checklist, tour, and notification changes all build on, so
those later changes never have to touch the schema again.

This change is backend-only (schema + RLS + Zod + read helpers). It ships no UI.

## What Changes

- Add onboarding/NPS columns to the existing `profiles` table: `onboarding_step`,
  `onboarding_completed_at`, `tour_completed_at`, `nps_score`, `nps_feedback`,
  `nps_responded_at`, `first_access_at` (used to compute the day-7 NPS trigger),
  `reactivated_at` (welcome-back path for cancelled→reactivated accounts).
- New `onboarding_checklist` table (one row per psychologist) tracking the MVP
  checklist booleans + the optional "AI transcription tried" bonus item.
- New `notification_preferences` table (one row per psychologist) for in-app /
  email notification toggles, with a non-disableable `email_critical` flag.
- RLS enabled with explicit per-operation policies on both new tables, scoped by
  `user_id = auth.uid()`. **Non-negotiable security requirement** — a table
  without RLS + per-operation policies is a bug, not debt.
- Zod schemas + branded types (`OnboardingStep`, `NpsScore`) and pure read
  helpers exposed via the `onboarding` module barrel for downstream changes.

## Capabilities

### New Capabilities
- `onboarding-data-model`: schema, RLS policies, branded types, Zod validators
  and read helpers for onboarding progress, the first-steps checklist, NPS
  answers, and notification preferences.

### Modified Capabilities
<!-- No existing capability's REQUIREMENTS change. The profiles columns are
     additive and the authentication spec's behavior is unchanged. -->

## Impact

- **Schema**: `src/shared/db/schema/auth/tables.ts` (profiles columns — additive),
  a new `src/shared/db/schema/onboarding/` domain folder (`tables.ts`,
  `policies.ts`, `index.ts`), and `src/shared/db/schema/index.ts` re-export.
- **Module**: new `src/modules/onboarding/` with `lib/` (schemas, branded types)
  and `server/` (read helpers), plus `index.ts` barrel.
- **Migrations**: one new drizzle-kit migration carrying RLS + policies + FKs +
  indexes. Reversible (additive columns + new tables; no data destruction).
- **No** middleware, route, or client-bundle impact in this change.
- **LGPD**: `nps_feedback` is free text and may contain incidental PII; it is
  owner-scoped via RLS and MUST never be logged. No clinical content stored.
