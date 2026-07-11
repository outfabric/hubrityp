## Requirements

### Requirement: System seeds five default message templates during lazy provisioning

The system SHALL create five default templates when the psychologist first saves reminder settings with LGPD consent (lazy provisioning — see `whatsapp-shared-number-provisioning`): `lembrete_24h`, `lembrete_2h`, `link_video`, `cancelamento_aviso`, and `termo_consentimento`. Each template has: `template_key` (enum), `body` (PT-BR display copy), `variables` (JSONB array), `is_default=true`. The four reminder templates SHALL be stamped with the platform Content SID from the corresponding `TWILIO_CONTENT_SID_*` env var and `meta_status='approved'`; `termo_consentimento` stays `pending` with a null SID. Template rows are display-only: the send path never reads them. Seeding MUST be idempotent. `confirmacao_recebida` MUST NOT be seeded (it is a free-form message, not a template).

#### Scenario: First consented reminder save seeds five templates

- **WHEN** a psychologist saves reminder settings with consent for the first time and has zero existing templates
- **THEN** exactly five template rows are created (`lembrete_24h`, `lembrete_2h`, `link_video`, `cancelamento_aviso`, `termo_consentimento`) and none has key `confirmacao_recebida`

#### Scenario: Reminder templates stamped with the four platform Content SIDs

- **WHEN** the `lembrete_24h`, `lembrete_2h`, `link_video`, and `cancelamento_aviso` templates are seeded
- **THEN** each has `meta_template_id` equal to the platform Content SID from the corresponding env var and `meta_status="approved"`

#### Scenario: Seed is idempotent

- **WHEN** seed-default-templates is called but templates already exist for this user
- **THEN** no new templates are created; existing ones are unchanged

### Requirement: template_key enum has five values enforced by CHECK constraint

The system SHALL restrict `templateKeySchema` and the `message_templates.template_key` CHECK constraint to exactly five values: `lembrete_24h`, `lembrete_2h`, `cancelamento_aviso`, `link_video`, `termo_consentimento`. A migration SHALL delete existing `message_templates` rows with `template_key = 'confirmacao_recebida'` (platform-seeded copies, no user customization exists in the MVP) and recreate the CHECK. `whatsapp_messages.template_key` has no CHECK constraint and historical rows keep their values.

#### Scenario: confirmacao_recebida rejected by schema and CHECK

- **WHEN** an insert or Zod parse attempts `template_key = 'confirmacao_recebida'`
- **THEN** the Zod enum rejects it and the recreated CHECK constraint rejects the insert

#### Scenario: Migration removes existing confirmacao_recebida template rows

- **WHEN** the migration runs on a database with seeded `confirmacao_recebida` rows in `message_templates`
- **THEN** those rows are deleted and the remaining five keys per user are untouched

#### Scenario: Historical whatsapp_messages rows are preserved

- **WHEN** the migration runs on a database with `whatsapp_messages` rows where `template_key = 'confirmacao_recebida'`
- **THEN** those message rows are not modified or deleted

### Requirement: Psychologist can list their message templates

The system SHALL display all message templates belonging to the authenticated psychologist. Each template shows its human-readable name, a preview of the body text, and a badge indicating the Meta approval status.

#### Scenario: List templates after provisioning

- **WHEN** psychologist navigates to Configuracoes > Lembretes > Templates (connection flag on)
- **THEN** system displays 5 template cards with names ("Lembrete 24h", "Lembrete 2h", "Aviso de cancelamento", "Link de vídeo", "Termo de consentimento"), body previews (truncated to 2 lines), and status badges

#### Scenario: Status badge reflects meta_status

- **WHEN** template has meta_status="approved"
- **THEN** card shows Badge success "Aprovado"
- **WHEN** template has meta_status="pending"
- **THEN** card shows Badge warning "Em análise"
- **WHEN** template has meta_status="rejected"
- **THEN** card shows Badge danger "Rejeitado"

#### Scenario: Templates ordered by template_key

- **WHEN** psychologist lists templates
- **THEN** templates are ordered in a stable, deterministic order (by template_key alphabetically)

### Requirement: Psychologist can view a single template by key

The system SHALL allow fetching a single template by its template_key for the authenticated psychologist.

#### Scenario: Get template by key

- **WHEN** psychologist requests template with key "lembrete_24h"
- **THEN** system returns the template with full body, variables, meta_status, and is_default flag

#### Scenario: Get template with nonexistent key

- **WHEN** psychologist requests template with key "nonexistent"
- **THEN** system returns not-found error

### Requirement: Psychologist can edit a template body

In the shared-number MVP, per-psychologist template body editing SHALL be frozen behind a feature flag (see `whatsapp-ui-feature-flag`). Because all psychologists share the same Meta-approved platform Content SIDs, editing the body per psychologist would diverge from the approved template that Twilio actually sends. The template edit entry point MUST be rendered frozen (non-navigable, `aria-disabled`, "Em breve") and the edit Server Action MUST NOT be reachable from the UI while frozen. Template text customization is deferred to a post-MVP change.

#### Scenario: Template edit UI is frozen

