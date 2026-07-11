# Tasks — whatsapp-mvp-platform-templates-alignment

> Test tasks are interleaved immediately after the code task that motivates them — implement them in order, never batch tests at the end.

## 1. Env cleanup + platform template contract (foundation)

- [x] 1.1 Remove `TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA` from `src/shared/env/schemas.ts` and every env block that defines it: `.env.example`, `docker-compose*.yml`, CI workflow env blocks (`.github/workflows/*`), and the e2e build env block — all in this task so no environment keeps a stale required var.
- [x] 1.2 Update existing env unit tests (`src/__tests__/unit/shared/env/**`) to assert the schema requires exactly the four remaining `TWILIO_CONTENT_SID_*` vars and no longer accepts/requires the removed one.
- [x] 1.3 Create `src/modules/whatsapp/lib/reminders/platform-template-contract.ts`: per-key named-variable map (`lembrete_24h`: first_name, professional_name, date, time · `lembrete_2h`: first_name, professional_name, time · `link_video`: + session_link · `cancelamento_aviso`: first_name, professional_name, date, time), `buildContentVariables(templateKey, ctx)` with `date`=`dd/MM/yyyy` and `time`=`HH:mm` via `formatInTimeZone(..., 'America/Sao_Paulo')`, throwing on empty values and stripping newlines; plus `resolvePlatformContentSid(templateKey)` reading the four SIDs from `serverEnv` (moved out of seed-default-templates).
- [x] 1.4 Unit tests for the contract (`src/__tests__/unit/modules/whatsapp/lib/reminders/platform-template-contract.test.ts`): exact key sets per template (no extra keys), first-name extraction, BRT formats, empty-value throw (missing session_link), newline stripping, SID resolution per key.

## 2. Template model — enum 5 keys, seed, migration

- [ ] 2.1 Remove `confirmacao_recebida` from `templateKeySchema` (`template-key-schema.ts`), `TEMPLATE_LABELS` (`template-labels.ts`), and every `applicableTemplates` array in `template-variables.ts`; follow the TypeScript compile errors until `npm run typecheck` is clean (do NOT touch `select-template-variables.ts` yet — it is deleted in 3.6).
- [ ] 2.2 Update existing unit tests for schema/labels/dictionary to the 5-key enum (no `confirmacao_recebida` anywhere; dictionary still has 12 variables as UI metadata).
- [ ] 2.3 Rework `seed-default-templates.ts`: seed exactly 5 rows (`lembrete_24h`, `lembrete_2h`, `link_video`, `cancelamento_aviso`, `termo_consentimento`), stamp the four reminder rows with SIDs via `resolvePlatformContentSid` from the contract module, keep idempotency; remove the local SID resolver.
- [ ] 2.4 Update/extend the seed integration test (`src/__tests__/integration/whatsapp/`): 5 rows created, no `confirmacao_recebida` row, four rows approved with env SIDs, `termo_consentimento` pending/null, idempotent re-run.
- [ ] 2.5 Drizzle migration: `DELETE FROM message_templates WHERE template_key = 'confirmacao_recebida'` + drop/recreate the `message_templates.template_key` CHECK with the 5 keys; migration header documents the destructive delete (platform-seeded copies) and the targeted re-insert rollback path; `whatsapp_messages` untouched.
- [ ] 2.6 Integration test for the migration state: inserting `template_key='confirmacao_recebida'` into `message_templates` is rejected by the CHECK; the 5 valid keys insert fine; a pre-existing `whatsapp_messages` row with `template_key='confirmacao_recebida'` survives and remains readable.

## 3. Send path — adapter, dispatcher, senders

