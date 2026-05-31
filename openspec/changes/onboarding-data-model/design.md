## Context

PRD 11 needs persistent state across five concerns (wizard, dashboard,
checklist, tour, notifications/NPS). Rather than scatter schema changes across
each feature change, this change centralizes the data model so later changes
are pure feature work. It must respect every CLAUDE.md convention:
schema-per-domain with RLS + per-operation policies in the same PR, the
`@/shared/env` funnel, `shared/` never importing from `modules/`, and module
public APIs through barrels.

## Goals / Non-Goals

**Goals**
- Additive `profiles` columns + two new owner-scoped tables.
- RLS + per-operation policies + indexes in the same migration.
- Branded types + Zod validators + read helpers as the stable surface.

**Non-Goals**
- No UI, no Server Action mutations (later changes own those).
- No middleware change (this introduces no new route).
- Reusing the existing `notifications` table as-is — it already exists; this
  change does NOT modify it (only adds the companion preferences table).

## Decisions

### Decision: New `onboarding` schema domain instead of folding into `auth`
The checklist and preferences tables are conceptually onboarding/engagement
state, not authentication state. A dedicated `src/shared/db/schema/onboarding/`
domain keeps `auth/` focused and matches the schema-per-domain convention. The
`profiles` columns stay in `auth/tables.ts` because they extend an existing
auth-owned table (adding a parallel table just for 8 nullable columns would be
over-modeling — YAGNI).

### Decision: `user_id` references `auth.users`, FK emitted manually in migration
Following the established repo pattern (`patients.user_id`,
`notifications.user_id`), the cross-schema FK to `auth.users(id)` is written by
hand in the generated migration — drizzle-kit cannot express the cross-schema
reference. RLS uses `auth.uid() = user_id`.

### Decision: No DELETE policy on the new tables
Each user has exactly one checklist row and one preferences row for the life of
the account. They are created lazily (upsert) and updated in place; there is no
user-facing delete. Omitting the DELETE policy is the least-privilege choice and
avoids an accidental data-loss path. Account deletion cascades are handled by
the account-lifecycle flow, not by these tables' RLS.

### Decision: `nps_feedback` is free text, owner-scoped, never logged
NPS feedback can contain incidental PII. It lives behind RLS (owner-only) and is
explicitly excluded from logs by the later notification/NPS change. No clinical
content is ever stored here.

### Decision: `NpsScore` as a branded type
`nps_score` is a constrained integer (0–10). A branded `NpsScore` prevents
accidental assignment of an arbitrary number and makes the day-7 detractor
logic (`score <= 6`) explicit at the type level downstream.

## Risks / Trade-offs

- **Risk:** adding columns to a hot table (`profiles`). *Mitigation:* all columns
  are nullable or have constant defaults, so the migration is metadata-only on
  Postgres 15 (no full table rewrite).
- **Trade-off:** lazy upsert of checklist/preferences rows means downstream code
  must handle a `null` first read. Accepted — it avoids a backfill migration and
  a signup-trigger change in this scope.

## Migration Plan

1. `npm run db:generate` after defining tables/columns.
2. Hand-edit the migration to add: profiles columns + CHECK on `nps_score`, the
   two new tables, RLS ENABLE + per-operation policies, manual cross-schema FKs
   to `auth.users(id)`, UNIQUE on `user_id`, and indexes.
3. `npm run db:migrate` locally, then the integration test validates RLS,
   constraints, and indexes against real Postgres (Testcontainers).
4. Reversible: down path drops the two tables and the added columns; no user
   data is destroyed because the tables are new and the columns are additive.

## Open Questions

- None blocking. Assumption documented in proposal: `first_access_at` is set by
  the dashboard change on first render; this change only provides the column.
