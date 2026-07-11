# WhatsApp MVP — Platform Templates Alignment

## Why

The WhatsApp reminders MVP uses a single platform sender and fixed platform-owned templates, but the codebase still carries the pre-shared-number model: reminder sends build `contentVariables` from a 12-variable PT dictionary that does not match the 4 real Content templates registered in Twilio (named variables `first_name`, `professional_name`, `date`, `time`, `session_link`), the template-editing surface is reachable and can overwrite the platform Content SID without rollback (silently breaking reminders), the confirmation acknowledgment wastes money as a paid Meta template even though the 24h service window is guaranteed open, and the webhook classifies quick-reply buttons by exact label text — a match that is already broken today (`'Nao posso comparecer'` without the accent never matches the real "Não posso comparecer" button).

## What Changes

- **Reminder sends adapt to the real platform Content templates**: `contentVariables` are built with the named variables each template declares (`lembrete_24h`: first_name, professional_name, date, time · `lembrete_2h`: first_name, professional_name, time · `link_video`: + session_link · `cancelamento_aviso`: first_name, professional_name, date, time), with `date` formatted `DD/MM/AAAA` and `time` formatted `HH:MM` in `America/Sao_Paulo`. The Content SID is resolved directly from `serverEnv` by `template_key`; the send path no longer reads `message_templates` (no `fetchTemplate`, no local `renderTemplate`, no `templateBody` in the fan-out event).
- **`confirmacao_recebida` is no longer a Meta template** — the ack only fires after an inbound quick-reply (24h window open), so it is sent as a free-form message via the existing `sendFreeText` adapter with its body as a code constant. **BREAKING**: the key is removed from `templateKeySchema` (6 → 5), from the seed, from labels, and `TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA` is removed from the env schema; a data migration deletes existing `message_templates` rows for the key and recreates the CHECK constraint.
- **`whatsapp_messages.body` is stored as `NULL` for template sends** (LGPD data minimization): the column stays (inbound messages, free-form outbound, and full-text search depend on it), and history/inbox UIs derive the display for template sends from `template_key` + status.
- **Confirmation link leaves the reminder path**: the real 24h template carries quick-reply buttons (`confirm` / `cancel` button IDs) instead of a `{link_confirmacao}` variable; the dispatcher stops resolving `confirmationToken` into the event payload. The public `/confirmar-sessao/[token]` route is untouched.
- **Webhook classifies quick-replies by `ButtonPayload`** (the button ID defined in the Content Template Builder, echoed back by Twilio) instead of exact `ButtonText` matching. Fixes the latent accent bug and decouples classification from button copy.
- **Templates tab is hidden in the MVP**: the "Templates" tab in `/configuracoes/lembretes` is rendered only when `NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED` is on (fully hidden, not the "Em breve" disabled pattern used for cards/menu items).
- **Documented as future work (NOT implemented here)**: URL-gating of `/configuracoes/lembretes/templates*` routes and a server-side guard in `updateTemplateImpl` when the connection flag is off; requiring `meta_status='approved'` before dispatch. Until then the destructive edit surface remains reachable by direct URL — accepted risk for the MVP, mitigated by hiding the navigation entry point.

## Capabilities

### New Capabilities

_None — every behavior change amends an existing capability._

### Modified Capabilities

- `whatsapp-reminders-dispatch`: sender builds named `contentVariables` matching the real platform templates (per-key variable contract, BRT date/time formats); Content SID resolved from env by `template_key`; local body rendering and `templateBody`/`confirmationLink` removed from the send path; `whatsapp_messages.body` recorded as `NULL` on template sends.
- `whatsapp-templates`: seed drops from six to five keys (no `confirmacao_recebida`); template bodies stored in `message_templates` are display-only and no longer feed the send path; the 12-variable dictionary no longer drives outbound `contentVariables`.
- `whatsapp-confirmation-flow`: the confirmation acknowledgment is sent as a free-form message (code-constant body) instead of an approved template; patient confirmation/cancellation is triggered by quick-reply button IDs.
- `whatsapp-webhook-receiver`: interactive button replies are classified by `ButtonPayload` (`confirm` / `cancel`), never by button label text.
- `whatsapp-shared-number-provisioning`: platform Content SID env set shrinks to four (`LEMBRETE_24H`, `LEMBRETE_2H`, `LINK_VIDEO`, `CANCELAMENTO_AVISO`); seeding stamps only those four.
- `whatsapp-ui-feature-flag`: the connection flag's template-editing surface rule becomes "Templates tab fully hidden" (nav entry removed, not disabled-with-badge).
- `whatsapp-message-history`: history rows for template sends have `body = NULL`; the history UI derives the row display from `template_key` + delivery status.

## Impact

- **Backend**: `src/modules/whatsapp/inngest/reminders-dispatcher.ts`, `reminder-sender.ts`, `cancellation-notice-sender.ts`, `confirmation-ack-sender.ts`; `src/modules/whatsapp/lib/` (template-key-schema, template-labels, template-variables, reminders/select-template-variables); `src/modules/whatsapp/server/seed-default-templates.ts`, `adapters/twilio-bsp.ts`; `src/app/api/webhooks/twilio/whatsapp/route.ts`; `src/shared/env/` (schemas + example env, CI/e2e env blocks); Drizzle migration (delete `confirmacao_recebida` rows, recreate `message_templates.template_key` CHECK).
- **Frontend**: `src/app/(app)/configuracoes/lembretes/lembretes-tabs.tsx` (flag-gated tab); history UI display derivation for `body = NULL` rows.
- **External**: 4 Content templates already registered in the shared Twilio WABA with named variables and quick-reply button IDs (`confirm`/`cancel` on `lembrete_24h` only). Twilio contract verified: `ContentVariables` must be a JSON string whose keys match the template's variable definition (error 63028 on mismatch); the quick-reply button ID arrives in the `ButtonPayload` webhook field.
- **Ops/BREAKING**: deploy environments must drop `TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA` and keep the remaining four SIDs; the data migration is destructive for `confirmacao_recebida` template rows (platform-seeded copies — no legitimate user customization exists in the MVP).
- **Tests**: unit (variable mapping/formatting, webhook classification, schema changes), integration (dispatcher→sender contract with env SIDs, ack free-form persistence, migration/CHECK, seed), and e2e-seeded (lembretes tabs visibility per flag, history rendering) — each test task interleaved immediately after the code task that motivates it.
