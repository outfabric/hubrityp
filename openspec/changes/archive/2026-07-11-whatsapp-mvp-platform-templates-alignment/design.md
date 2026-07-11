# Design — WhatsApp MVP Platform Templates Alignment

## Context

The reminders pipeline (dispatcher cron → `whatsapp/reminder.send` fan-out → sender → Twilio) was built for a per-psychologist template model: it reads the template body + Content SID from `message_templates`, renders `{variable}` placeholders locally via a 12-variable PT dictionary, and passes both the rendered body and a `contentVariables` JSON (keyed by the PT names) to Twilio. The platform has since moved to the shared-number MVP: 4 real Content templates registered once in the shared Twilio WABA, using **named variables** (`{{first_name}}`, `{{professional_name}}`, `{{date}}`, `{{time}}`, `{{session_link}}`) and quick-reply buttons with IDs (`confirm` / `cancel`) on `lembrete_24h` only.

Twilio contract (verified against Twilio docs, errors 92007/63028):
- `ContentVariables` must be a JSON **string** of key→value pairs whose keys match the template's variable definition. Mismatched keys → error 63028; malformed JSON, null/empty values, or newlines in values (WhatsApp) → error 92007.
- Quick-reply button clicks arrive on the inbound webhook with `ButtonText` (the label) **and** `ButtonPayload` (the ID defined in the Content Template Builder). `ButtonPayload` is the stable identifier.

Current defects this change fixes: wrong `contentVariables` keys (nothing would substitute), webhook button matching by exact `ButtonText` with an accent-less constant (`'Nao posso comparecer'`) that can never match the real label, a paid template (`confirmacao_recebida`) sent inside a guaranteed-open service window, and a reachable template-edit surface that overwrites the platform Content SID with no rollback.

## Goals / Non-Goals

**Goals:**

- Reminder/cancellation sends produce `contentVariables` that exactly match the 4 real platform templates (named keys, BRT formats).
- Send path independent of `message_templates` (Content SIDs from `serverEnv`; no local body rendering).
- `confirmacao_recebida` sent free-form (window guaranteed open); key fully removed from the template model (enum, seed, labels, env, DB rows + CHECK).
- Quick-reply classification by `ButtonPayload` ID.
- Templates tab hidden in `/configuracoes/lembretes` when `NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED` is off.
- `whatsapp_messages.body = NULL` on template sends (LGPD minimization); history UI derives display from `template_key` + status.

**Non-Goals:**

- URL-gating `/configuracoes/lembretes/templates*` or guarding `updateTemplateImpl` server-side (documented future work; nav entry hidden is the MVP mitigation).
- Requiring `meta_status='approved'` in the dispatch path (obsolete once SIDs come from env; noted for the future multi-tenant model).
- Multi-tenant senders, per-psychologist Content SIDs, `termo_consentimento` sending, template editing UX.
- Changing the public `/confirmar-sessao/[token]` route or the agenda confirmation flow outside WhatsApp.

## Decisions

### D1 — Platform template contract as a single code module

Create `src/modules/whatsapp/lib/reminders/platform-template-contract.ts`: one declarative map `templateKey → { envVar, variables: [{ name, resolve }] }` covering the 4 keys. `buildContentVariables(templateKey, ctx)` returns `Record<string, string>` with the named keys:

| templateKey | named variables (exactly) |
|---|---|
| `lembrete_24h` | `first_name`, `professional_name`, `date`, `time` |
| `lembrete_2h` | `first_name`, `professional_name`, `time` |
| `link_video` | `first_name`, `professional_name`, `date`, `time`, `session_link` |
| `cancelamento_aviso` | `first_name`, `professional_name`, `date`, `time` |

Formats: `date` = `dd/MM/yyyy`, `time` = `HH:mm`, both via `formatInTimeZone(..., 'America/Sao_Paulo')` (reuse the existing date-fns-tz approach from `select-template-variables.ts`). The builder **throws** if any resolved value is empty and **strips newlines** from values (Twilio 92007 rules). The 12-variable PT dictionary (`template-variables.ts`) stays only as documentation/UI metadata for the future editing surface — it no longer feeds outbound sends.

