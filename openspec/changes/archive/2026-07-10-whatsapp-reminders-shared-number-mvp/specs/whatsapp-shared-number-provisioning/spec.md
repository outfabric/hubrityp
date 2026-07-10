## ADDED Requirements

### Requirement: Platform uses a single shared WhatsApp number for all psychologists

The system SHALL send all WhatsApp reminder and acknowledgment messages from a single platform-owned number configured in `serverEnv.TWILIO_WHATSAPP_FROM`. Per-psychologist sender numbers SHALL NOT be provisioned in the MVP. The `whatsapp_accounts.account_id` and `whatsapp_accounts.phone_number` columns SHALL reflect the platform number and are reserved for a future multi-number model.

#### Scenario: Outbound reminder sent from the platform number

- **WHEN** the reminder sender dispatches a template message for any psychologist
- **THEN** the message is sent with `from = whatsapp:${serverEnv.TWILIO_WHATSAPP_FROM}`, regardless of the psychologist's `whatsapp_accounts` row

#### Scenario: No per-psychologist Twilio sender registration occurs

- **WHEN** a psychologist enables reminders
- **THEN** the system does NOT call the Twilio Channels/Senders API and does NOT perform SMS verification of any psychologist-owned number

### Requirement: WhatsApp account is provisioned lazily on first reminder settings save

The system SHALL create the psychologist's `whatsapp_accounts` row on demand, the first time they save reminder settings with LGPD consent granted (see `whatsapp-reminder-settings`). The insert MUST be idempotent and race-safe using `INSERT ... ON CONFLICT (user_id) DO NOTHING`. The created row MUST have `provider='twilio'`, `status='active'`, `account_id`/`phone_number` derived from the platform number, `display_name` from the psychologist's `profiles.full_name`, and `consent_given_at = NOW()`. Authentication MUST use `supabase.auth.getUser()` and the `user_id` MUST come from the session, never from client input.

#### Scenario: First consented save provisions the account

- **WHEN** a psychologist with no `whatsapp_accounts` row saves reminder settings with `consent = true`
- **THEN** the system inserts one `whatsapp_accounts` row scoped to `user_id = session.user.id`, with `status='active'` and `consent_given_at` set to the current time

#### Scenario: Subsequent saves do not duplicate the account

- **WHEN** a psychologist who already has a `whatsapp_accounts` row saves reminder settings again
- **THEN** no new account row is created (`ON CONFLICT (user_id) DO NOTHING`) and the existing `consent_given_at` is preserved

#### Scenario: Concurrent first saves do not violate the unique constraint

- **WHEN** two save requests for the same psychologist without an account run concurrently
- **THEN** exactly one `whatsapp_accounts` row exists afterward and neither request fails with an unhandled `23505` error

#### Scenario: Account is not provisioned without consent

- **WHEN** reminder settings are saved without LGPD consent granted
- **THEN** no `whatsapp_accounts` row is created and `consent_given_at` is never written

### Requirement: Default templates are seeded during lazy provisioning with platform Content SIDs

The system SHALL seed the psychologist's default message templates during lazy provisioning, populating `message_templates.meta_template_id` with the platform Content SIDs read from environment variables and `meta_status = 'approved'` (see `whatsapp-templates`). Seeding MUST be idempotent. Without a non-null `meta_template_id`, the reminders dispatcher cannot send, so seeding MUST complete as part of the same first-save flow that creates the account.

#### Scenario: Templates seeded with approved platform Content SIDs

- **WHEN** the account is lazily provisioned for a psychologist with zero existing templates
- **THEN** the reminder templates are created with `meta_template_id` equal to the corresponding platform Content SID from env and `meta_status='approved'`

#### Scenario: Dispatcher can send immediately after provisioning

- **WHEN** provisioning completes for a psychologist with an upcoming eligible session
- **THEN** `fetchActivePsychologists` includes the psychologist and `fetchTemplate` returns a non-null `contentSid` for the relevant reminder kind

### Requirement: Platform Content SIDs are provided via server-only environment variables

The system SHALL read the platform Content SIDs from server-only environment variables validated by Zod at boot: `TWILIO_CONTENT_SID_LEMBRETE_24H`, `TWILIO_CONTENT_SID_LEMBRETE_2H`, `TWILIO_CONTENT_SID_LINK_VIDEO`, `TWILIO_CONTENT_SID_CONFIRMACAO_RECEBIDA`, `TWILIO_CONTENT_SID_CANCELAMENTO_AVISO`. These variables MUST NOT use the `NEXT_PUBLIC_` prefix and MUST be accessed only through `serverEnv`.

#### Scenario: Missing Content SID fails boot validation

- **WHEN** any required `TWILIO_CONTENT_SID_*` variable is absent at boot
- **THEN** the Zod env validation fails and the application does not start with an incomplete configuration

#### Scenario: Content SIDs never reach the client bundle

- **WHEN** the client bundle is built
- **THEN** no `TWILIO_CONTENT_SID_*` value is present in client-side code (server-only access via `serverEnv`)