- [ ] 3.1 Rework `twilio-bsp.ts` `sendTemplate`: input becomes `{ to, templateKey, contentSid, variables }`; send `contentSid` + `contentVariables: JSON.stringify(variables)` only — drop the `body`/`bodyRendered`/`consentFooter` params entirely (Twilio ignores body with contentSid; footer applies to free-form only, design D9); keep typed error mapping.
- [ ] 3.2 Update adapter unit tests: request carries named-key JSON string, no `body` param sent, error mapping unchanged.
- [ ] 3.3 Rework `reminders-dispatcher.ts`: resolve `contentSid` via `resolvePlatformContentSid`; delete `fetchTemplate`; slim `ReminderSendEventData` in `inngest/client.ts` (drop `templateBody`, `confirmationLink`, `sessionValue`, location fields, `sessionDurationMinutes`); skip `video` kind with structured warning (`event: 'video_link_unavailable'`, session UUID only) when the video link is unresolved so no idempotency record blocks the next tick.
- [ ] 3.4 Update dispatcher unit/integration tests: event payload shape (no body/link/value/location), SID from env regardless of `message_templates` contents (missing rows still dispatch), video-skip scenario (no event, retry next tick when room appears), all existing eligibility scenarios still green.
- [ ] 3.5 Rework `reminder-sender.ts`: build variables via `buildContentVariables`, call the slimmed `sendTemplate`, persist `whatsapp_messages` with `body: null` + `template_key`; remove `renderTemplate`/consent-footer logic from this path (footer is free-form-only per D9).
- [ ] 3.6 Delete `select-template-variables.ts` and its unit tests (superseded by the contract; `render-template.ts` stays — the ack uses it).
- [ ] 3.7 Integration test sender persistence: successful send inserts row with `body IS NULL`, correct `template_key`, `bsp_message_id`; idempotency short-circuit; non-retriable error path records `unable_to_send` with `body IS NULL`.
- [ ] 3.8 Rework `cancellation-notice-sender.ts`: variables via `buildContentVariables('cancelamento_aviso', ...)`, SID via `resolvePlatformContentSid`, stop reading `message_templates`, persist `body: null`.
- [ ] 3.9 Update cancellation sender integration test: named variables sent, `body IS NULL` row, opt-out and `cancelled_by='patient'` guards unchanged.

## 4. Confirmation ack — free-form

- [ ] 4.1 Rework `confirmation-ack-sender.ts`: module-level body constant (`Obrigado, {first_name}! Sua presença na sessão com {professional_name} está confirmada.`) rendered via `renderTemplate`, sent via `sendFreeText`; stop reading `message_templates`; persist row with `body` = sent text, `template_key: null`; keep idempotency (`sessionId:confirmed_ack`) and first-message consent footer.
- [ ] 4.2 Update ack integration test: free-form send (no contentSid), row has populated `body` and `template_key IS NULL`, works with zero `message_templates` rows, duplicate event short-circuits, footer on first outbound message only.

## 5. Webhook — ButtonPayload classification

- [ ] 5.1 Rework `classifyPayload` in `src/app/api/webhooks/twilio/whatsapp/route.ts`: match `params.ButtonPayload === 'confirm' | 'cancel'` (constants `BUTTON_ID_CONFIRM`/`BUTTON_ID_CANCEL`); remove the `ButtonText` constants; unrecognized `ButtonPayload` falls through to `inbound_text`.
- [ ] 5.2 Update webhook unit tests for classification: `ButtonPayload='confirm'` → button_confirm; `ButtonPayload='cancel'` → button_cancel; `ButtonPayload` set with any `ButtonText` (including re-worded/accented labels) classifies by payload only; unknown payload → inbound_text; status/PARAR/free-text classification unchanged.
- [ ] 5.3 Update webhook integration test (signature-valid POST → Inngest event): quick-reply with `ButtonPayload='confirm'` emits `whatsapp.confirmation.received`; `'cancel'` emits `whatsapp.cancellation.received`; unknown payload triggers the auto-reply/inbound path and returns 200.

## 6. Frontend — hidden Templates tab + history display

- [ ] 6.1 Gate the "Templates" tab in `lembretes-tabs.tsx`: filter the `TABS` array by `clientEnv.NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED` imported from `@/shared/env/client` (leaf import — never the `@/shared/env` barrel in a client component); fully hidden when off, no "Em breve" badge.
- [ ] 6.2 Unit (RTL) tests for `LembretesTabs`: flag off → only "Configuração" and "Histórico" rendered (no Templates element at all); flag on → three tabs; use `vi.stubEnv` + dynamic import to exercise both flag states (default-off flags freeze module-scope reads).
- [ ] 6.3 Derive display for template sends in the message-history/inbox rendering path: rows with `body IS NULL` and non-null `template_key` render `TEMPLATE_LABELS[template_key]` + delivery status, falling back to the raw key for historical values (e.g. `confirmacao_recebida`); rows with body keep rendering text; confirm the FTS query still uses `coalesce(body,'')`.
- [ ] 6.4 Unit tests for the display derivation: label rendering, raw-key fallback, free-form rows unchanged; integration test asserting search does not error on `body IS NULL` rows and does not match template sends by content.
- [ ] 6.5 E2E (seeded) spec for the lembretes tabs under the MVP flag config (connection off): `/configuracoes/lembretes` shows Configuração/Histórico only, no Templates tab element, and direct URL `/configuracoes/lembretes/templates` still responds (visual-only gating).

## 7. Docs and deploy notes

- [ ] 7.1 Add a short runbook note (`docs/runbooks/`) for the platform template contract: the named variables per template MUST match the Content Template Builder definitions; pre-deploy checklist (compare contract file vs Twilio console; confirm the four SIDs; verify template copy carries the required LGPD/PARAR disclosure text since the runtime footer no longer applies to template sends — design D9).
