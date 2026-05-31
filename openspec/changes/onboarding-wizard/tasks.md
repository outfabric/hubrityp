# Tasks — onboarding-wizard

> Ordering rule: each automated test follows immediately after the code change
> that motivates it (code → its test → next code). Depends on
> `onboarding-data-model` being implemented first.

## 1. Middleware gating (security-first)

- [ ] 1.1 Update `src/middleware.ts` `classifyPath()` — add `/onboarding/welcome` and `/onboarding/setup` to the onboarding gated class (strict prefix+separator match). Update the decision-table comment with the new row
- [ ] 1.2 **Integration test:** `src/__tests__/integration/middleware/onboarding-wizard-gating.int.test.ts` — NEGATIVE-AUTH proof: anonymous GET `/onboarding/setup/profile` redirects to `/login?redirectTo=...`; active user passes; pending user is bounced to `/onboarding/pending`; near-miss `/onboarding/welcomex` is NOT gated

## 2. Wizard Zod schemas + step model (pure logic)

- [ ] 2.1 Create `src/modules/onboarding/lib/wizard.ts` — pure helpers: `WIZARD_STEPS` ordered list, `nextStep(step)`, `isValidStep(segment)`, and per-step input schemas (`profileStepSchema`, `locationStepSchema` re-using agenda location schema, `patientsStepSkipSchema`). Map `onboarding_step` → resume segment
- [ ] 2.2 **Unit test:** `src/__tests__/unit/modules/onboarding/lib/wizard.test.ts` — `nextStep` ordering, `isValidStep('billing')` is false, resume mapping from each `onboarding_step` value, `profileStepSchema` validation cases

## 3. Step-persistence Server Actions

- [ ] 3.1 Create `src/modules/onboarding/server/save-onboarding-step.ts` — `saveOnboardingStepImpl(supabase, input)`: getUser() auth, Zod-validate, upsert `onboarding_checklist` row, set `profiles.onboarding_step` to the target (absolute, idempotent), flip the relevant checklist flag. Ignore any client `userId`. Sanitized errors, no PII logs
- [ ] 3.2 Create `src/modules/onboarding/server/complete-onboarding.ts` — `completeOnboardingImpl(supabase)`: getUser() auth, set `onboarding_completed_at = now()`, `onboarding_step = 'done'`
- [ ] 3.3 Create `src/modules/onboarding/server/skip-onboarding.ts` — `skipOnboardingImpl(supabase)`: getUser() auth, set `onboarding_step = 'done'` without forcing any step (does NOT set `onboarding_completed_at`, so checklist still nudges later)
- [ ] 3.4 Create `src/modules/onboarding/server/resume-step.ts` — `resumeOnboardingStepImpl(supabase)`: read owner's `onboarding_step`, return resume segment
- [ ] 3.5 Update `src/modules/onboarding/index.ts` barrel — export the four impls + their result types
- [ ] 3.6 **Integration test:** `src/__tests__/integration/onboarding/wizard-actions.int.test.ts` — happy paths for each action; IDOR proof (payload `userId` for another account is ignored, only `auth.uid()` row written); skip leaves checklist flags FALSE; complete stamps `onboarding_completed_at`; cross-user RLS — user B cannot mutate user A's step

## 4. Welcome page

- [ ] 4.1 Create `src/app/(app)/onboarding/welcome/page.tsx` (Server Component) — greeting "Olá, {firstName}!", primary "Começar configuração (5 min)" → `/onboarding/setup/profile`, secondary link "Pular e explorar por conta própria" → `skipOnboarding` then `/dashboard`. Welcome-back copy variant when `reactivated_at` is set. Sálvia tokens; Button `primary`/`link`
- [ ] 4.2 Create thin `src/app/(app)/onboarding/welcome/actions.ts` (`'use server'`) wrapping `skipOnboardingImpl`
- [ ] 4.3 **E2E test:** `src/__tests__/e2e/seeded/onboarding/welcome.spec.ts` — seeded active user sees greeting; "Pular e explorar" routes to `/dashboard` and sets `onboarding_step='done'`; anonymous visit redirects to `/login`

## 5. Wizard step 1 — Sobre você (profile)

