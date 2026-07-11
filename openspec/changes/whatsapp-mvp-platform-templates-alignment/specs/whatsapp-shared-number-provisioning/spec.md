# whatsapp-shared-number-provisioning — Delta

## MODIFIED Requirements

### Requirement: Default templates are seeded during lazy provisioning with platform Content SIDs

The system SHALL seed the psychologist's default message templates during lazy provisioning, populating `message_templates.meta_template_id` with the platform Content SIDs read from environment variables and `meta_status = 'approved'` for the four reminder templates (`lembrete_24h`, `lembrete_2h`, `link_video`, `cancelamento_aviso`); `termo_consentimento` stays `pending` with a null SID and `confirmacao_recebida` is not seeded (see `whatsapp-templates`). Seeding MUST be idempotent. Template rows are display-only: the reminders dispatcher resolves Content SIDs directly from `serverEnv` and does not depend on the seeded rows to send.

#### Scenario: Templates seeded with the four approved platform Content SIDs

- **WHEN** the account is lazily provisioned for a psychologist with zero existing templates
- **THEN** the four reminder templates are created with `meta_template_id` equal to the corresponding platform Content SID from env and `meta_status='approved'`, and no `confirmacao_recebida` row is created

#### Scenario: Dispatcher can send immediately after provisioning

- **WHEN** provisioning completes for a psychologist with an upcoming eligible session
- **THEN** the dispatcher emits reminder events using the env Content SIDs regardless of the seeded rows' contents

### Requirement: Platform Content SIDs are provided via server-only environment variables

The system SHALL read the platform Content SIDs from server-only environment variables validated by Zod at boot: `TWILIO_CONTENT_SID_LEMBRETE_24H`, `TWILIO_CONTENT_SID_LEMBRETE_2H`, `TWILIO_CONTENT_SID_LINK_VIDEO`, `TWILIO_CONTENT_SID_CANCELAMENTO_AVISO`. `TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA` MUST NOT exist in the env schema (the acknowledgment is a free-form message). These variables MUST NOT use the `NEXT_PUBLIC_` prefix and MUST be accessed only through `serverEnv`.

#### Scenario: Missing Content SID fails boot validation

- **WHEN** any of the four required `TWILIO_CONTENT_SID_*` variables is absent at boot
- **THEN** the Zod env validation fails and the application does not start with an incomplete configuration

#### Scenario: Removed confirmacao_recebida SID is not required

- **WHEN** the environment does not define `TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA`
- **THEN** boot validation succeeds (the variable no longer exists in the schema)

#### Scenario: Content SIDs never reach the client bundle

- **WHEN** the client bundle is built
- **THEN** no `TWILIO_CONTENT_SID_*` value is present in client-side code (server-only access via `serverEnv`)
