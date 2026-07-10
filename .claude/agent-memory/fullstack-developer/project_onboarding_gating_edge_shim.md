---
name: onboarding-gating-edge-shim
description: e2e Edge profile shim must report onboarding_step for the reworked onboarding soft-gate; wizard step-4 'done' summary is gated out by middleware
metadata:
  type: project
---

Change `rework-onboarding-first-run` made `src/middleware.ts` gate `active` users by onboarding completion (`onboarding_step==='done' || onboarding_completed_at != null`).

**Why:** the seeded e2e suite's middleware decision comes from the mock-gotrue PostgREST shim (`/rest/v1/profiles`), NOT the real DB. Before this change the shim omitted onboarding fields, so `getCurrentProfileEdge` defaulted `onboarding_step` to `'welcome'` (INCOMPLETE) for every user — which the OLD middleware ignored, but the NEW middleware would treat as "redirect to /onboarding/welcome", breaking every `/dashboard` spec.

**How to apply:**
- Global seed user + all dashboard-style dedicated users must report `onboarding_step:'done'` in BOTH the Edge shim (`buildSeededProfileRow`, `buildActiveProfileRow`, dashboard-home `buildEmptyProfileRow`) AND the real DB (`global-setup.ts` UPDATEs), or they get bounced off the app to the wizard.
- First-run wizard specs use DEDICATED incomplete-onboarding users (`SEED_ONBOARDING_WIZARD_USER`, `SEED_ONBOARDING_REACTIVATED_USER`), never the shared seed user (which is permanently complete). See `onboarding/_wizard-user.ts`.
- Specs that COMPLETE/SKIP the wizard then navigate to /dashboard need the dynamic-onboarding shim overlay (`signInAsDedicatedUser(..., { dynamic: true })`): the static per-registration shim otherwise keeps reporting the sign-in-time step, so the post-skip navigation loops back to the wizard. The overlay (`__dynamicOnboarding` sentinel) makes the shim read live `onboarding_step` from Postgres.

**Coherence defect found (flag, not section-6 scope):** the wizard's step-4 "Tudo pronto" summary at `/onboarding/setup/done` is UNREACHABLE under the new gating. The patients-step skip/continue sets `onboarding_step='done'` BEFORE navigating to `/onboarding/setup/done`, and `middleware-gating` bounces any `done` user off wizard routes to `/dashboard`. So `step-done-cta-dashboard` + `completeOnboarding` (the only `onboarding_completed_at` stamp) are dead in every path — `onboarding_completed_at` stays NULL on the happy path. This contradicts `onboarding-wizard/spec.md` ("Skipping step 3 still allows step 4" + "Reaching step 4 and choosing either CTA SHALL set onboarding_completed_at"). The soft gate still works (via `onboarding_step='done'`), so it's a spec/UX incoherence in sections 4-5, not a functional gate failure.
