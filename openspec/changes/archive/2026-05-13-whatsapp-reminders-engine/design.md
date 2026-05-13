## Context

This is the second of three changes implementing PRD 04 (Lembretes WhatsApp). It depends on change 1 (`whatsapp-foundation-and-templates`) which provides:

- Tables: `whatsapp_accounts` (BSP connection per psychologist), `message_templates` (approved templates with Meta status)
- Columns on `patients`: `whatsapp_opt_out`, `whatsapp_opt_out_at`, `reminder_phone`
- Server Actions: `getWhatsappAccount(userId)`, `listTemplates(userId)`, `getTemplate(userId, templateKey)`
- Pure function: `renderTemplate({ body, vars })` in `src/modules/whatsapp/lib/render-template.ts`
- Dictionary: `template-variables.ts` with the 12 PRD variables

This change builds the sending engine, webhook receiver, and configuration UI. Change 3 (`whatsapp-inbox-and-analytics`) will add the inbox for free-text conversations, risk detection, message history/analytics, and cost dashboard — all explicitly out of scope here.

The existing `sessions` table (from `agenda-foundation-and-sessions`) already has `confirmed_at TIMESTAMPTZ` and the full status lifecycle (`scheduled`, `confirmed`, `done`, `cancelled`, `no_show`). The `agenda-session-status-flow` spec already defines Inngest event emission on status transitions (`agenda/session.cancelled`, `agenda/session.confirmed`). This change connects WhatsApp actions to those existing events.

## Goals / Non-Goals

**Goals:**
- Database schema for `reminder_settings` and `whatsapp_messages` with RLS and indexes
- `reminders_disabled` column on `sessions` for per-session override
- Pure functions: reminder window computation (with night-shift), template variable selection, idempotency key generation
- Twilio BSP adapter with structured error mapping
- Inngest cron dispatcher (every 5 min) and event-driven sender with 3x retry backoff
- Webhook Route Handler for delivery status, button replies, PARAR command, inbound text
- Confirmation flow: button reply updates session status, sends ack template, notifies psychologist
- Cancellation notice: when psychologist cancels, sends `cancelamento_aviso` to patient
- Consent footer on first message per patient (LGPD transparency)
- Reconciliation poller (every 30 min) for messages stuck in `queued`/`sent`
- Settings UI page for reminder windows
- Session form checkbox for per-session reminder suppression
- WhatsApp health banner when account is in error state

