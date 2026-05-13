## Why

When a patient receives a WhatsApp reminder and replies with free text instead of tapping a button, that message today lands in `whatsapp_messages` and goes nowhere — the psychologist has no way to see it, respond, or act on it. Worse, if the message contains words signaling psychological crisis ("me matar", "acabar com tudo"), the psychologist has no immediate alert. Meanwhile, psychologists lack visibility into how their reminder investment is performing: delivery rates, read rates, confirmation rates, and estimated cost.

This change closes the loop on the WhatsApp communication channel by giving psychologists a unified inbox for patient replies, risk-keyword detection with immediate in-app alerts, a reply mechanism respecting Meta's 24-hour session window, clinical-content blocking (LGPD/RN-04.07), full message history with search, and a monthly analytics dashboard with cost transparency.

## What Changes

- New columns on `whatsapp_messages`: `read_at_by_psychologist`, `resolved_at`, `risk_flag`, `risk_keywords` — enabling inbox state tracking and risk flagging
- New table `whatsapp_conversations` — derived aggregate per (user_id, patient_id) with last message preview, unread count, and risk flag, maintained by Inngest event handler
- Inngest event listener (`whatsapp.message.persisted`) that processes inbound free-text messages: runs risk-keyword detection, upserts conversation aggregate, sends in-app notification (danger variant when risk detected)
- Pure functions: `detect-risk-keywords` (PT-BR heuristic dictionary with accent/case normalization), `clinical-content-blocker` (blocks clinical content in outbound replies per RN-04.07), `format-conversation-time` (relative timestamp formatting)
- Server Actions for inbox: list conversations (paginated, filterable), get conversation thread (marks as read), send free-text reply (24h window enforcement + clinical content check), send template reply (fallback outside 24h), mark resolved, search message history (full-text + date range), get analytics summary (aggregations + estimated cost)
- Validators: free-text reply schema (with clinical-content refinement), search message schema
- Frontend: "Caixa de entrada" sidebar nav item with unread badge, two-column inbox page (conversation list + thread), risk alert banner, message composer with dual state (free text inside 24h / template outside), analytics/history page with summary cards and searchable table, risk keyword configuration in advanced settings
- Adenda to change 2 webhook handler: dispatch Inngest event `whatsapp.message.persisted` after persisting inbound free-text messages
- Adenda to change 2 Twilio adapter: new `sendFreeText` method for session-window replies

## Capabilities

### New Capabilities
- `whatsapp-inbox`: Unified inbox for patient free-text replies — conversation list with unread/risk indicators, threaded message view, free-text reply (within 24h session window), template reply (outside 24h), mark-as-read on open, mark-as-resolved action, clinical-content blocking on outbound messages
- `whatsapp-risk-detection`: Heuristic keyword detection for messages indicating psychological crisis (suicidal ideation, self-harm). Flags messages, alerts psychologist in-app with danger variant. Configurable keyword list. Explicitly does NOT auto-respond to patients
- `whatsapp-message-history`: Full-text search across message history by patient, date range, and content. Paginated results with status badges
- `whatsapp-analytics`: Monthly analytics dashboard — total sent, delivery rate, read rate, confirmation rate, failure count, estimated cost. Period filtering (current month, previous month, last 90 days, custom range)

### Modified Capabilities
- `app-shell`: Sidebar gains "Caixa de entrada" nav item with `MessageCircle` icon, positioned between "Pacientes" and "Agenda". Displays `Badge danger` with unread count when >0
- `whatsapp-webhook-receiver`: Webhook handler (from change 2) gains Inngest event dispatch (`whatsapp.message.persisted`) after persisting inbound free-text messages. This event triggers the inbox message-ingest pipeline

## Impact

- **Dependencies:** No new npm packages — uses existing `date-fns`/`date-fns-tz` (relative timestamps), Inngest (event processing), Drizzle (queries), Zod (validation)
- **Routes:** `src/app/(app)/caixa-de-entrada/page.tsx`, `src/app/(app)/configuracoes/lembretes/historico/page.tsx`
- **Module additions:** `src/modules/whatsapp/inngest/inbox/`, `src/modules/whatsapp/server/inbox/`, `src/modules/whatsapp/lib/inbox/`, `src/modules/whatsapp/components/inbox/`
- **DB schema:** New migration adding columns to `whatsapp_messages` and creating `whatsapp_conversations` table in `src/shared/db/schema/whatsapp/`
- **Env vars:** `TWILIO_WHATSAPP_TEMPLATE_PRICE_BRL` (default `0.10`, used for cost estimation only — not billing)
- **Performance:** `whatsapp_conversations` table avoids N+1 on inbox list (single indexed query). Full-text search uses Postgres `tsvector`/GIN index on `whatsapp_messages.body`. Conversation list paginated at 50 items
- **LGPD:** Clinical-content blocker prevents psychologists from inadvertently sending protected health information via WhatsApp (RN-04.07). Risk keyword detection processes message body server-side only — no PII logged, only keyword match flags stored
- **Coordination with change 2:** Requires webhook handler to emit `whatsapp.message.persisted` event and Twilio adapter to expose `sendFreeText` method
