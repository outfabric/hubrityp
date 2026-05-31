## Context

PRD 11 §5.6–5.7. The write side of notifications already exists (the
`notifications` table, the `notify()` helper, the `remind-missing-evolution`
cron). The `notification_preferences` table and NPS columns ship in
`onboarding-data-model`, and `first_access_at` is stamped by `dashboard-home`.
This change is the consumption surface (bell/dropdown/realtime/read/preferences)
plus the NPS feature, reusing existing infrastructure (Supabase Realtime pattern
from ai-transcription, Resend mail helper, Inngest, date-fns pt-BR).

## Goals / Non-Goals

**Goals**
- Owner-scoped read surface for notifications with live realtime updates.
- Preferences with `email_critical` locked on.
- Day-7 NPS once, persisted owner-scoped, with detractor follow-up email.

**Non-Goals**
- No change to the `notifications` table or `notify()` write side.
- No new notification types beyond the MVP allowlist.
- No re-implementation of the evolution-pending cron (it already emits
  `evolution_pending`); we only consume it.

## Decisions

### Decision: Consume, don't duplicate, the existing write side
The bell/dropdown read from the existing `notifications` table via owner-scoped
queries; `evolution_pending` etc. continue to be produced by existing jobs. This
change adds only read/markRead/preferences and the realtime subscription.

### Decision: Realtime via the established `postgres_changes` pattern, owner-filtered
Reuse the ai-transcription realtime approach: a client hook subscribes to
`postgres_changes` on `notifications` with a `filter: user_id=eq.<owner>` so the
unread counter updates live. RLS + the channel filter both scope to the owner —
defense in depth. The hook lives in a `'use client'` leaf.

### Decision: markRead authorizes from session, never id alone
`markNotificationRead` updates `WHERE id = :id AND user_id = auth.uid()` (and RLS
backstops it). This closes the IDOR vector — B cannot mark A's notification read.
Inputs are Zod-validated (UUID) at the boundary.

### Decision: 30-day auto-read is an Inngest scheduled function (service-role)
Bulk-updating across all users requires bypassing RLS, so it runs with the
service-role client in an Inngest scheduled function (not a user-reachable path),
with a justifying comment. It marks read, never deletes (notifications move to
history).

### Decision: `email_critical` enforced server-side
The preferences action coerces/refuses `email_critical = false`. Client UI shows
it locked, but the server is the authority — a crafted request can't disable
mandatory critical email.

### Decision: NPS eligibility derived server-side from `first_access_at`
A user is eligible when `now - first_access_at >= 7 days` and
`nps_responded_at IS NULL`. The modal's show/once-only logic reads this from the
server (profile), not from `localStorage`, so it behaves correctly across
devices and can't be re-triggered by clearing storage. Dismissal sets
`nps_responded_at` (no score) to stop re-showing while allowing a later answer.

### Decision: Day-7 trigger + detractor email via Inngest (service-role)
An Inngest function keyed off `first_access_at` (sleep-until or daily sweep)
flags eligibility; the in-app modal is what the user sees. Detractor (score 0–6)
submissions enqueue a Resend follow-up email job. All logs use the user UUID
only — never email/name/feedback (LGPD).

## Risks / Trade-offs

- **Risk:** realtime connection churn on navigation. *Mitigation:* subscribe once
  in the app shell layout leaf and clean up on unmount, mirroring the existing
  ai-transcription boundary.
- **Trade-off:** day-7 modal logic split between an Inngest sweep and a
  server-derived gate. Accepted — the gate (`first_access_at`/`nps_responded_at`)
  is the source of truth; Inngest only handles the detractor email side-effect.

## Migration Plan

No schema migration — `notification_preferences` and NPS columns ship in
`onboarding-data-model`. This change registers new Inngest functions and adds
UI/actions only.

## Open Questions

- Exact day-7 windowing (>= 7 days vs. exactly on the 7th calendar day in
  America/Sao_Paulo). Assumption: first eligible app open at or after 7×24h from
  `first_access_at`; documented, tunable without a spec change.
