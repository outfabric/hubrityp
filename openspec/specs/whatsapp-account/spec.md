## Requirements

### Requirement: Psychologist can connect a WhatsApp Business number via Twilio

In the shared-number MVP, the system SHALL NOT expose an interactive per-psychologist WhatsApp connection flow. The Twilio Channels/Senders registration and SMS verification steps are frozen behind a feature flag (see `whatsapp-ui-feature-flag`). Instead, the `whatsapp_accounts` row is provisioned automatically and lazily when the psychologist first saves reminder settings with LGPD consent (see `whatsapp-shared-number-provisioning`). The provisioned account points to the platform number; `account_id`/`phone_number` reflect platform values and are reserved for a future multi-number model. LGPD consent is captured on the reminder settings screen (see `whatsapp-reminder-settings`), not in a connection dialog.

#### Scenario: Connection UI is frozen in the MVP

- **WHEN** a psychologist opens the WhatsApp integration area with the connection UI flag disabled
- **THEN** the "Conectar WhatsApp" entry point is rendered frozen (non-navigable, `aria-disabled`, "Em breve") and no Twilio sender registration can be initiated from the UI

#### Scenario: Account created lazily instead of via connection dialog

- **WHEN** a psychologist saves reminder settings with consent for the first time
- **THEN** a `whatsapp_accounts` row is provisioned with `provider="twilio"`, `status="active"`, platform-derived `phone_number`, `display_name` from `profiles.full_name`, and `consent_given_at=now` — without any SMS verification step

#### Scenario: No per-psychologist sender verification

- **WHEN** the account is provisioned
- **THEN** the system does not call the Twilio Channels/Senders API and does not send or verify an SMS code

### Requirement: Psychologist can view WhatsApp connection status

The system SHALL display the current WhatsApp connection status on the integration page under Configuracoes > Integracoes > WhatsApp. Status is one of: not connected, connected (with phone number, display name, connection date), or error.

#### Scenario: Not connected state

- **WHEN** psychologist navigates to Configuracoes > Integracoes > WhatsApp and has no whatsapp_accounts row (or status="disconnected")
- **THEN** system shows Badge neutral "Não conectado", explanatory text, and "Conectar WhatsApp" primary button

#### Scenario: Connected state

- **WHEN** psychologist has a whatsapp_accounts row with status="active"
- **THEN** system shows Badge success "Conectado", formatted phone number, display name, connected date, and "Desconectar" danger button

#### Scenario: Error state

- **WHEN** psychologist has a whatsapp_accounts row with status="error"
- **THEN** system shows Badge danger "Erro de conexão", error description, and "Reconectar" primary button

### Requirement: Psychologist can disconnect WhatsApp

The system SHALL allow the psychologist to disconnect their WhatsApp integration. Disconnection is a soft operation: the `whatsapp_accounts` row is kept (for audit history) with status changed to "disconnected". Templates are preserved. A confirmation dialog is required before disconnecting.

#### Scenario: Successful disconnection

- **WHEN** psychologist clicks "Desconectar" and confirms in the AlertDialog
- **THEN** system updates whatsapp_accounts.status to "disconnected" and the page shows the "not connected" state

#### Scenario: Disconnection preserves templates

- **WHEN** psychologist disconnects WhatsApp
- **THEN** the message_templates rows remain in the database unchanged

#### Scenario: Disconnection preserves the account row

- **WHEN** psychologist disconnects WhatsApp
- **THEN** the whatsapp_accounts row is NOT deleted; it remains with status="disconnected" for audit trail

### Requirement: System can health-check the WhatsApp connection

The system SHALL provide a `health-check-whatsapp` Server Action that queries Twilio for the sender's current status, updates `last_health_check_at`, and sets `status` to "error" if Twilio reports the sender is offline. This action is callable manually and will be used by a cron job in change 2.

#### Scenario: Health check on active connection

- **WHEN** health-check runs and Twilio reports sender status "ONLINE"
- **THEN** system updates last_health_check_at to now, status remains "active"

#### Scenario: Health check detects error

- **WHEN** health-check runs and Twilio reports sender status "OFFLINE" or "ERROR"
- **THEN** system updates status to "error" and last_health_check_at to now

#### Scenario: Health check on disconnected account

- **WHEN** health-check is called for a whatsapp_accounts row with status="disconnected"
- **THEN** system skips the Twilio API call and returns the current status without update

### Requirement: Only one WhatsApp account per psychologist

The system SHALL enforce a UNIQUE constraint on `whatsapp_accounts.user_id`. A psychologist cannot have multiple active WhatsApp connections.

#### Scenario: Attempt to create second account

- **WHEN** psychologist already has a whatsapp_accounts row and tries to start a new connection
- **THEN** system shows error "Você já tem um número conectado. Desconecte o atual antes de conectar outro."

### Requirement: RLS enforces owner-scoped access on whatsapp_accounts table

The system SHALL enable RLS on `whatsapp_accounts` using `user_id = auth.uid()`. A psychologist can only read and modify their own WhatsApp account.

#### Scenario: Cross-psychologist access is blocked

- **WHEN** psychologist A queries the whatsapp_accounts table
- **THEN** only rows belonging to psychologist A are returned

#### Scenario: Insert with mismatched user_id is blocked

- **WHEN** a request attempts to INSERT a whatsapp_accounts row with user_id different from auth.uid()
- **THEN** the insert is rejected by RLS policy

### Requirement: whatsapp_accounts provider is constrained to 'twilio'

The system SHALL enforce a CHECK constraint on `whatsapp_accounts.provider` allowing only the value `'twilio'` for MVP. The status column SHALL be constrained to `'active'`, `'disconnected'`, or `'error'`.

#### Scenario: Invalid provider rejected

- **WHEN** an insert attempts provider="z_api"
- **THEN** the CHECK constraint rejects the insert

#### Scenario: Invalid status rejected

- **WHEN** an update attempts status="suspended"
- **THEN** the CHECK constraint rejects the update