**Non-Goals:**
- **Inbox / conversations** — change 3 scope (free-text responses are persisted as `whatsapp_messages` with `direction='inbound'` but not displayed or processed beyond storage)
- **Analytics / cost dashboard** — change 3 scope
- **Risk keyword detection** — change 3 scope
- **Template editing / Meta re-approval flow** — change 1 scope
- **WhatsApp account connection / OAuth** — change 1 scope
- **Per-patient reminder override** — the opt-out columns (`whatsapp_opt_out`) are from change 1; this change reads them but does not provide UI to toggle them (that UI is in change 1's patient detail page)
- **SMS fallback** — post-MVP per PRD

## Decisions

### 1. Inngest cron + fan-out over Vercel Cron

**Chosen:** Inngest `createFunction` with `cron: "*/5 * * * *"` for the dispatcher, fanning out individual `whatsapp.reminder.send` events.

**Rationale:**
- Inngest provides durable execution with built-in retry, backoff, and step memoization — critical for reliable message delivery
- Fan-out pattern (dispatcher emits N events, each handled by a separate sender function) gives per-message isolation: one failure does not block others
- Vercel Cron has a 10-second execution limit on Hobby and 60s on Pro — insufficient for scanning potentially thousands of sessions and enqueueing sends
- Inngest's `step.run()` memoization means a retry of the sender function does not re-send a message that already succeeded at the Twilio call step
- Inngest idempotency keys (`idempotency: "event.data.idempotencyKey"`) provide a second layer of dedup at the platform level

**Trade-off:** Inngest free tier has a 25,000 step limit/month. A busy practice with 40 sessions/week generates ~320 reminder sends/month (2 reminders * 40 sessions * 4 weeks), well within limits. At scale (50k messages/day target per RNF-04.04), the paid tier is required.

### 2. Idempotency strategy: deterministic key + DB check + Inngest dedup

Three layers prevent duplicate sends:

1. **Deterministic idempotency key**: `sha256(sessionId + ":" + kind)` where kind is `early`, `final`, `video`, `cancellation`, `confirmed_ack`, `consent`. Same session + same kind always produces the same key.
2. **DB uniqueness check**: Before calling Twilio, the sender queries `whatsapp_messages` for an existing row with the same `idempotency_key` and `status != 'failed'`. If found, the step short-circuits.
3. **Inngest function-level idempotency**: The `idempotency` config on the sender function uses `event.data.idempotencyKey`, so Inngest itself deduplicates events with the same key within a 24h window.

**Why three layers:** Layer 1 is deterministic (no DB call). Layer 2 catches cases where the Inngest dedup window expired but the message was already sent. Layer 3 is the fastest (no code execution at all). Belt-and-suspenders for a use case where duplicates cause real patient annoyance.

The `idempotency_key` column is added to `whatsapp_messages` with a partial UNIQUE index (`WHERE status != 'failed'`) so that a failed attempt can be retried with the same key.

### 3. Twilio HMAC signature validation

The webhook Route Handler validates every incoming request using `twilio.validateRequest(authToken, signature, url, params)` from the Twilio Node.js SDK. The `TWILIO_AUTH_TOKEN` comes from `serverEnv`.

**Key detail:** Twilio signs against the *exact* URL including any query parameters. In Vercel deployments, the URL must match what Twilio has configured (including `https://` and the exact domain). The Route Handler reads the full URL from the request and compares. If validation fails, the handler returns 403 immediately.

**Why not raw HMAC:** The Twilio SDK's `validateRequest` handles the canonical parameter ordering and HMAC-SHA1 computation correctly, including edge cases with empty bodies and GET requests. Using the SDK avoids subtle bugs.

### 4. Night-shift strategy: defer to 07:00

When `send_during_night` is `false` (default), any reminder whose computed due time falls between 22:00 and 07:00 (America/Sao_Paulo) is deferred to 07:00 the same morning (or 07:00 the next day if the due time is before midnight but the session is the next day).

**Implementation:** The `computeReminderWindow` pure function returns the adjusted `dueAt` timestamps. The dispatcher cron picks them up at the next 5-minute tick after 07:00.

**Why not a separate "deferred queue":** The cron already runs every 5 minutes. Adjusting the due time in the pure function means the standard dispatcher flow handles deferred messages — no separate infrastructure needed.

### 5. Consent footer: inline in the first message body, not a separate template

**Chosen:** Append the consent footer text to the body of whichever template is sent first to a patient (usually `lembrete_24h`). Track "first message sent" via a query: `SELECT 1 FROM whatsapp_messages WHERE patient_id = $1 AND user_id = $2 AND direction = 'outbound' LIMIT 1`.

**Rationale:**
- A separate template requires Meta approval and adds a second message (cost + patient annoyance)
- WhatsApp Business API allows appending a footer to template messages (the `footer` parameter in the Twilio Content API)
- The consent text is short: "Voce esta recebendo essa mensagem de [Nome CRP X] via WhatsApp. Dados tratados conforme nossa Politica de Privacidade [link]. Para parar de receber, responda PARAR."
- After the first message, subsequent reminders omit the footer

**Trade-off:** The footer makes the first message longer. Acceptable because it is a one-time occurrence per patient and is legally required.

### 6. Webhook response time: parse + enqueue + 200 in <2s

The Route Handler does minimal synchronous work:

1. Read raw body (for HMAC validation)
2. Validate Twilio signature — reject 403 if invalid
3. Parse the payload (determine event type: status update, button reply, inbound text, PARAR)
4. Send the appropriate Inngest event (`whatsapp.status.updated`, `whatsapp.confirmation.received`, `whatsapp.cancellation.received`, `whatsapp.stop.received`, `whatsapp.inbound.received`)
5. Return 200 with empty body

All business logic (DB updates, template sends, notifications) happens in Inngest functions triggered by these events. This guarantees <2s response time (typically <200ms).

### 7. Reconciliation poller for stuck messages

An Inngest cron (`*/30 * * * *`) queries `whatsapp_messages` with `status IN ('queued', 'sent')` and `sent_at < NOW() - INTERVAL '5 minutes'`. For each, it calls the Twilio Messages API to fetch current status and updates the DB.

**Why polling:** Twilio webhooks can fail temporarily (network issues, Vercel cold starts). The poller is a safety net that catches messages whose status webhook was lost. It runs every 30 minutes to avoid API rate limits.

**Why not real-time only:** Real-time webhooks are the primary path (immediate status updates). The poller is defense-in-depth for the ~1% of webhooks that fail.

### 8. In-app notification for psychologist

When a patient confirms, cancels, or opts out via WhatsApp, the psychologist needs to be notified in-app. The system assumes a notification infrastructure exists (or will exist) with the following contract:

```typescript
type NotificationPayload = {
  userId: string;       // psychologist's user_id
  type: 'session_confirmed' | 'session_cancelled_by_patient' | 'patient_opted_out' | 'reminder_failed';
  title: string;        // PT-BR title
  body: string;         // PT-BR body
  actionUrl?: string;   // deep link (e.g., /app/agenda?session=<id>)
  metadata?: Record<string, string>;
};
```

**TODO for change 3 or a dedicated notifications change:** If the `notify(userId, payload)` helper does not exist at implementation time, create a minimal implementation that inserts into a `notifications` table (id, user_id, type, title, body, action_url, read_at, created_at) with RLS by user_id. The UI (bell icon + dropdown) can be built separately.

### 9. Handling duplicate Twilio webhooks

Twilio can send the same webhook multiple times (retry on timeout, network issues). The handler uses `bsp_message_id` as the deduplication key:

- **Status updates:** The handler updates `whatsapp_messages` using `WHERE bsp_message_id = $1`. Idempotent by nature — setting `delivered_at` or `read_at` twice to the same value is harmless. Status transitions are monotonic (queued -> sent -> delivered -> read), so a late "sent" arriving after "delivered" is ignored (only advance, never regress).
- **Button replies:** The handler checks if the session status has already been updated before processing. If `sessions.status` is already `confirmed` (for a confirm reply) or `cancelled` (for a cancel reply), the duplicate is a no-op.
- **Inbound messages:** The `bsp_message_id` column has a UNIQUE index. Duplicate inserts fail silently (ON CONFLICT DO NOTHING).

### 10. Schema location: `src/shared/db/schema/whatsapp/`

Both `reminder_settings` and `whatsapp_messages` are placed in `src/shared/db/schema/whatsapp/tables.ts`, extending the schema directory created by change 1 (which adds `whatsapp_accounts` and `message_templates` there). This keeps all WhatsApp-domain tables together, consistent with the `agenda/` and `patients/` patterns.

## Frontend — Design System Salvia

### Configuracoes > Lembretes (`/app/configuracoes/lembretes`)

**Page layout:**
- Title h1 "Configuracoes de Lembretes" (28px/600)
- Single `Card default` (border `border`, radius `xl`, padding `space-6`, shadow `xs`)
- Form sections separated by shadcn `Separator`:

**Section 1: "Lembrete antecipado"**
- Label in body (15px/400)
- shadcn `RadioGroup` with 4 options: "Nao enviar" / "24 horas antes" / "12 horas antes" / "48 horas antes"
- Helper text in `body-sm` `text-tertiary`: "Enviado com antecedencia para o paciente confirmar presenca"

**Section 2: "Lembrete final"**
- shadcn `RadioGroup`: "Nao enviar" / "2 horas antes" / "1 hora antes" / "30 minutos antes"
- Helper text: "Ultimo lembrete antes da sessao"

**Section 3: "Aviso de link de video (sessoes online)"**
- shadcn `Select`: "15 minutos antes" / "30 minutos antes" / "60 minutos antes" (default 30)
- Helper text: "Envia o link da sala virtual antes da sessao online"

**Section 4: "Enviar de madrugada (00h-07h)"**
- shadcn `Switch` (default OFF)
- Helper text in `body-sm` `text-tertiary`: "Por padrao, lembretes que cairiam entre 22h e 7h sao enviados as 7h da manha"

**Footer:**
- "Salvar" `Button primary` (loading state on async save)
- Toast Sonner success: "Configuracoes de lembretes salvas" with border-left `success-500`

**Responsive:** Mobile padding `space-4` on card. `RadioGroup` items stack vertically.

### Session form checkbox (modify `session-form-modal.tsx`)

- New `Checkbox` shadcn: "Nao enviar lembretes WhatsApp para esta sessao"
- Position: after "Observacao" field, gap `space-4`
- Visibility condition: patient has a phone number AND `whatsapp_opt_out` is `false`
- Helper text in `body-sm` `text-tertiary`: "Util quando o paciente avisou que nao pode receber"
- Controlled by `reminders_disabled` field in the session form schema

### WhatsApp health banner

- Position: top of `(app)` layout, above page content
- Condition: `whatsapp_accounts.status = 'error'` AND `reminder_settings` exists with at least one reminder enabled
- shadcn `Alert` variant danger: bg `danger-50`, text `danger-700`, icon `AlertTriangle` (20px)
- Text: "Sua conexao com WhatsApp expirou. Lembretes nao estao sendo enviados."
- Action: `Button link` "Reconectar" linking to `/configuracoes/integracoes/whatsapp`
- Dismiss: not dismissible (persistent until account status changes)

### Accessibility

- `RadioGroup` items: focusable via arrow keys, `aria-label` on group
- `Switch`: associated `Label` via `htmlFor`
- Health banner: `role="alert"`, `aria-live="assertive"`
- Checkbox in session form: associated label, focus ring `shadow-focus`
- All Lucide icons: `aria-hidden="true"` (decorative)

### Microcopy

- "Lembrete" (not "notificacao")
- "Salvar" (not "Confirmar e prosseguir")
- "Configuracoes" (not "Preferencias")
- "Sessao" throughout

## Risks / Trade-offs

- **[Inngest free tier limits]** — 25,000 steps/month. A psychologist with 40 patients/week uses ~320 reminder steps/month. At ~78 psychologists on free tier, the limit is hit. Mitigation: monitor usage; upgrade to Inngest paid tier when approaching limit. The architecture does not change.
- **[Twilio webhook reliability]** — Twilio retries webhooks up to 3 times with exponential backoff if it receives a non-2xx response or timeout. Combined with our reconciliation poller, message status should converge within 30 minutes at worst.
- **[Event ordering from Twilio]** — Twilio does not guarantee webhook order (a "read" event could arrive before "delivered"). Mitigation: status transitions are monotonic — the handler only advances status, never regresses. The `read_at` timestamp is set independently of `delivered_at`.
- **[Dead letter scenario]** — If all 3 Inngest retries fail (Twilio down for >20 min), the message is marked `failed` and the psychologist is notified. No automatic retry beyond the 3 attempts. Manual re-send via future inbox UI (change 3).
- **[Consent footer adds message length]** — The LGPD consent footer (~200 chars) is appended to the first message per patient. WhatsApp template messages have a body limit of 1024 characters. The longest template (`lembrete_24h` ~200 chars + footer ~200 chars) is well within limits.
- **[No notification system yet]** — The `notify()` helper may not exist. If absent, a minimal `notifications` table + insert helper is created as part of this change (see Decision 8). The UI for displaying notifications (bell icon) may need to be built in a parallel or subsequent change.
