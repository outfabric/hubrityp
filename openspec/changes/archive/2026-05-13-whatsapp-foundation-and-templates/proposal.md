## Why

Brazilian psychologists spend 30-45 minutes daily sending manual WhatsApp reminders to patients. This repetitive task is the single most hated administrative chore, and the lack of reliable reminders drives no-show rates to 15-20% — each one representing R$ 150-300 in lost revenue. WhatsApp is the only viable channel: 99%+ penetration among Brazilian patients with ~98% read rates versus ~20% for email.

Automating this requires a compliant foundation: a connection to the WhatsApp Business API via a licensed BSP (Twilio), pre-approved message templates with Meta review flow, and LGPD-compliant opt-out controls per patient. This change builds that foundation — the infrastructure upon which the reminder engine (change 2) and inbox/analytics (change 3) will operate.

## What Changes

- New database tables: `whatsapp_accounts` (Twilio BSP connection per psychologist, RLS by user_id) and `message_templates` (editable templates with Meta approval status, RLS by user_id, UNIQUE on user_id + template_key)
- New columns on `patients`: `whatsapp_opt_out` (boolean), `whatsapp_opt_out_at` (timestamptz), `reminder_phone` (varchar — alternative number for minors/guardians)
- WhatsApp module (`src/modules/whatsapp/`) with Server Actions for Twilio connection lifecycle (start, complete, disconnect, health-check), template CRUD (seed defaults, list, get, update with Meta re-submission), and patient opt-out toggle
- Validators (Zod): template body/variables validation, template key enum, E.164 phone number schema
- Pure utility functions: template variable rendering (`render-template.ts`), variable dictionary with metadata (`template-variables.ts`)
- Frontend: WhatsApp integration page under Configuracoes > Integracoes > WhatsApp (connection status card, connect dialog with LGPD consent), templates list and edit pages under Configuracoes > Lembretes > Templates, opt-out toggle on patient form
- No new sidebar entry — WhatsApp lives inside existing Configuracoes section

## Capabilities

### New Capabilities
- `whatsapp-account`: Twilio BSP connection lifecycle — start connection (sender registration via Twilio Channels API), complete verification, get account status, disconnect (soft — keeps row for history), health-check endpoint
- `whatsapp-templates`: Six default message templates seeded on first connection (lembrete_24h, lembrete_2h, confirmacao_recebida, cancelamento_aviso, link_video, termo_consentimento). Psychologist can edit body text; edits trigger Meta re-approval via Twilio Content API. Template rendering with variable substitution
- `whatsapp-patient-opt-out`: Per-patient toggle to cease all WhatsApp reminders, with timestamp and optional reason. Alternative `reminder_phone` for minors/guardians

### Modified Capabilities
- `patient-crud`: Patient create/edit form gains WhatsApp opt-out toggle (Switch), opt-out reason (Textarea, conditional), and alternative reminder phone field (Input)

## Impact

- **Dependencies:** `twilio` (Node.js SDK for Channels Senders API and Content API)
- **Routes:** `src/app/(app)/configuracoes/integracoes/whatsapp/page.tsx`, `src/app/(app)/configuracoes/lembretes/templates/page.tsx`, `src/app/(app)/configuracoes/lembretes/templates/[templateKey]/page.tsx`
- **New module:** `src/modules/whatsapp/` (server/, components/, lib/, index.ts)
- **DB schema:** New file `src/shared/db/schema/whatsapp/tables.ts` + `policies.ts` + `index.ts`; migration adding columns to `patients`
- **Env vars:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (server-only, validated by Zod env module)
- **Performance:** Template list queries indexed on (user_id, template_key); account lookup indexed on (user_id). Both are small-cardinality tables
- **LGPD:** Consent checkbox in connection dialog; opt-out persisted with timestamp; no PII logged
