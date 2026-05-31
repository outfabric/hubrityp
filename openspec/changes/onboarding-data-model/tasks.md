# Tasks — onboarding-data-model

> Ordering rule (per project standard): each automated test is written
> immediately after the code change that motivates it, so the implementer keeps
> the change's context while writing its test. Code → its test → next code.

## 1. Branded types + Zod validators (pure logic)

- [x] 1.1 Create `src/modules/onboarding/lib/branded.ts` — branded type `NpsScore` (integer 0–10) with a smart constructor `toNpsScore(n: number): NpsScore` that throws on out-of-range/non-integer. Add `OnboardingStep` union type `'welcome' | 'profile' | 'location' | 'patients' | 'done'`
- [x] 1.2 Create `src/modules/onboarding/lib/schemas.ts` — Zod schemas: `onboardingStepSchema` (z.enum of the OnboardingStep values), `npsAnswerSchema` (`{ score: z.number().int().min(0).max(10), feedback: z.string().max(2000).optional() }`), `notificationPreferencesSchema` (`{ emailDaily, emailWeekly, emailCritical, inAppSound }` booleans). Derive types via `z.infer`
- [x] 1.3 **Unit test:** `src/__tests__/unit/modules/onboarding/lib/branded.test.ts` — `toNpsScore` accepts 0 and 10, rejects -1, 11, and 5.5
- [x] 1.4 **Unit test:** `src/__tests__/unit/modules/onboarding/lib/schemas.test.ts` — `npsAnswerSchema` accepts `{score:9, feedback:'x'}` and `{score:0}`, rejects `{score:12}` and feedback >2000 chars; `onboardingStepSchema` rejects `'billing'`; `notificationPreferencesSchema` rejects non-boolean

## 2. Profiles columns (schema)

- [x] 2.1 Extend `src/shared/db/schema/auth/tables.ts` — add columns to `profiles`: `onboardingStep` (text NOT NULL default 'welcome'), `onboardingCompletedAt`, `tourCompletedAt`, `firstAccessAt`, `reactivatedAt` (all timestamptz nullable), `npsScore` (integer nullable), `npsFeedback` (text nullable), `npsRespondedAt` (timestamptz nullable). Update the inferred `Profile` type comment

## 3. Onboarding schema domain (tables + RLS + barrel)

- [x] 3.1 Create `src/shared/db/schema/onboarding/tables.ts` — `onboarding_checklist` (id uuid PK, user_id uuid NOT NULL UNIQUE, six MVP booleans DEFAULT FALSE, ai_transcription_tried boolean DEFAULT FALSE, updated_at timestamptz DEFAULT now()) and `notification_preferences` (id uuid PK, user_id uuid NOT NULL UNIQUE, email_daily/email_weekly/email_critical/in_app_sound booleans DEFAULT TRUE, updated_at timestamptz DEFAULT now()). Add a schema comment documenting that `email_critical` is non-disableable
- [x] 3.2 Create `src/shared/db/schema/onboarding/policies.ts` — RLS: ENABLE on both tables; per-operation policies SELECT/INSERT/UPDATE scoped by `auth.uid() = user_id` with WITH CHECK on INSERT/UPDATE; NO DELETE policy. Follow `src/shared/db/schema/notifications/policies.ts` style. No `USING (true)`
- [x] 3.3 Create `src/shared/db/schema/onboarding/index.ts` — barrel re-exporting tables, inferred types, and policies
- [x] 3.4 Update `src/shared/db/schema/index.ts` — add re-export of `./onboarding`
- [x] 3.5 Run `npm run db:generate`; hand-edit the migration to add: profiles columns + CHECK (`nps_score` BETWEEN 0 AND 10), the two tables, RLS ENABLE + policies, manual cross-schema FKs to `auth.users(id)`, UNIQUE on `user_id`, indexes on `user_id`
- [x] 3.6 Apply locally with `npm run db:migrate`
- [x] 3.7 **Integration test:** `src/__tests__/integration/onboarding/data-model.int.test.ts` — verify: profiles new columns exist with correct defaults; `nps_score = 11` rejected by CHECK; both new tables exist with RLS enabled; UNIQUE on `user_id` enforced (duplicate insert rejected); all item booleans default correctly; cross-user RLS — user B cannot SELECT/UPDATE user A's checklist or preferences rows; no DELETE policy grants `authenticated` deletion; index on `user_id` exists

## 4. Read helpers + module barrel

- [x] 4.1 Create `src/modules/onboarding/server/read-checklist.ts` — `getOnboardingChecklist(supabase, userId)` returning the owner's single checklist row or null via the RLS-scoped client. `import 'server-only'`
- [x] 4.2 Create `src/modules/onboarding/server/read-preferences.ts` — `getNotificationPreferences(supabase, userId)` returning the owner's single preferences row or null via the RLS-scoped client. `import 'server-only'`
- [x] 4.3 Create `src/modules/onboarding/index.ts` — barrel re-exporting: lib (branded types, schemas, inferred types) and the two read helpers
- [x] 4.4 **Integration test:** `src/__tests__/integration/onboarding/read-helpers.int.test.ts` — seed a checklist + preferences row for user A; verify each helper returns A's row under A's RLS client and returns null/zero rows under user B's client (negative cross-tenant proof)
