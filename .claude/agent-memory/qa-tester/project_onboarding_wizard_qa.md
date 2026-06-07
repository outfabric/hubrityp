---
name: onboarding-wizard-qa
description: How the 4-step onboarding wizard behaves and how to QA it — routes, strict forward-gating, CSV consent gate, banner visibility rule, testids
metadata:
  type: project
---

Onboarding wizard for psychologists. Routes: `/onboarding/welcome` (greeting + start/skip) and `/onboarding/setup/[step]` where step ∈ {profile, location, patients, done} ("Passo N de 4", N=1..4). Module: `src/modules/onboarding`.

**Key invariants verified working (2026-05-31, change `onboarding-wizard`):**
- **Strict forward-gating**: the route reads server-side `profiles.onboarding_step`, maps `welcome→profile`, and bounces ANY requested step that differs from the resume index back to the resume point. Direct-nav to a later (or earlier) step → redirect to resume segment, never a blank frame. Resume never uses client state.
- **Unknown `[step]` segment** (e.g. `billing`) → `notFound()` AFTER the auth/status guards, so an authenticated browser sees the Next.js 404 page (no wizard frame). Unauthenticated curl 307s to `/login` first (middleware-gated).
- **CSV consent gate (step 3 / RN-11.03)**: when `profiles.sensitive_data_consent_at IS NULL` the CSV card is `aria-disabled=true`, NO `role=button` (click inert), and shows a message linking to `/configuracoes/privacidade` ("Configurações > Privacidade"). With consent set, card becomes `role=button` enabled. To test the blocked path: `UPDATE public.profiles SET sensitive_data_consent_at=NULL ...` then reload `/onboarding/setup/patients` (note: admin-API signup with `sensitiveDataConsentAt` metadata seeds it NON-null, so you must clear it).
- **Skip vs complete**: welcome "Pular e explorar" AND step-3 "Pular por enquanto" both set `onboarding_step='done'`; skip-from-welcome leaves `onboarding_completed_at` NULL. Step-4 CTAs ("Ver minha agenda"→/agenda, "Ir para o dashboard"→/dashboard) BOTH stamp `onboarding_completed_at=now()`.
- **Unfinished-setup banner** (`(app)/layout.tsx`, testid `unfinished-setup-banner`): renders iff `onboarding_completed_at IS NULL AND onboarding_step != 'done'`. So it hides after EITHER complete or skip. "continuar" link → resume segment.
- **Step 4 "O que vem em breve"** lists WhatsApp/PIX/Receita Saúde as TEXT ONLY (0 actionable elements) — spec forbids actionable post-MVP refs; steps 1-3 must have none at all.
- Accessibility is solid: labeled inputs, validation errors wired with `aria-invalid` + `aria-describedby` → `role=alert`. (The only unlabeled input is the hidden Next.js `$ACTION_ID` Server Action field — ignore it.)
- Quick-add/profile forms use react-hook-form: drive fields with playwright `fill`, NOT raw DOM `value`+`input` (RHF won't sync and keeps stale validation state).

Testids: `onboarding-welcome-heading`, `onboarding-start-btn`, `onboarding-skip-link`, `wizard-progress`, `setup-step-heading`, `step-patients`, `step-patients-csv-option`, `step-patients-csv-consent-blocked`, `step-patients-privacy-link`, `step-patients-skip`, `step-patients-quick-add-*`, `step-done`, `step-done-item-<key>-check|-configure`, `step-done-coming-soon`, `step-done-cta-agenda|-cta-dashboard`, `unfinished-setup-banner(-link)`.

See [[authenticated-browser-qa-setup]] for the 3-user creation recipe. All scripted scenarios + free exploration PASS (qa-1.md).
