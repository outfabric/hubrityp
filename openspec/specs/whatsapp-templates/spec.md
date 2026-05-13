## Requirements

### Requirement: System seeds six default message templates on first WhatsApp connection

The system SHALL create six default templates when the psychologist completes their first WhatsApp connection. Each template has: template_key (enum), body (PT-BR text with variables), variables (JSONB array of variable names used in body), is_default=true, meta_status="pending". The six template keys are: `lembrete_24h`, `lembrete_2h`, `confirmacao_recebida`, `cancelamento_aviso`, `link_video`, `termo_consentimento`.

#### Scenario: First connection seeds all 6 templates

- **WHEN** psychologist completes WhatsApp connection and has zero existing templates
- **THEN** system creates 6 rows in message_templates with correct bodies matching PRD RF-04.06, is_default=true, meta_status="pending"

#### Scenario: Templates seeded with correct variable references

- **WHEN** the lembrete_24h template is seeded
- **THEN** its body contains variables like `{nome_paciente}`, `{data}`, `{hora}`, `{endereco}` and the variables JSONB lists all variables referenced in the body

#### Scenario: Seed is idempotent

- **WHEN** seed-default-templates is called but templates already exist for this user
- **THEN** no new templates are created; existing ones are unchanged

### Requirement: Psychologist can list their message templates

The system SHALL display all message templates belonging to the authenticated psychologist. Each template shows its human-readable name, a preview of the body text, and a badge indicating the Meta approval status.

#### Scenario: List templates after connection

- **WHEN** psychologist navigates to Configuracoes > Lembretes > Templates
- **THEN** system displays 6 template cards with names ("Lembrete 24h", "Lembrete 2h", etc.), body previews (truncated to 2 lines), and status badges

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

The system SHALL allow the psychologist to replace the body text of an existing template. On save, the system: (1) validates the body (min 10, max 1024 chars), (2) validates that all `{variable}` references in the body are in the known variable dictionary, (3) updates the body and variables JSONB, (4) sets meta_status to "pending", (5) submits the updated template to Meta for re-approval via Twilio Content API.

#### Scenario: Successful template edit

- **WHEN** psychologist edits lembrete_24h body to "Oi, {nome_paciente}! Lembrando: sessão amanhã, {data}, às {hora}. Local: {endereco}. Confirma?" and clicks "Salvar e enviar para aprovação"
- **THEN** system updates the body, extracts variables [{nome_paciente}, {data}, {hora}, {endereco}] into variables JSONB, sets meta_status="pending", and submits to Meta

#### Scenario: Body too short

- **WHEN** psychologist enters body "Oi" (2 chars, below min 10)
- **THEN** system shows inline validation error "Texto muito curto. Mínimo 10 caracteres."

#### Scenario: Body too long

- **WHEN** psychologist enters body with 1025 characters
- **THEN** system shows inline validation error "Texto muito longo. Máximo 1024 caracteres."

#### Scenario: Unknown variable in body

- **WHEN** psychologist enters body containing "{nome_pet}" which is not in the variable dictionary
- **THEN** system shows inline validation error "Variável {nome_pet} não reconhecida."

#### Scenario: Edit sets meta_status to pending

- **WHEN** psychologist saves an edited template that was previously "approved"
- **THEN** meta_status changes to "pending" (re-approval required)

#### Scenario: Alert warns about re-approval delay

- **WHEN** psychologist is on the template edit page
- **THEN** an Alert warning is visible: "Após salvar, o texto será re-submetido ao WhatsApp e ficará em análise por até 24h."

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

The system SHALL define a fixed dictionary of 12 template variables with metadata: key, label (PT-BR), example value, and applicable template keys. The variables are: `nome_paciente`, `nome_completo`, `nome_psicologo`, `data`, `dia_semana`, `hora`, `duracao_min`, `endereco`, `instrucao_chegada`, `link_confirmacao`, `link_video`, `valor`.

#### Scenario: All 12 variables are present

- **WHEN** the template-variables module is loaded
- **THEN** exactly 12 variables are defined with keys matching PRD RF-04.08

#### Scenario: Each variable has required metadata

- **WHEN** any variable entry is inspected
- **THEN** it has key (string), label (PT-BR string), example (string), and applicableTemplates (array of template keys)

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
