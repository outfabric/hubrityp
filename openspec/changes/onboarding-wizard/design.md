## Context

PRD 11 §5.1–5.2 and §8 describe the welcome screen + 4-step wizard as the bridge
from a validated CRP to first value. The data model (`onboarding-data-model`)
already provides `profiles.onboarding_step`, `onboarding_completed_at`, and the
`onboarding_checklist` table. This change is pure flow + UI + gating, reusing
the agenda (locations, settings) and patients (create/import) modules that
already exist.

## Goals / Non-Goals

**Goals**
- Resumable, skippable 4-step wizard with persistent progress.
- Gate the new routes in middleware with a negative-auth test.
- Reuse existing location/agenda/patient code — zero duplicate CRUD.

**Non-Goals**
- No new domain tables (the data model change owns those).
- No checklist card / tour (owned by `onboarding-checklist-and-tour`).
- No WhatsApp/Receita/PIX steps — explicitly out of MVP scope (RN-11.02).

## Decisions

### Decision: Wizard is a page flow at `/onboarding/setup/[step]`, not a modal
The design system mandates pages (not modals) for multi-step wizards. A dynamic
`[step]` segment keeps each step a real URL (shareable, back-button friendly,
resumable). The welcome screen is a sibling `/onboarding/welcome` page.

### Decision: Gate new routes explicitly in `classifyPath()`
Route groups do not gate. The existing classifier only treats `/onboarding/pending`
as the onboarding class; `/onboarding/welcome` and `/onboarding/setup*` would
otherwise default to `public`. We add them to the onboarding/app gating with a
new decision-table row and a negative-auth integration test. The strict
prefix+separator check (already used for `/dashboard`) prevents near-miss
matches like `/onboarding/welcomex`.

### Decision: Step persistence is server-authoritative, session-scoped
Each "Continuar" submits a Server Action that (1) `getUser()` authenticates,
(2) Zod-validates the step payload, (3) writes ONLY the session owner's
`profiles.onboarding_step` + checklist flags. Any `userId` in the payload is
ignored — authorization comes from `auth.uid()`, RLS is the backstop. This
closes the IDOR vector on a multi-tenant write path.

### Decision: Resume logic derives from `onboarding_step`, not client state
`resumeOnboardingStep` reads the owner's `profiles.onboarding_step` server-side
and maps it to the next incomplete step. The wizard never trusts a client cookie
or query param to decide resume position, so a tampered client can't jump the
flow or skip the gate.

### Decision: CSV import reuses the existing import module, gated by consent
Step 3 calls the existing `@/modules/patients` import path. The only new rule is
RN-11.03: upload is disabled when `profiles.sensitive_data_consent_at IS NULL`.
This is enforced both in the UI (disabled control + copy) and server-side (the
action refuses to start an import without consent), since client-side gating
alone is bypassable.

### Decision: Profile photo upload validated server-side, UUID filename
MIME/size/extension validated on the server; stored under a server-generated
UUID name in an owner-scoped Storage path. Never trust the client's filename or
content-type. Sanitized error on rejection.

## Risks / Trade-offs

- **Risk:** double-write race when two tabs advance the wizard. *Mitigation:*
  `saveOnboardingStep` is idempotent — it sets the target step absolutely, not
  by increment, so re-submits converge.
- **Trade-off:** lazy checklist row (from data-model change) means each step
  action must upsert the checklist row before flipping a flag. Accepted.

## Migration Plan

No schema migration here — the data model change already shipped the columns and
tables. This change is code + routes + middleware only.

## Open Questions

- Welcome-back path for reactivated accounts (PRD 11 edge case) reads
  `profiles.reactivated_at`; the copy variant ("Bem-vindo de volta") is in scope
  but does not change the gating or persistence logic.
