## Why

Sessions today default to `scheduled` and can be marked `done`, but the full lifecycle — confirmation, cancellation with reason, no-show tracking, and patient-facing confirmation — is missing. Psychologists need structured cancellation records (who, why, how much notice) to enforce their cancellation policies and track revenue loss. Patients need a frictionless way to confirm or decline attendance via a public link (no login required), mirroring the consent term pattern already established.

Without this, the psychologist resorts to WhatsApp threads to track confirmations, manually calculates cancellation notice periods, and has no reliable data to distinguish cancellations from no-shows — making billing disputes and clinical statistics unreliable.

## What Changes

- Full session status state machine: `scheduled` -> `confirmed` / `cancelled` / `done` / `no_show`, with valid transitions enforced server-side and available actions per status rendered in the session detail modal
- Cancellation form with structured fields: reason (select), who cancelled (patient/therapist), auto-calculated notice period (24h+ / <24h / <1h / on_time), charge flag — persisted in `sessions` cancellation columns
- Reschedule-as-cancel-plus-new: cancelling with immediate creation of a replacement session, linked bidirectionally via `rescheduled_to_session_id` / `rescheduled_from_session_id`
- No-show status distinct from cancelled, with separate statistics and future charge integration point
- 7-day edit lock on `done` sessions (RN-03.04): hard rejection in Server Actions, disabled UI controls
- Public confirmation page at `/confirmar-sessao/[token]` (no auth): patient confirms attendance or reports inability to attend, mirroring the consent term public page pattern
- Confirmation token per session (32-byte random, base64url, single-use after action)
- Session history audit entries for status transitions (appended to `session_history` table from foundation)
- Notification event emit (Inngest) for downstream consumers (PRD 04 reminders, cancellation alerts) — only the event interface and emit, not the WhatsApp delivery
- Infrastructure for RN-03.06 notification trigger (session `done` without clinical note after 7 days)

## Capabilities

### New Capabilities
- `agenda-session-status-flow`: Complete session status state machine with valid transitions, per-status available actions, 7-day edit lock on done sessions, session history audit trail entries for each transition, and notification event emit via Inngest
- `agenda-cancellation`: Structured cancellation form (reason, who, notice period, charge flag), reschedule-as-cancel-plus-new with bidirectional session linking, and no-show handling distinct from cancellation
- `agenda-public-confirmation`: Public page `/confirmar-sessao/[token]` for patient confirmation or decline without authentication, token generation/expiration/revocation, status update on action, and psychologist notification event

### Modified Capabilities
- `agenda-sessions` (from `agenda-foundation-and-sessions`): Sessions table gains cancellation columns (`cancellation_reason`, `cancelled_by`, `cancellation_notice`, `cancelled_at`, `charge_cancellation`), confirmation columns (`confirmation_token`, `confirmed_at`), reschedule columns (`rescheduled_to_session_id`, `rescheduled_from_session_id`), and CHECK constraint on `status`. Session detail modal gains status-dependent action buttons
- `agenda-views` (from `agenda-foundation-and-sessions`): Calendar event rendering gains status badges with semantic colors (scheduled=neutral, confirmed=success, done=brand, cancelled=danger, no_show=warning)

## Impact

- **Dependency:** This change DEPENDS on `agenda-foundation-and-sessions` which creates the `sessions`, `locations`, `agenda_settings`, and `session_history` tables, the base session CRUD, and the calendar views with session detail modal. Columns added to `sessions` here extend the foundation schema
- **Parallel change:** `agenda-recurring-sessions` is being developed in parallel and adds `recurrence_id`, `patient_ids`, `is_late_record` to `sessions`. No conflicts — columns are independent. Reschedule of a recurring session follows the foundation's edit-scope pattern (this change only handles single-session reschedule)
- **Database:** Migration adding new columns to `sessions` (cancellation_*, confirmation_*, rescheduled_*), CHECK constraint on status enum, and RLS policy for public token access (service-role bypass). No new tables — `session_history` already exists from foundation
- **Drizzle schema:** Updated `sessions` table in `src/shared/db/schema/agenda/tables.ts` with new columns and CHECK constraint
- **Routes:** `src/app/(public)/confirmar-sessao/[token]/page.tsx` (public, no auth layout — mirrors `/termo/[token]` pattern)
- **Module:** New server actions in `src/modules/agenda/server/` for status transitions, cancellation, public confirmation. New lib helpers for state machine, notice calculation, token generation. New components for cancellation dialog, status action buttons, public confirmation page
- **Inngest:** New event types (`agenda/session.confirmed`, `agenda/session.cancelled`, `agenda/session.no_show`, `agenda/session.done`, `agenda/session.missing_note_reminder`) emitted from Server Actions. Consumer functions are NOT part of this change (PRD 04)
- **Frontend:** Extends session detail modal with status-dependent action buttons, cancellation dialog, status badges on calendar. New public page for patient confirmation
