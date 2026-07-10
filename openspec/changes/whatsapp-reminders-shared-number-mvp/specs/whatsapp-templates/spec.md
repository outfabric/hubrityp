## MODIFIED Requirements

### Requirement: System seeds six default message templates on first WhatsApp connection

The system SHALL create the default templates when the psychologist first saves reminder settings with LGPD consent (lazy provisioning — see `whatsapp-shared-number-provisioning`), not via a WhatsApp connection dialog. Each template has: `template_key` (enum), `body` (PT-BR text with variables), `variables` (JSONB array of variable names used in body), `is_default=true`. For the reminder templates used by the dispatcher (`lembrete_24h`, `lembrete_2h`, `confirmacao_recebida`, `cancelamento_aviso`, `link_video`), the system SHALL populate `meta_template_id` with the corresponding platform Content SID from environment variables and set `meta_status="approved"`. Seeding MUST be idempotent.

#### Scenario: First consented reminder save seeds templates

- **WHEN** a psychologist saves reminder settings with consent for the first time and has zero existing templates
- **THEN** the system creates the default templates with bodies matching PRD RF-04.06 and `is_default=true`

#### Scenario: Reminder templates seeded with platform Content SIDs and approved

- **WHEN** the `lembrete_24h`, `lembrete_2h`, `link_video`, `confirmacao_recebida`, and `cancelamento_aviso` templates are seeded
- **THEN** each has `meta_template_id` equal to the platform Content SID from the corresponding `TWILIO_CONTENT_SID_*` env var and `meta_status="approved"`

#### Scenario: Templates seeded with correct variable references

- **WHEN** the `lembrete_24h` template is seeded
- **THEN** its body contains variables like `{nome_paciente}`, `{data}`, `{hora}`, `{endereco}` and the variables JSONB lists all variables referenced in the body

#### Scenario: Seed is idempotent

- **WHEN** seed-default-templates is called but templates already exist for this user
- **THEN** no new templates are created; existing ones are unchanged

### Requirement: Psychologist can edit a template body

In the shared-number MVP, per-psychologist template body editing SHALL be frozen behind a feature flag (see `whatsapp-ui-feature-flag`). Because all psychologists share the same Meta-approved platform Content SIDs, editing the body per psychologist would diverge from the approved template that Twilio actually sends. The template edit entry point MUST be rendered frozen (non-navigable, `aria-disabled`, "Em breve") and the edit Server Action MUST NOT be reachable from the UI while frozen. Template text customization is deferred to a post-MVP change.

#### Scenario: Template edit UI is frozen

- **WHEN** a psychologist attempts to reach the template edit screen with the connection/template flag disabled
- **THEN** the edit entry point is frozen (non-navigable, `aria-disabled`, "Em breve") and no body edit can be submitted from the UI

#### Scenario: Shared Content SID is the source of truth for sends

- **WHEN** a reminder is dispatched
- **THEN** the message is sent using the platform Content SID (`meta_template_id`), so per-psychologist body text is not the sent content in the MVP
