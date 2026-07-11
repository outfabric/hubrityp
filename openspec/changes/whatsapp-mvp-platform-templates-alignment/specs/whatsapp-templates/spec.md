# whatsapp-templates — Delta

## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Template variable dictionary contains all PRD RF-04.08 variables

The system SHALL define a fixed dictionary of 12 template variables with metadata: key, label (PT-BR), example value, and applicable template keys. The variables are: `nome_paciente`, `nome_completo`, `nome_psicologo`, `data`, `dia_semana`, `hora`, `duracao_min`, `endereco`, `instrucao_chegada`, `link_confirmacao`, `link_video`, `valor`. The dictionary is UI/documentation metadata for the future template-editing surface only — it MUST NOT drive outbound `contentVariables` (see `whatsapp-reminders-dispatch` platform template contract). No `applicableTemplates` entry references `confirmacao_recebida`.

#### Scenario: All 12 variables are present

- **WHEN** the template-variables module is loaded
- **THEN** exactly 12 variables are defined with keys matching PRD RF-04.08

#### Scenario: Each variable has required metadata

- **WHEN** any variable entry is inspected
- **THEN** it has key (string), label (PT-BR string), example (string), and applicableTemplates (array of template keys) — and no applicableTemplates array contains `confirmacao_recebida`

## REMOVED Requirements

### Requirement: System seeds six default message templates on first WhatsApp connection

**Reason**: `confirmacao_recebida` is no longer a template (sent free-form inside the open service window); the seed drops to five keys and template bodies became display-only copy.
**Migration**: Replaced by ADDED requirement "System seeds five default message templates during lazy provisioning" plus the enum/CHECK migration requirement.
