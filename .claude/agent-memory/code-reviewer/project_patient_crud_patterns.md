---
name: Patient CRUD domain patterns
description: Architecture decisions and patterns established in the patient-crud-core change (2026-05). Covers schema, Server Actions, RLS, form wizard, and test structure for the patients module.
type: project
---

The patient module follows these patterns (established in feature/patient-crud-core):

**Schema:**
- Table `patients` with `user_id` FK to `auth.users` (cross-schema, ON DELETE CASCADE)
- RLS enabled with 4 canonical policies: owner can SELECT/INSERT/UPDATE/DELETE via `auth.uid() = user_id`
- Partial unique index on `(user_id, email) WHERE email IS NOT NULL`
- GIN index on `to_tsvector('portuguese', full_name)` for full-text search
- Compound index on `(user_id, status)` for default listing query
- NOTE: No unique constraint on (user_id, phone) -- flagged in review-1, should be added

**Server Actions pattern:**
- Thin route shells in `src/app/(app)/pacientes/actions.ts` and `[id]/actions.ts` with `'use server'` directive
- Delegate to `*Impl()` functions in `src/modules/patients/server/` which accept a SupabaseClient parameter
- Impl functions do: auth check -> Zod validation -> ownership verification -> business logic -> Drizzle query
- Result type is always a discriminated union: `{ ok: true; ... } | { ok: false; error: string; ... }`

**Frontend pattern:**
- Pages are Server Components; interactive parts are `'use client'` leaf components
- `PatientListLoader` is a thin client boundary wrapper to pass server actions as props
- 2-step form wizard with separate Zod schemas per step (client-side) + unified schema on server
- BR input masks for phone (+55 DD NNNNN-NNNN) and CPF (XXX.XXX.XXX-XX)

**Why:** This module is the first major domain entity after auth/registration. Its patterns will be replicated for sessions, anamnesis, prescriptions, billing, etc.

**How to apply:** When reviewing future domain modules, compare against these patterns. Flag deviations. Watch for the phone unique constraint fix (should be added as follow-up).
