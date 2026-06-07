---
name: wizard-spec-pollutes-seed-fullname
description: onboarding wizard-flow.spec.ts leaves shared seed user full_name='Seed Baseline' (never restores 'Seed User'); auth/agenda-confirm/telepsicologia victims fail nondeterministically
metadata:
  type: project
---

`src/__tests__/e2e/seeded/onboarding/wizard-flow.spec.ts` `resetOnboarding()` (beforeEach) does `UPDATE public.profiles SET full_name = 'Seed Baseline' WHERE user_id = seed.userId` (const `RESET_FULL_NAME = 'Seed Baseline'`) and the test then types 'Dra. Seed'. It NEVER restores `full_name` back to 'Seed User'. The seeded `full_name` baseline is 'Seed User' (set in `setup/global-setup.ts:54` and `mock-gotrue.ts:567`).

Victim specs read the SAME shared seed user's `full_name` and assert 'Seed User':
- `auth.spec.ts:49` — `dashboard-greeting` → "Olá, Seed User"
- `agenda/public-confirmation-confirm.spec.ts:64` — `session-psychologist` → "Seed User"
- `telepsicologia/patient-join-flow.spec.ts:204` — waiting-room `psychologistName` → "Seed User"

**Why:** introduced by PR #71 (onboarding-wizard, the merge immediately before dashboard-home). It is a cross-spec test-isolation bug on the shared reused-container `profiles` row. Manifests only when the wizard spec runs BEFORE a victim on the same Playwright worker — pure file-sharding/worker-scheduling nondeterminism. Reproduce deterministically: `npx playwright test --workers=1 --retries=0 onboarding/wizard-flow.spec.ts auth.spec.ts agenda/public-confirmation-confirm.spec.ts` → victims fail with "Seed Baseline". `CI=true` retries=2 do NOT absorb it (deterministic once polluted, but the pollution itself is scheduling-dependent across a full run).

**How to apply:** if a sweep/CI shows auth/agenda-confirm/telepsicologia failing with received "Seed Baseline" / "Olá, Seed Baseline", it is THIS pre-existing bug, not the branch under test. Real fix (out of scope unless ticket owns onboarding): wizard spec `afterEach`/`afterAll` should restore `full_name = 'Seed User'`, or each victim should reset it in its own beforeEach. Distinct from [[e2e-prontuario-tabs-flaky]] (that is Radix tab load flake, absorbed by CI retries).
