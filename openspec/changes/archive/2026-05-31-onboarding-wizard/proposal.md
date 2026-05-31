## Why

After email verification + CRP validation (PRD 01), the psychologist lands in
an empty app with no guidance. PRD 11 §5.1–5.2 requires a welcome screen and a
4-step setup wizard ("Sobre você", "Local e agenda", "Importe pacientes",
"Pronto") that takes them to first value in under 8 minutes. The wizard must be
resumable (RF-11.05), individually skippable (RF-11.04), and never reference
post-MVP modules (RN-11.02). The data foundation (onboarding columns, checklist)
is delivered by `onboarding-data-model`; this change builds the flow on top.

## What Changes

- New route group `(app)/onboarding/welcome` (RF-11.01) and a 4-step wizard at
  `(app)/onboarding/setup/[step]` — a dedicated multi-step **page** flow (the
  design system mandates pages, not modals, for wizards).
- **BREAKING (gating)**: extend `src/middleware.ts` `classifyPath()` so the new
  `/onboarding/welcome` and `/onboarding/setup*` prefixes resolve to a gated
  class — Next.js route groups do NOT gate; an unclassified `(app)/onboarding/*`
  route would otherwise default to public. Add the matching decision-table row.
- Server Actions in a new `onboarding` module surface area
  (`saveOnboardingStep`, `completeOnboarding`, `skipOnboarding`,
  `resumeOnboardingStep` read helper) that persist `onboarding_step` and flip
  checklist booleans, authorizing strictly from the session.
- Resume-from-last-step logic + a "you haven't finished setup" banner (RF-11.02).
- Step 1 reuses the profile update path; Step 2 reuses existing
  `createLocationImpl` + `agendaSettings`; Step 3 reuses existing patient
  create/import; Step 4 is a read-only summary. No duplicate CRUD is created.
- CSV import gating: Step 3 blocks upload until the sensitive-data consent term
  is accepted (RN-11.03), with copy pointing to Configurações > Privacidade.

## Capabilities

### New Capabilities
- `onboarding-wizard`: welcome screen, 4-step resumable/skippable setup flow,
  step persistence Server Actions, resume + unfinished-setup banner, and the
  middleware gating for the new onboarding routes.

### Modified Capabilities
- `middleware-gating`: `classifyPath()` gains the `/onboarding/welcome` and
  `/onboarding/setup*` prefixes as gated routes, with a new decision-table row
  and a negative-auth test.

## Impact

- **Routes**: `src/app/(app)/onboarding/welcome/page.tsx`,
  `src/app/(app)/onboarding/setup/[step]/page.tsx` (+ `actions.ts` thin shells).
- **Module**: `src/modules/onboarding/` gains `server/` Server Action impls and
  `components/` (wizard step components, progress indicator).
- **Edge**: middleware imports only the existing edge-safe profile helper; no
  new Node-only dep crosses the Edge boundary.
- **Reuse**: `@/modules/agenda` (locations, agenda settings), `@/modules/patients`
  (create/import), `@/modules/registration` (profile/status).
- **Security/LGPD**: every step action authenticates via
  `supabase.auth.getUser()`, ignores client-supplied user ids, and writes only
  the session owner's rows (RLS-backed). Profile photo upload validated on the
  server (MIME/size/extension) with a server-generated UUID filename. No PII in
  logs. CSV import inherits the existing import module's LGPD controls.