- **WHEN** a psychologist attempts to reach the template edit screen with the connection/template flag disabled
- **THEN** the edit entry point is frozen (non-navigable, `aria-disabled`, "Em breve") and no body edit can be submitted from the UI

#### Scenario: Shared Content SID is the source of truth for sends

- **WHEN** a reminder is dispatched
- **THEN** the message is sent using the platform Content SID (`meta_template_id`), so per-psychologist body text is not the sent content in the MVP

### Requirement: Psychologist can check Meta approval status

The system SHALL provide a `get-template-meta-status` Server Action that queries Twilio's Content API for the current approval status of a template and updates the local `meta_status` column.

#### Scenario: Status check updates to approved

- **WHEN** psychologist triggers status check and Twilio reports "approved"
- **THEN** system updates meta_status to "approved" and the badge changes to success

#### Scenario: Status check confirms still pending

- **WHEN** psychologist triggers status check and Twilio reports "received" (pending)
- **THEN** meta_status remains "pending"

#### Scenario: Status check reveals rejection

- **WHEN** psychologist triggers status check and Twilio reports "rejected"
- **THEN** system updates meta_status to "rejected" and the badge changes to danger

### Requirement: Template rendering substitutes variables correctly

The system SHALL provide a pure function `renderTemplate(body, vars)` that replaces `{variable_name}` placeholders in the template body with the corresponding values from the vars object. Missing required variables throw an error. Unknown variables in the body (not in the dictionary) are left as literal text with a warning. Extra variables in vars that are not in the body are silently ignored.

#### Scenario: All variables substituted

- **WHEN** renderTemplate is called with body "Oi, {nome_paciente}! Sessão às {hora}." and vars {nome_paciente: "Maria", hora: "14:00"}
- **THEN** result is "Oi, Maria! Sessão às 14:00."

#### Scenario: Missing required variable throws

- **WHEN** renderTemplate is called with body "Oi, {nome_paciente}!" and vars {} (missing nome_paciente)
- **THEN** function throws an error indicating "nome_paciente" is required

#### Scenario: Extra vars in input are ignored

- **WHEN** renderTemplate is called with body "Oi, {nome_paciente}!" and vars {nome_paciente: "Maria", hora: "14:00"}
- **THEN** result is "Oi, Maria!" — the extra {hora} in vars is silently ignored

#### Scenario: Body with no variables renders unchanged

- **WHEN** renderTemplate is called with body "Obrigada por confirmar!" and vars {}
- **THEN** result is "Obrigada por confirmar!"

#### Scenario: Idempotent rendering

- **WHEN** renderTemplate is called twice with the same inputs
- **THEN** both calls return the identical result

### Requirement: Template variable dictionary contains all PRD RF-04.08 variables

The system SHALL define a fixed dictionary of 12 template variables with metadata: key, label (PT-BR), example value, and applicable template keys. The variables are: `nome_paciente`, `nome_completo`, `nome_psicologo`, `data`, `dia_semana`, `hora`, `duracao_min`, `endereco`, `instrucao_chegada`, `link_confirmacao`, `link_video`, `valor`. The dictionary is UI/documentation metadata for the future template-editing surface only — it MUST NOT drive outbound `contentVariables` (see `whatsapp-reminders-dispatch` platform template contract). No `applicableTemplates` entry references `confirmacao_recebida`.

#### Scenario: All 12 variables are present

- **WHEN** the template-variables module is loaded
- **THEN** exactly 12 variables are defined with keys matching PRD RF-04.08

#### Scenario: Each variable has required metadata

- **WHEN** any variable entry is inspected
- **THEN** it has key (string), label (PT-BR string), example (string), and applicableTemplates (array of template keys) — and no applicableTemplates array contains `confirmacao_recebida`

### Requirement: UNIQUE constraint on (user_id, template_key) in message_templates

The system SHALL enforce a UNIQUE constraint on `(user_id, template_key)` in the `message_templates` table. A psychologist cannot have two templates with the same key.

#### Scenario: Duplicate template key rejected

- **WHEN** an insert attempts to create a second "lembrete_24h" for the same user
- **THEN** the UNIQUE constraint rejects the insert

#### Scenario: Same key for different users is allowed

- **WHEN** psychologist A has "lembrete_24h" and psychologist B creates "lembrete_24h"
- **THEN** both inserts succeed (uniqueness is per-user)

### Requirement: RLS enforces owner-scoped access on message_templates table

The system SHALL enable RLS on `message_templates` using `user_id = auth.uid()`. A psychologist can only read and modify their own templates.

#### Scenario: Cross-psychologist template access is blocked

- **WHEN** psychologist A queries message_templates
- **THEN** only templates belonging to psychologist A are returned

#### Scenario: Update of another psychologist's template is blocked

- **WHEN** psychologist A attempts to update a template belonging to psychologist B
- **THEN** the update affects zero rows (RLS filters it out)

### Requirement: meta_status is constrained to valid values

The system SHALL enforce a CHECK constraint on `message_templates.meta_status` allowing only `'approved'`, `'pending'`, or `'rejected'`.

#### Scenario: Invalid meta_status rejected

- **WHEN** an update attempts meta_status="expired"
- **THEN** the CHECK constraint rejects the update
