## Why

PRD 11 §5.6–5.7 require an in-app notification center (bell + dropdown, realtime,
mark-as-read, preferences) and a day-7 NPS survey with detractor follow-up. The
write side already exists: the `notifications` table, the `notify()` helper, and
the `remind-missing-evolution` cron that emits `evolution_pending` notifications.
What is missing is the **read/consumption surface** (bell UI, realtime updates,
read state, preferences, auto-read of old notifications) and the **NPS** feature
end-to-end. The `notification_preferences` table and the NPS columns ship in
`onboarding-data-model`; this change builds the behavior on top.

## What Changes

- Notification bell in the app header (RF-11.15) with an unread counter, and a
  dropdown panel (RF-11.16) listing notifications chronologically with per-type
  Lucide icon, title, relative timestamp (date-fns pt-BR), and "Marcar todas
  como lidas".
- Read/list Server Actions: `listNotifications`, `markNotificationRead`,
  `markAllNotificationsRead`, `getUnreadCount` — all RLS-scoped, owner-only.
- Realtime updates via Supabase Realtime (RNF-11.04), reusing the established
  `postgres_changes` subscription pattern, so the unread counter updates live
  without a refresh.
- Auto-read of notifications older than 30 days (RF-11.17) via an Inngest
  scheduled function (service-role, not user-reachable).
- Notification preferences UI under Configurações > Notificações, persisting to
  `notification_preferences` with `email_critical` locked on (non-disableable).
- The MVP notification-type allowlist enforced on the UI (per-type icon/route):
  `session_confirmed`, `session_cancelled`, `evolution_pending`,
  `consent_signed`, `ai_note_ready`, `ai_risk_alert`, `system_notice`. Post-MVP
  types never render.
- NPS (RF-11.24–11.25): a day-7 modal (shown once) saving `nps_score` +
  `nps_feedback`, an Inngest scheduled function that schedules/sends the modal
  trigger based on `first_access_at`, a "Feedback" entry under Configurações to
  answer later, and a detractor (0–6) follow-up email via Resend.

## Capabilities

### New Capabilities
- `in-app-notifications`: bell + dropdown UI, read/list/unread Server Actions,
  realtime updates, 30-day auto-read job, and notification preferences UI.
- `nps-survey`: day-7 NPS modal (once), persistence, deferred answering entry,
  and detractor follow-up email.

### Modified Capabilities
<!-- The write-side notifications spec is unchanged. This change consumes the
     existing `notifications` table and `notify()` helper without altering them. -->

## Impact

- **Module**: `src/modules/notifications/` gains read Server Actions, a realtime
  hook, components (bell, dropdown, preferences form), and an Inngest auto-read
  job; new `src/modules/nps/` for the modal, persistence action, scheduling job,
  and detractor email.
- **Routes**: bell wired into `src/app/(app)/layout.tsx` header; preferences page
  under `/configuracoes/notificacoes`; NPS feedback entry under `/configuracoes`.
- **Jobs**: register new Inngest functions in `src/app/api/inngest/route.ts`.
- **Reuse**: existing `notify()` helper, `remind-missing-evolution` cron, the
  ai-transcription realtime pattern, the Resend mail helper, date-fns pt-BR.
- **Security/LGPD**: read actions authenticate via `getUser()` and are RLS-scoped
  (owner sees only their notifications). Realtime channel filtered by `user_id`.
  Inngest jobs use service-role with a justifying comment and are not
  user-reachable. NPS `nps_feedback` may contain PII — owner-scoped, never
  logged; the detractor email contains no clinical content and uses the internal
  user id, never PII, in logs. Preferences enforce `email_critical` server-side
  (cannot be disabled). New `/configuracoes/notificacoes` route is already gated
  (the `/configuracoes` prefix is in `classifyPath()`), with a negative-auth test.