*Alternative considered*: adapt `select-template-variables.ts` in place. Rejected — its shape (kind→PT-keys, location/valor/duration inputs) is the old model; a fresh, minimal contract file is smaller than the diff to retrofit it, and deleting the old path outright keeps one source of truth.

### D2 — Content SID resolved from `serverEnv` at the dispatcher; slimmer fan-out event

`resolvePlatformContentSid(templateKey)` moves out of `seed-default-templates.ts` into the contract module and is used by the dispatcher (and cancellation sender). `fetchTemplate` and the `templateBody` event field are deleted. `ReminderSendEventData` drops `templateBody`, `confirmationLink`, `sessionValue`, `locationName`, `locationAddress`, `locationArrivalInstructions`, `sessionDurationMinutes` (no template consumes them anymore) and keeps identity/timing fields + `videoLink`. Env vars for the 4 SIDs remain `z.string().min(1)` (boot-validated, always present); `TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA` is deleted from `schemas.ts`, `.env.example`, docker compose, CI and e2e env blocks.

*Alternative considered*: resolve SID in the sender instead of the dispatcher. Equivalent in capability; dispatcher chosen because it already owns template selection (`KIND_TO_TEMPLATE_KEY`) and the event contract stays "everything needed to send".

Seeding still creates the 4 reminder template rows (display copy for the future editing surface, `meta_status='approved'`, `meta_template_id` = platform SID) + `termo_consentimento` (`pending`, null SID) — 5 rows total. Rows are informational; the send path never reads them.

### D3 — `link_video` send is skipped when `session_link` cannot be resolved

The old path let `renderTemplate` throw `MissingTemplateVariableError` at the sender. New behavior: the dispatcher already resolves `videoLink` via `fetchVideoLinksBatch`; when it is null for an online session whose `video` reminder is due, the dispatcher **skips emitting** that event for this cron tick and logs a structured warning (`event: 'video_link_unavailable'`, sessionId only). The next 5-minute tick retries naturally (idempotency key only exists after a successful queue/send). Empty-string substitution is never sent (92007).

### D4 — Confirmation ack becomes free-form with a code-constant body

`confirmation-ack-sender` stops reading `message_templates` and calls the existing `sendFreeText` adapter. Body constant (module-level, pt-BR):
`Obrigado, {first_name}! Sua presença na sessão com {professional_name} está confirmada.` — rendered with the same `renderTemplate` helper (kept for free-form use), consent footer appended on first outbound message as today. `whatsapp_messages` row keeps `body` = the actual sent text (free-form → faithful record; the NULL rule applies only to template sends) and `template_key = NULL`. Idempotency key stays `sessionId:confirmed_ack`. The `valor` variable from the old template body is dropped — a thank-you ack does not need billing info, and `sessionValue` leaves the event payload.

*Alternative considered*: configurable body in DB. Rejected — MVP has no editing surface; a constant is the honest representation.

### D5 — Option B removal of `confirmacao_recebida` from the template model

- `templateKeySchema`: 6 → 5 keys (`lembrete_24h`, `lembrete_2h`, `cancelamento_aviso`, `link_video`, `termo_consentimento`). TypeScript propagates the removal through labels/dictionary (compile errors are the checklist).
- Drizzle migration (forward-only, destructive by design):
  1. `DELETE FROM message_templates WHERE template_key = 'confirmacao_recebida';` (platform-seeded copies; no legitimate user customization exists in the MVP)
  2. Drop + recreate the `message_templates.template_key` CHECK with the 5 remaining keys.
  - `whatsapp_messages.template_key` has **no CHECK** (verified in schema) — historical ack rows keep their value; no backfill.
- Rollback strategy: re-adding the key + re-seeding is cheap (seed is idempotent per user only when count=0, so rollback would need a targeted re-insert script — acceptable; documented in the migration header).

### D6 — Webhook quick-reply classification by `ButtonPayload`

