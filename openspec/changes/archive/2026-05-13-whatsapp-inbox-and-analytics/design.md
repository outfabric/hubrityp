## Context

This is the third of three changes implementing PRD 04 (Lembretes WhatsApp). It depends on both predecessors:

- **Change 1 (`whatsapp-foundation-and-templates`)** provides: `whatsapp_accounts`, `message_templates`, patient opt-out columns, `renderTemplate`, template variable dictionary, Twilio connection lifecycle, template CRUD.
- **Change 2 (`whatsapp-reminders-engine`)** provides: `whatsapp_messages` table (with direction/status/body columns), `reminder_settings`, `sessions.reminders_disabled`, `sessions.confirmed_at`, Inngest dispatcher/sender, Twilio adapter with `sendTemplate`, webhook handler at `src/app/api/webhooks/twilio/whatsapp/route.ts` that persists inbound free-text messages in `whatsapp_messages` (direction='inbound', body=text) but does NOT process them for inbox/risk.

This change consumes those structures and builds the post-processing layer: inbox UI, risk detection, reply mechanism, message history search, and analytics dashboard.

## Goals / Non-Goals

**Goals:**
- Unified inbox for patient free-text replies with conversation list, thread view, and unread tracking
- Risk-keyword detection (PT-BR heuristic) with immediate in-app danger alert to the psychologist (RF-04.19)
- Reply mechanism: free-text within Meta's 24-hour session window, template fallback outside it (RF-04.18, RN-04.05)
- Clinical-content blocking on outbound messages to prevent LGPD-violating clinical data over WhatsApp (RN-04.07)
- Mark-as-resolved workflow for conversation triage
- Full-text message history search by patient, date range, and content (RF-04.23)
- Monthly analytics dashboard: sent, delivered, read, confirmed, failed counts + estimated cost (RF-04.22)
- Configurable risk-keyword list for psychologist customization

**Non-Goals:**
- **AI/chatbot auto-response** — RF-04.19 explicitly prohibits automated patient responses. The system only alerts the psychologist
- **Clinical content via WhatsApp** — the blocker is a guard-rail heuristic, not a replacement for clinical judgment. Psychologists are educated, not technically prevented with 100% accuracy
- **Real-time chat** — the inbox is a triage/response tool, not a live chat. No typing indicators, no online status
- **Multimedia messages** — only text messages are processed in this change. Image/audio/document handling is deferred
- **Billing integration** — cost estimation uses a configurable env var price per template message, not real Twilio billing API data

## Decisions

### 1. `whatsapp_conversations` as a materialized aggregate table (not a view)

**Chosen:** Physical table `whatsapp_conversations` with UNIQUE(user_id, patient_id), maintained by the Inngest `inbox-message-ingest` event handler via upsert on every inbound message.

**Rationale:**
- The inbox list page needs fast reads: last message preview, unread count, has_risk flag, sorted by last_message_at. A real-time aggregate query over `whatsapp_messages` with GROUP BY would require scanning all messages per psychologist — unacceptable as message volume grows
- Postgres materialized views require explicit `REFRESH MATERIALIZED VIEW` which adds operational complexity and stale-data windows. A dedicated table with Inngest-driven upsert provides near-real-time consistency without cron refresh
- The upsert is idempotent: same message processed twice yields the same conversation state
- RLS is trivially `user_id = auth.uid()`, identical to the parent messages table

**Trade-off:** Data denormalization — `last_message_preview` and `unread_count` can theoretically drift from source if Inngest processing fails. Mitigation: the Inngest function retries on failure, and a future reconciliation cron can recompute from source if needed.

### 2. Risk-keyword detection: editable dictionary with regex, not ML

**Chosen:** Curated PT-BR keyword list stored as a pure function default, with psychologist-editable override stored in a future `risk_keywords_config` column or dedicated setting. Detection uses case-insensitive regex with accent normalization.

**Rationale:**
- ML models for suicide risk detection in PT-BR are not mature enough for clinical deployment, and false negatives could have life-threatening consequences. A keyword heuristic with known limitations is ethically preferable to an ML model that might inspire false confidence
- The keyword list is small (~30 terms with variations), so regex performance is negligible (<1ms per message)
- Psychologists can add domain-specific terms they encounter in their practice
- The system explicitly disclaims: "Heuristica — nunca substitui escuta clinica"

**Known limitations:**
- False positives: "matar saudade", "morrer de rir" — mitigated by checking word boundaries and common false-positive phrases
- False negatives: novel expressions, metaphors, coded language — acknowledged in the UI disclaimer. The system is a safety net, not a guarantee

### 3. 24-hour session window enforcement: server-side + client-side

**Chosen:** Dual enforcement. The client disables the free-text composer and shows an info alert when the last inbound message is >24h old. The server action `send-free-text-reply` independently verifies the window before sending.

**Rationale:**
- Meta enforces the 24-hour rule at the API level — sending outside the window results in an error. Client-side enforcement prevents wasted API calls and provides clear UX ("A janela de 24h expirou. Use um template aprovado.")
- Server-side enforcement is the authoritative check — never trust client-side gating for business rules. Even if the client-side check has a race condition (message arrives during composition), the server catches it
- The fallback path (template reply) reuses the existing `renderTemplate` and `sendTemplate` from changes 1/2, keeping the code DRY

