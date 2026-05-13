## Context

This is the first of three changes implementing PRD 04 (Lembretes WhatsApp). It establishes the data layer and configuration UI: BSP connection, template management with Meta approval flow, and per-patient opt-out controls. The second change builds the Inngest-powered reminder engine, and the third adds inbox and analytics.

The PRD appendix A provides a SQL reference model. This design adapts it to Drizzle ORM conventions, the project's RLS patterns, and the strict scope boundaries between the three changes. Tables `whatsapp_messages` and `reminder_settings` belong to change 2 and are NOT created here.

## Goals / Non-Goals

**Goals:**
- Database schema for `whatsapp_accounts` and `message_templates` with owner-scoped RLS
- New columns on `patients` for opt-out and alternative reminder phone
- Twilio BSP connection lifecycle (start, complete, disconnect, health-check) via Twilio Channels Senders API
- Six default template seeding on first connection
- Template editing with automatic Meta re-submission via Twilio Content API
- Template rendering pure function reusable by change 2
- Integration page (Configuracoes > Integracoes > WhatsApp) with connection status
- Templates list and edit pages (Configuracoes > Lembretes > Templates)
- Opt-out toggle on patient create/edit form
- LGPD consent checkbox during WhatsApp connection

**Non-Goals:**
- **Reminder engine** (Inngest worker, scheduling, actual message sending) — deferred to change `whatsapp-reminders-engine`
- **`whatsapp_messages` table** (delivery log) — deferred to change `whatsapp-reminders-engine`
- **`reminder_settings` table** (timing configuration) — deferred to change `whatsapp-reminders-engine`
- **Webhooks** (delivery status, patient button clicks, "PARAR" handling) — deferred to change `whatsapp-reminders-engine`
- **Inbox** (conversation view, risk detection, free-text responses) — deferred to change `whatsapp-inbox-and-analytics`
- **Analytics** (delivery rates, costs, history search) — deferred to change `whatsapp-inbox-and-analytics`
- **Monthly consumption/cost display** (RF-04.04) — deferred to change `whatsapp-inbox-and-analytics` (requires message delivery data)

## Decisions

### 1. Twilio as sole BSP — provider column pinned to 'twilio'

**Chosen:** The `whatsapp_accounts.provider` column accepts only `'twilio'` (CHECK constraint) for MVP.

**Rationale:**
- Twilio is the only BSP with a first-class Node.js SDK, well-documented Channels Senders API for WhatsApp sender registration, and Content API for template management
- The PRD mentions `z_api` and `cloud_api` as alternatives but Twilio is explicitly named as the BSP (RF-04.02)
- The `provider` column exists so we can add BSPs later without migration, but the CHECK constraint prevents invalid values now
- Multi-BSP support is a "reversible later" decision — we can relax the CHECK constraint when needed

**Rejected alternatives:** Z-API (unofficial wrapper — ban risk per PRD §1), direct Cloud API (requires Facebook Business Manager setup the psychologist would need to do themselves, poor UX).

### 2. Connection flow via Twilio Channels Senders API (not OAuth)

**Chosen:** Server-side sender registration via `POST /v2/Channels/Senders` with the psychologist's phone number. The flow is: (1) psychologist enters their WhatsApp Business phone number in a dialog, (2) system calls Twilio to create a sender, (3) Twilio sends an SMS/WhatsApp verification code, (4) psychologist enters the code, (5) system completes verification and saves the account.

**Rationale:**
- The Twilio Channels Senders API is the current recommended approach for registering WhatsApp senders. It handles WABA (WhatsApp Business Account) creation and phone number registration in a single API call
- The response includes a `configuration.verification_method` (SMS or voice) and the sender enters `CREATING` status, then transitions to `ONLINE` after verification
- No OAuth redirect needed — the entire flow happens within our dialog via server-side API calls
- The psychologist's Twilio Account SID and Auth Token are configured as platform-level env vars (not per-psychologist) — HubrityP acts as a Tech Provider, owning the Twilio account and managing subaccounts or senders per psychologist

**Why not OAuth/QR:** The PRD says "OAuth/QR Code" but Twilio's actual API uses sender registration + SMS verification. We follow the real API pattern. If Meta Embedded Signup is later required, the `start-twilio-connection` action can be adapted.

### 3. Store `meta_status` locally instead of always querying Meta

**Chosen:** Cache the Meta approval status (`approved`, `pending`, `rejected`) in the `message_templates.meta_status` column. Update it on: (a) template creation/edit (set to `pending`), (b) explicit status check via `get-template-meta-status` action, (c) future webhook from Twilio (change 2).