- [ ] 5.1 Create `src/modules/onboarding/components/wizard-progress.tsx` — "Passo N de 4" indicator (design-system caption-upper + neutral track)
- [ ] 5.2 Create `src/app/(app)/onboarding/setup/[step]/page.tsx` (Server Component) — validate `[step]` via `isValidStep` (404/redirect otherwise), route invalid/earlier step to resume point, render the matching step component with progress indicator. Assert no post-MVP module text
- [ ] 5.3 Create `src/modules/onboarding/components/step-profile.tsx` (client leaf) — RHF + Zod: display name, pronome (free text), especialização (autocomplete), tipo de atuação, optional photo upload. On submit calls `saveOnboardingStep` for `profile`
- [ ] 5.4 Create server-validated photo upload action (`src/modules/onboarding/server/upload-profile-photo.ts`) — getUser() auth, validate MIME/size/extension server-side, store in Supabase Storage under UUID filename in owner-scoped path, sanitized error on reject
- [ ] 5.5 **Integration test:** `src/__tests__/integration/onboarding/profile-photo-upload.int.test.ts` — rejects oversized file, rejects non-image MIME, accepts valid image and stores under a UUID name (not the supplied name); cross-user path isolation
- [ ] 5.6 **Unit test:** `src/__tests__/unit/modules/onboarding/components/step-profile.test.tsx` — RHF validation: required display name, blur-time inline error styling per design system

## 6. Wizard step 2 — Local e agenda (reuse agenda module)

- [ ] 6.1 Create `src/modules/onboarding/components/step-location.tsx` — reuse `@/modules/agenda` location create + agenda settings (duration default 50, interval default 10, working hours). On at least one location, mark step complete (server flips `location_configured`)
- [ ] 6.2 **Integration test:** `src/__tests__/integration/onboarding/step-location.int.test.ts` — adding first location flips `onboarding_checklist.location_configured = true`; no duplicate location table is created (reuses existing `locations`)

## 7. Wizard step 3 — Importe pacientes (reuse patients module + consent gate)

- [ ] 7.1 Create `src/modules/onboarding/components/step-patients.tsx` — three options (CSV upload via existing import, quick-add via existing create, skip). Disable CSV upload when `sensitive_data_consent_at IS NULL` with copy pointing to Configurações > Privacidade. CSV preview = first 5 rows + validation highlight
- [ ] 7.2 Ensure the server import entry refuses to start without sensitive-data consent (server-side gate, not only UI)
- [ ] 7.3 **Integration test:** `src/__tests__/integration/onboarding/step-patients-consent-gate.int.test.ts` — import blocked server-side when `sensitive_data_consent_at` NULL; quick-add patient flips `first_patient_added = true`; cross-user RLS holds

## 8. Wizard step 4 — Pronto + completion

- [ ] 8.1 Create `src/modules/onboarding/components/step-done.tsx` — summary with check per configured item, "Configurar agora" link per missing item (non-blocking), primary "Ver minha agenda" (`/agenda`), secondary "Ir para o dashboard" (`/dashboard`), "O que vem em breve" info section (no enablement). Either CTA calls `completeOnboarding`
- [ ] 8.2 Create thin `src/app/(app)/onboarding/setup/[step]/actions.ts` (`'use server'`) wrapping save/complete impls
- [ ] 8.3 **Unit test:** `src/__tests__/unit/modules/onboarding/components/step-done.test.tsx` — shows check vs "Configurar agora" based on checklist state; renders "O que vem em breve" without enabling anything; no post-MVP module is actionable

## 9. Unfinished-setup banner + resume

- [ ] 9.1 Create `src/modules/onboarding/components/unfinished-setup-banner.tsx` — renders for `onboarding_completed_at IS NULL && onboarding_step != 'done'`; "continuar" links to resume step; design-system info/neutral alert (no brand bg)
- [ ] 9.2 Wire the banner into the authenticated app shell layout (`src/app/(app)/layout.tsx`) using the server-side profile read; hidden when completed/skipped
- [ ] 9.3 **Unit test:** `src/__tests__/unit/modules/onboarding/components/unfinished-setup-banner.test.tsx` — visible for incomplete profile, hidden when `onboarding_completed_at` set, link targets the resume step

## 10. End-to-end wizard flow

- [ ] 10.1 **E2E test:** `src/__tests__/e2e/seeded/onboarding/wizard-flow.spec.ts` — seeded active user completes all 4 steps in order; progress shows "Passo N de 4"; resume after reload returns to saved step; skip on step 3 still reaches step 4; completion routes to `/dashboard` and hides the banner; assert no "WhatsApp/Receita Saúde/PIX/cobrança/recibo" text anywhere in the wizard