### 4. Clinical-content blocker: heuristic pattern matching

**Chosen:** Pure function that scans outbound text for patterns indicating clinical content: diagnostic terms (CID-10 codes, DSM-5 references, named disorders), session content markers ("evolucao", "sessao de hoje", "resultado do teste"), psychometric references ("score", "percentil", "escala"). Returns `{ allowed: boolean, reason?: string }`.

**Rationale:**
- RN-04.07 requires the system to prevent clinical content over WhatsApp. A heuristic blocker catches the most common violations
- The blocker runs both as a Zod refinement (form validation) and as a server-side check (belt and suspenders)
- False positives (blocking legitimate administrative messages mentioning "teste") are preferable to false negatives (clinical data leaking via WhatsApp). The psychologist can rephrase
- No PII is logged — only the boolean result and the generic reason category

### 5. Full-text search: Postgres tsvector with GIN index

**Chosen:** Postgres native full-text search using `tsvector` column on `whatsapp_messages.body` with a GIN index, using the `portuguese` text search configuration for stemming.

**Rationale:**
- Message volume per psychologist is moderate (hundreds to low thousands per month). Postgres FTS handles this efficiently without external services (Elasticsearch, Meilisearch)
- The `portuguese` configuration provides stemming, accent normalization, and stop-word removal out of the box
- No additional infrastructure cost or operational complexity
- Search is scoped by RLS (`user_id = auth.uid()`), so the GIN index is combined with a B-tree on `user_id`

**Trade-off:** Postgres FTS is less sophisticated than dedicated search engines for fuzzy matching and typo tolerance. Acceptable for MVP — the primary use case is searching for a patient name or a keyword in message history.

### 6. Cost estimation via env var, not billing API

**Chosen:** Cost is estimated by multiplying template message count by `TWILIO_WHATSAPP_TEMPLATE_PRICE_BRL` (env var, default `0.10`). Displayed as "Custo estimado" with a disclaimer.

**Rationale:**
- Twilio's billing API requires additional OAuth scopes and returns data with delay. For an MVP analytics dashboard, a simple multiplication is sufficient
- The env var is easily updated when Twilio changes pricing
- The UI labels it "estimado" to set correct expectations. Future: integrate Twilio Usage API for precise billing

### 7. Two-column inbox layout (not page-per-conversation)

**Chosen:** Single page at `/app/caixa-de-entrada` with two columns: conversation list (left, 380px) and thread (right, flex). Mobile: list is default view, thread opens in bottom Sheet.

**Rationale:**
- Psychologists triage multiple conversations in sequence. A two-column layout lets them scan the list and read/respond without page navigation — matching the mental model of email/messaging apps they already use
- The list stays visible while reading a thread, enabling quick switching
- Mobile constraints require a different pattern: the Sheet overlay preserves the list underneath for easy "back" gesture
- DS allows Sheet for "details without losing context" — the thread is exactly that

### 8. Inngest event `whatsapp.message.persisted` as the integration point

**Chosen:** Change 2's webhook handler emits an Inngest event `whatsapp.message.persisted` after persisting an inbound free-text message. Change 3's `inbox-message-ingest` function listens to this event.

**Rationale:**
- Decouples the webhook handler (fast, must respond <2s per RNF-04.03) from the inbox processing (risk detection, conversation upsert, notification — which can take longer)
- Inngest provides retry semantics if inbox processing fails, without affecting webhook reliability
- The event payload includes `messageId`, `userId`, `patientId` — the listener fetches the full message from DB, avoiding large event payloads
- This is prescribed as a MODIFIED capability on `whatsapp-webhook-receiver` (change 2)

## Risks / Trade-offs

- **[Risk keyword false positives]** — Common phrases like "matar saudade" or "morrer de rir" may trigger false alerts. Mitigation: word-boundary regex, curated false-positive exclusion list, psychologist-editable keyword config, and explicit UI disclaimer that detection is heuristic
- **[Risk keyword false negatives]** — Novel expressions, coded language, or metaphors will not be caught. Mitigation: the system is positioned as a safety net ("nunca substitui escuta clinica"), not a diagnostic tool. Psychologists are trained to assess risk independently
- **[Clinical-content blocker over-blocking]** — Legitimate administrative messages may be blocked if they contain clinical-sounding terms. Mitigation: the blocker returns a reason, and the UI explains why the message was blocked with guidance to rephrase
- **[Conversation table drift]** — If Inngest processing fails or is delayed, `whatsapp_conversations` may be temporarily inconsistent with `whatsapp_messages`. Mitigation: Inngest retries with exponential backoff; worst case, a manual refresh action or future reconciliation cron resolves drift
- **[Privacy of message body in search index]** — The GIN index on message body stores tokenized text. This is within the same Postgres instance with RLS enforced, so access is scoped. No PII leaves the database. The search index does not log queries
- **[Inbox list performance at scale]** — A psychologist with hundreds of active conversations may experience slower list loads. Mitigation: pagination (50 per page), composite index on `(user_id, last_message_at DESC)`, and unread-first sorting option