`classifyPayload` matches `params.ButtonPayload === 'confirm' | 'cancel'` (constants `BUTTON_ID_CONFIRM` / `BUTTON_ID_CANCEL`). No `ButtonText` fallback: the IDs are set by us in the Content Template Builder and are the stable contract; label text is copy and must never be load-bearing. A payload with `ButtonPayload` set but unrecognized falls through to the existing `inbound_text` path (safe default: lands in the inbox, no state mutation). Handlers stay untouched — they are already idempotent (first click acts, duplicates skip) and keyed by `OriginalRepliedMessageSid`.

### D7 — `body = NULL` on template sends; history derives display

`reminder-sender` and `cancellation-notice-sender` insert `whatsapp_messages` rows with `body: null` (column already nullable; FTS uses `coalesce(body,'')`). Anywhere the UI renders an outbound message with `body IS NULL` and a non-null `template_key`, it displays the `TEMPLATE_LABELS` label (e.g. "Lembrete 24h") + delivery status instead of message text. This applies to the Histórico surface and the inbox thread (inbox is flag-off in the MVP but must not render blank bubbles when enabled later). Template sends become non-searchable by content in FTS — accepted (their content is boilerplate).

### D8 — Templates tab hidden by the connection flag

`LembretesTabs` (client component) filters the `TABS` array: the `templates` entry is included only when `clientEnv.NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED` is true — imported from `@/shared/env/client` (the leaf, **never** the `@/shared/env` barrel, which is server-only and breaks `next build` from client components). Fully hidden per user decision — not the "Em breve" disabled pattern used for cards/menu. Routes stay reachable by direct URL (explicit non-goal).

### D9 — LGPD consent footer applies to free-form sends only

Discovered while writing the deltas: the footer never actually reached patients on template sends — Twilio ignores the `body` parameter when `contentSid` is present, and the old code appended the footer to that ignored fallback. Template copy is Meta-approved and immutable, so a runtime footer on template sends is impossible by design. Decision: the consent-footer rule (RF-04.20) applies **only to free-form outbound messages** (confirmation ack, inbox replies); any disclosure text required on reminder templates must be part of the registered Content template copy (platform responsibility, outside code). The sender drops the `consentFooter`/`bodyRendered` params from `sendTemplate`.

## Risks / Trade-offs

- **[Named keys drift from the real Twilio templates]** → the contract lives in exactly one module; error 63028 surfaces via the status webhook + reconciliation poller as `failed` messages. Add a pre-deploy manual checklist item: compare `platform-template-contract.ts` against the Content Template Builder definitions (variables cannot be asserted in CI without hitting Twilio).
- **[Destructive migration]** → deletes only platform-seeded `confirmacao_recebida` rows; explicitly approved in exploration. Migration header documents the targeted re-insert path for rollback.
- **[Edit surface still reachable by URL]** → accepted MVP risk (non-goal), nav entry hidden; future change adds route gating + server-side guard. Registered in proposal.
- **[Skipping video sends on missing room]** → a room that never gets created means no `link_video` message at all; mitigated by structured warning logs and the telepsicologia auto-lifecycle owning room creation ahead of the reminder window.
- **[Event contract change (`ReminderSendEventData`)]** → dispatcher and sender deploy atomically (same app); in-flight Inngest events during deploy may carry the old shape — sender reads only fields present in both shapes or tolerates extras; removed fields are unused by the new sender, so old events remain processable.
- **[E2E/CI env drift]** → removing `TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA` must land in every env block (CI, e2e build, docker compose, `.env.example`) in the same PR; a stale required var aborts Next page-data collection in the e2e build.

## Migration Plan

1. Ship code + Drizzle migration in one PR (migration runs via `npm run db:migrate`).
2. Deploy config: remove `TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA` from Vercel/env stores; confirm the 4 remaining SIDs match the Content Template Builder.
3. Post-deploy verification: trigger a staging reminder → assert Twilio accepts (no 63028/92007), quick-reply confirm → session confirmed + free-form ack received.

## Open Questions

_None — all product decisions were resolved in exploration (named variables confirmed; body NULL confirmed; tab fully hidden confirmed; URL-gating deferred)._