**Rationale:**
- Querying Meta/Twilio for status on every template list render adds latency and API rate-limit risk
- The status changes infrequently (approval takes 5 min to 24h, then stays `approved` until re-edited)
- A `pending` badge on the template card communicates the state clearly without real-time polling
- The explicit "check status" action gives the psychologist control when they want an update
- Change 2 will add a Twilio status callback webhook that updates this column in real-time

**Trade-off:** Status can be stale if the webhook is not yet implemented (this change). The `get-template-meta-status` action is the manual refresh path until change 2 adds the webhook.

### 4. Dedicated page for template editing (not modal)

**Chosen:** Template editing at `/configuracoes/lembretes/templates/[templateKey]` as a full page, not a modal.

**Rationale:**
- Template bodies are long (up to 1024 chars) and need a large Textarea
- The editor includes a variable insertion panel and a live preview — this is "edição complexa" per DS rules
- DS rules explicitly state: "NÃO use modal para: wizards multi-passo, edição complexa — use página dedicada"
- A page also allows the browser's URL to be shared/bookmarked

**Rejected alternative:** Modal with scrollable body — violates DS rules, poor mobile UX.

### 5. Template seeding strategy — on first connection, not on signup

**Chosen:** Default templates are created when the psychologist first connects their WhatsApp account (inside `complete-twilio-connection`), not during signup.

**Rationale:**
- Templates are meaningless without a WhatsApp connection — seeding at signup would show "Em análise" badges with no path to resolution
- Seeding on connection allows immediate submission to Meta for approval
- If the psychologist disconnects and reconnects, the existing templates are kept (not re-seeded) — the action checks for existing rows before inserting
- The `is_default` flag distinguishes system-provided templates from psychologist-edited ones (not that psychologists can create new keys — they can only edit the body of existing templates)

### 6. LGPD consent flow during connection

**Chosen:** The connect dialog includes a mandatory checkbox: "Confirmo que tenho base legal para enviar lembretes de sessão aos meus pacientes via WhatsApp (execução de contrato e interesse legítimo, LGPD art. 7º, II e IX)." The connection cannot proceed without this checkbox.

