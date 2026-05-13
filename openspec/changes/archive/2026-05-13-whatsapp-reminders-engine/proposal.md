## Why

Psychologists spend 30-45 minutes daily sending manual WhatsApp reminders to patients, and no-show rates without reminders hover at 15-20% — each representing R$150-300 in lost revenue. Change 1 (`whatsapp-foundation-and-templates`) established the Twilio BSP connection, template management, and opt-out columns. This change builds the engine that actually sends reminders, processes patient responses via interactive buttons, and handles the full lifecycle of WhatsApp-based session confirmation/cancellation.

Without this engine, the infrastructure from change 1 sits idle — templates exist but nothing triggers them. This change closes the loop: configurable reminder windows, a 5-minute Inngest cron dispatcher, idempotent sending with retry/backoff, webhook processing for delivery status and patient button replies, and the PARAR opt-out command mandated by LGPD.

## What Changes

- New database tables: `reminder_settings` (per-psychologist reminder configuration), `whatsapp_messages` (log of all outbound/inbound messages with delivery tracking)
- New column on `sessions`: `reminders_disabled` (per-session override to suppress reminders)
- Pure functions for reminder window computation (early/final/video due times with night-shift logic), template variable selection, and deterministic idempotency key generation
- Twilio BSP adapter for sending template messages with structured error mapping
- Six Inngest functions: cron dispatcher (every 5 min), reminder sender (per-message with 3x retry backoff), confirmation acknowledgment sender, cancellation notice sender, consent footer sender, and reconciliation poller (every 30 min)
- Route Handler webhook for Twilio callbacks: delivery status updates, interactive button replies (confirm/cancel session), PARAR opt-out command, and inbound text persistence
- Server Actions for reminder settings CRUD and per-session reminder toggle
- Settings UI page, session form checkbox override, and WhatsApp health banner

## Capabilities

### New Capabilities
- `whatsapp-reminders-dispatch`: Inngest cron dispatcher that scans sessions within reminder windows and enqueues send events, plus the sender function that renders templates, calls the Twilio adapter, and persists `whatsapp_messages` with idempotency
- `whatsapp-reminder-settings`: Per-psychologist reminder configuration (early/final/video windows, night-shift toggle) with settings UI page and Server Actions
- `whatsapp-confirmation-flow`: Processes patient button replies ("Confirmar" / "Nao posso comparecer") received via webhook, updates session status, sends acknowledgment templates, and notifies the psychologist in-app
- `whatsapp-webhook-receiver`: Route Handler that validates Twilio HMAC signatures, processes delivery status callbacks, button replies, inbound text, and the PARAR command — all offloaded to Inngest events for <2s response time
- `whatsapp-stop-command`: Handles the LGPD-mandated "PARAR" opt-out: marks patient as opted out, ceases all reminders, sends confirmation, notifies psychologist

### Modified Capabilities
- `agenda-sessions`: Adds `reminders_disabled BOOLEAN DEFAULT FALSE` column to sessions table for per-session reminder suppression; session create/edit form gains a checkbox "Nao enviar lembretes WhatsApp para esta sessao"
- `agenda-cancellation`: When a session is cancelled by the psychologist, the system emits an event that triggers sending the `cancelamento_aviso` template to the patient via WhatsApp

## Impact

- **Dependencies:** `twilio` (Twilio Node.js SDK for sending messages and signature validation), `inngest` (already in stack — new functions registered)
- **Routes:** `src/app/(app)/configuracoes/lembretes/page.tsx`, `src/app/api/webhooks/twilio/whatsapp/route.ts`
- **Module expansion:** `src/modules/whatsapp/` gains `server/reminders/`, `server/adapters/`, `inngest/`, `lib/reminders/` subdirectories
- **DB schema:** New files in `src/shared/db/schema/whatsapp/` (tables for `reminder_settings`, `whatsapp_messages`); migration adds `reminders_disabled` to `sessions`
- **Performance:** Dispatcher cron runs every 5 minutes querying sessions by `(user_id, start_at)` composite index; webhook responds in <2s by offloading to Inngest; `whatsapp_messages` indexed by `(user_id, created_at DESC)`, `(session_id)`, `(patient_id, created_at DESC)`, and UNIQUE on `bsp_message_id`
- **Security:** Twilio webhook validated via HMAC-SHA1 (`X-Twilio-Signature`); all new tables have RLS scoped by `user_id = auth.uid()`; Twilio credentials stored in `serverEnv` (never exposed to client)
- **LGPD:** PARAR command implements LGPD art. 18 right of opposition; consent footer on first message per patient satisfies transparency requirement
