---
name: notifications-nps-qa
description: QA map for the in-app-notifications-and-nps feature — bell/dropdown, prefs page, NPS day-7 modal + feedback page; seeding recipe, MVP-type allowlist gotcha, eligibility columns
metadata:
  type: project
---

Feature: in-app notification bell + dropdown, `/configuracoes/notificacoes` prefs, NPS day-7 modal, `/configuracoes/feedback`.

**Routes/components:** bell at `src/modules/notifications/components/notification-bell.tsx` (header), dropdown `notification-dropdown.tsx`; prefs form `app/(app)/configuracoes/notificacoes/notification-preferences-form.tsx`; NPS modal `src/modules/nps/components/nps-modal.tsx`; feedback page `app/(app)/configuracoes/feedback/`.

**Seeding for browser QA (shared Supabase, see [[authenticated-browser-qa-setup]]):**
- Tables created by `db:migrate`: `public.notifications` (cols: user_id,type,title,body,action_url,read_at,created_at) and `public.notification_preferences` (email_daily,email_weekly,in_app_sound,email_critical). Profile gains `first_access_at`,`nps_responded_at`,`nps_score`,`nps_feedback`.
- Insert notifications directly via psql.

**Critical gotcha — MVP type allowlist.** The dropdown renders an icon + clickable route ONLY for these `type` values: `session_confirmed, session_cancelled, evolution_pending, consent_signed, ai_note_ready, ai_risk_alert, system_notice`. ANY other type (e.g. `appointment`,`payment`,`reminder`) renders as an INERT no-icon, non-clickable `<li>` BY DESIGN (open-redirect hardening). Seed with allowlist types or you'll false-flag "missing icons".

**NPS eligibility (server-side, never localStorage):** `isEligibleForNps` = `nps_responded_at IS NULL` AND `now - first_access_at >= 7*24h`. To force the day-7 modal: `UPDATE profiles SET first_access_at = now()-interval '8 days', nps_responded_at=NULL`. To suppress: set `nps_responded_at` non-null OR `first_access_at` null. Both submit and dismiss ("Não responder agora") stamp `nps_responded_at`; dismiss leaves score/feedback NULL.

**Prefs save is explicit:** toggles only update form state; must click "Salvar" to persist (toast "Preferências salvas"). `email_critical` switch is `[checked][disabled]` locked-on, server coerces TRUE.

**Verified clean (2026-06-04, qa-1):** all 7 scenarios PASS. LOW: NPS 0–10 radiogroup deviates from WAI-ARIA — arrow keys don't move selection, each radio is its own tab stop (still operable via Tab+Space). INFO: dashboard `MAIN.flex-1.px-6.py-8` has horizontal overflow at 375px (399px) — NOT this feature; feature pages + dropdown fit mobile fine. Realtime websocket push not exercised (only server-driven initial count + reload).

Onboarding Driver.js tour ("Pular tour" button) overlays the dashboard for fresh users and can intercept bell clicks — dismiss it first.