**Rationale:**
- LGPD art. 7 requires a legal basis for data processing. The therapeutic contract provides the basis (execution of contract + legitimate interest), but the psychologist must acknowledge this
- The consent is stored in the `whatsapp_accounts` row via a `consent_given_at` timestamptz column
- This is NOT patient consent (that's handled by opt-out + first-message footer per RF-04.20, which is change 2 scope) — this is the psychologist's acknowledgment of their legal basis

### 7. Template variable dictionary as a fixed TypeScript constant

**Chosen:** The 12 template variables from PRD RF-04.08 are defined in `template-variables.ts` as a frozen constant with metadata: key, label (PT-BR), example value, and which templates require them.

**Rationale:**
- The variable set is fixed by the PRD and should not grow without a code change (new variables imply new data sources)
- A typed constant enables: (a) compile-time exhaustiveness checks, (b) validation that template bodies only reference known variables, (c) frontend rendering of the variable panel in the editor
- The render function uses this dictionary to substitute variables and to detect unknown/missing ones

### 8. `template_key` as a constrained enum, not free-form

**Chosen:** The `template_key` column is validated by Zod to be one of six fixed values. The DB CHECK constraint also enforces this.

**Rationale:**
- Psychologists cannot create new template types — they can only edit the body of the six system-defined templates (RF-04.07 says "substitui o template", not "cria do zero")
- A fixed enum prevents orphan keys and ensures the render engine always knows how to map variables
- If new template types are added in the future, both the Zod enum and the CHECK constraint need updating — this is intentional friction for a schema change

### 9. `reminder_phone` on patients — nullable, E.164 format

**Chosen:** A new `reminder_phone` column on `patients` stores an alternative phone number for WhatsApp reminders. When set, reminders go to this number instead of the patient's primary phone. Validated as E.164.

**Rationale:**
- PRD edge case: "Paciente menor de idade — lembrete vai para responsável" — the `reminder_phone` holds the guardian's number
- The column is on `patients` (not on `patient_guardians`) because the reminder engine (change 2) needs a single, quick lookup per patient
- When null, the engine falls back to the patient's primary phone

## Frontend — Design System Salvia

### Configuracoes > Integracoes > WhatsApp

**Page layout:**
- Title h1 "WhatsApp" (28px/600)
- Single `Card default` (border `border`, radius `xl`, padding `space-6`, shadow `xs`)
- Card header: `MessageCircle` icon (24px, `text-tertiary`) + h3 "Integração WhatsApp" (18px/600)

**States:**
- **Not connected:** Body text "Conecte seu número de WhatsApp Business para enviar lembretes automáticos aos pacientes." in body `text-secondary`. `Badge neutral` "Não conectado". `Button primary` "Conectar WhatsApp" with `MessageCircle` icon. Empty state pattern: icon + explanation + CTA
- **Connected:** `Badge success` "Conectado" (bg `success-50`, text `success-700`). Phone number formatted `+55 (11) 98765-4321` in body. Display name in body-sm `text-secondary`. Connected date in caption `text-tertiary` ("Conectado em 15 mai. 2026"). `Button danger` "Desconectar" with destructive confirmation via `AlertDialog`
- **Error:** `Badge danger` "Erro de conexão" (bg `danger-50`, text `danger-700`). Error description in body-sm `text-secondary`. `Button secondary` "Reconectar" with `RefreshCw` icon (note: `RefreshCw` is not in the DS icon map — use `Settings` icon or add via the MoreHorizontal fallback convention). Actually, use `Button primary` "Reconectar" since it's the primary action

### Connect WhatsApp Dialog

- shadcn `Dialog` (max-width 640px, radius `2xl`, padding `space-8`)
- Title h3 "Conectar WhatsApp" (18px/600)
- Step 1 — Consent + phone:
  - Body text explaining the connection process in body `text-secondary`
  - shadcn `Input` for phone number with mask `+55 (DD) NNNNN-NNNN`, label "Número do WhatsApp Business", helper text "Use o número que seus pacientes já conhecem" in body-sm `text-tertiary`
  - shadcn `Input` for display name, label "Nome de exibição", helper text "Nome que aparecerá para os pacientes" in body-sm `text-tertiary`
  - shadcn `Checkbox` + label: "Confirmo que tenho base legal para enviar lembretes de sessão aos meus pacientes via WhatsApp (LGPD art. 7º, II e IX)" in body-sm. Required — button disabled until checked
  - `Button primary` "Continuar" (disabled until checkbox + valid phone). Loading state
- Step 2 — Verification:
  - Body text: "Enviamos um código de verificação para o número informado." in body `text-secondary`
  - shadcn `Input` for verification code (6 digits), label "Código de verificação"
  - `Button primary` "Verificar e conectar". Loading state
  - `Button link` "Reenviar código" below, caption size
- Footer: "Cancelar" `Button ghost`
- Mobile: full-screen Sheet slide-up

### Configuracoes > Lembretes > Templates (list page)

**Page layout:**
- Title h1 "Templates de Mensagem" (28px/600)
- Subtitle in body `text-secondary`: "Edite os modelos de mensagem enviados aos pacientes. Alterações precisam ser aprovadas pelo WhatsApp."
- Grid of 6 template cards (2 columns desktop, 1 column mobile), gap `space-4`

**Template card:**
- `Card interactive` (border `border`, radius `xl`, padding `space-6`, hover border `border-strong`, cursor pointer)
- Template name as h4 (16px/500) — human-readable labels: "Lembrete 24h", "Lembrete 2h", "Confirmação recebida", "Aviso de cancelamento", "Link de vídeo", "Termo de consentimento"
- Preview of body truncated to 2 lines in body-sm `text-secondary`
- `Badge` for meta_status: `Badge success` "Aprovado" (success-50/success-700), `Badge warning` "Em análise" (warning-50/warning-700), `Badge danger` "Rejeitado" (danger-50/danger-700)
- `Button ghost` "Editar" with `Pencil` icon (16px), positioned at card footer-right
- Click on card navigates to edit page

### Template Edit Page (`/configuracoes/lembretes/templates/[templateKey]`)

**Page layout:**
- Breadcrumb: Configurações > Lembretes > Templates > [Template Name]
- Title h1 with template human-readable name (28px/600)
- Two-column layout on desktop (gap `space-8`), single column on mobile

**Left column — Editor:**
- `Card default` (radius `xl`, padding `space-6`)
- h3 "Texto da mensagem" (18px/600)
- shadcn `Textarea` (8 rows, max 1024 chars), label "Corpo do template", char counter in caption `text-tertiary` aligned right ("142 / 1024")
- Validation inline on blur: min 10 chars ("Texto muito curto. Mínimo 10 caracteres."), max 1024 ("Texto muito longo. Máximo 1024 caracteres."), unknown variable ("Variável {xyz} não reconhecida. Variáveis disponíveis: {nome_paciente}, {hora}, ..."). Error with `AlertCircle` in `danger-700`
- shadcn `Alert` variant warning (bg `warning-50`, text `warning-700`, icon `AlertTriangle`): "Após salvar, o texto será re-submetido ao WhatsApp e ficará em análise por até 24h."
- Footer: `Button primary` "Salvar e enviar para aprovação" with loading state. `Button secondary` "Cancelar" navigates back

**Right column — Variables panel:**
- `Card flat` (radius `xl`, padding `space-6`)
- h3 "Variáveis disponíveis" (18px/600)
- List of variables, each as: `Badge brand` (bg `brand-100`, text `brand-700`, radius `full`) showing `{nome_paciente}`. Clickable — inserts variable at cursor position in Textarea. Tooltip (on hover, desktop only) with example value: "Ex.: Maria". Gap between badges: `space-2`
- Below: live preview section
- h3 "Pré-visualização" (18px/600)
- `Card flat` with bg `surface-muted`, padding `space-4`, radius `lg`. Rendered template with example values in body. Variables substituted with example data shown in `text-primary`

### Patient Form — Opt-out Section

**Within the existing patient create/edit form**, after the contact section:
- Section label in caption-upper: "LEMBRETES WHATSAPP"
- shadcn `Switch` + label "Receber lembretes via WhatsApp" (default: on). Active: brand state. Helper text in body-sm `text-tertiary`: "Quando desativado, nenhum lembrete será enviado a este paciente"
- When switch is OFF, conditionally show:
  - shadcn `Textarea` (2 rows), label "Motivo (visível só para você)", optional, in body-sm. Placeholder "Ex.: Paciente não quer receber mensagens"
- shadcn `Input` for `reminder_phone`, label "Telefone alternativo para lembretes", optional, helper text "Use para enviar lembretes ao responsável (ex.: pai/mãe de menor)" in body-sm `text-tertiary`. Mask `+55 (DD) NNNNN-NNNN`. Validation E.164

### Accessibility

- Connect dialog: focus trap, Escape closes, focus moves to phone input on open
- Template edit: Textarea has `aria-describedby` linking to char counter and error message. Variable badges have `role="button"` and `aria-label="Inserir variável {nome_paciente}"`
- Opt-out switch: `aria-checked` state, `aria-label="Receber lembretes via WhatsApp"`, conditional fields announced via `aria-live="polite"`
- All standalone icons: `aria-hidden="true"`
- Focus ring: `shadow-focus` on all interactive elements

### Dark Mode

All tokens reference CSS variables with `[data-theme='dark']` overrides. No hardcoded colors. Badge semantic backgrounds use the dark-mode equivalents automatically.

### Microcopy (Glossary)

- "Lembrete" (never "notificação")
- "Configurações" (never "preferências")
- "Template" / "Modelo de mensagem" (interchangeable, but prefer "template" in technical context, "modelo de mensagem" in user-facing copy)
- "Conectar" / "Desconectar" (not "vincular" / "desvincular")
- "Em análise" (not "pendente" for Meta status)
- Buttons with verb in infinitive: "Conectar WhatsApp", "Salvar e enviar para aprovação", "Desconectar"

## Risks / Trade-offs

- **[Twilio API key management]** — The current design uses a single Twilio account (platform-level env vars) with per-psychologist senders. If scaling to thousands of psychologists, Twilio subaccounts may be needed to isolate billing and rate limits. For MVP, single-account is simpler. The `whatsapp_accounts.account_id` stores the Twilio sender SID, enabling future migration to subaccounts.
- **[Meta approval latency]** — Template approval takes 5 minutes to 24 hours. During this window, the psychologist cannot send reminders using the edited template. Mitigation: the UI clearly communicates "Em análise" status and the alert before saving. The previous approved version is NOT preserved (the edit replaces the template) — if rejected, the psychologist must edit again. Change 2 should refuse to send with `pending` or `rejected` templates.
- **[No real-time status webhook in this change]** — Without the webhook (change 2), template meta_status can become stale. The manual `get-template-meta-status` action exists as a stopgap. Documented as limitation.
- **[Twilio Content API vs direct Meta Graph API]** — We use Twilio's Content API as an abstraction over Meta's template API. This adds a dependency layer but simplifies auth (same Twilio credentials) and ensures compliance with Twilio's wrapper conventions. If Twilio's Content API has limitations (e.g., slow to support new template types), we'd need to consider direct Meta Graph API calls — but this is unlikely for standard text templates.
- **[Patient opt-out stored on patients table]** — Adding 3 columns to `patients` creates coupling between the patient module and WhatsApp. Alternative was a separate `patient_whatsapp_preferences` table, but the additional JOIN complexity for the reminder engine (change 2) outweighs the modularity benefit. The columns are nullable with safe defaults.
