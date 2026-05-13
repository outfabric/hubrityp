## ADDED Requirements

### Requirement: Psychologist can connect a WhatsApp Business number via Twilio

The system SHALL allow the psychologist to connect their WhatsApp Business phone number through the Twilio Channels Senders API. The connection flow is: (1) psychologist enters phone number (E.164) and display name in a dialog, (2) system registers a sender via Twilio API, (3) Twilio sends a verification code via SMS, (4) psychologist enters the code, (5) system completes verification and persists the account. A LGPD consent checkbox MUST be checked before proceeding.

#### Scenario: Successful WhatsApp connection

- **WHEN** psychologist enters phone "+5511987654321", display name "Dra. Ana Silva", checks the LGPD consent checkbox, and clicks "Continuar"
- **THEN** system calls Twilio to create a sender, shows the verification code input, and after psychologist enters the correct code, system saves a `whatsapp_accounts` row with provider="twilio", status="active", phone_number="+5511987654321", display_name="Dra. Ana Silva", connected_at=now, consent_given_at=now

#### Scenario: Connection rejected without LGPD consent

- **WHEN** psychologist fills phone and display name but does not check the LGPD consent checkbox
- **THEN** the "Continuar" button is disabled and connection cannot proceed

#### Scenario: Invalid phone number rejected

- **WHEN** psychologist enters phone "11987654321" (missing country code) and clicks "Continuar"
- **THEN** system shows inline validation error "Telefone inválido. Use o formato +55 (DD) NNNNN-NNNN."

#### Scenario: Twilio API failure during sender creation

- **WHEN** psychologist submits valid data but Twilio API returns an error
- **THEN** system shows toast error "Não foi possível conectar o WhatsApp. Tente novamente." and does not create a database row

#### Scenario: Incorrect verification code

- **WHEN** psychologist enters an incorrect verification code
- **THEN** system shows inline error "Código incorreto. Verifique e tente novamente."

#### Scenario: Default templates are seeded on first connection

- **WHEN** psychologist completes WhatsApp connection for the first time (no existing templates)
- **THEN** system creates 6 default templates (lembrete_24h, lembrete_2h, confirmacao_recebida, cancelamento_aviso, link_video, termo_consentimento) with is_default=true and meta_status="pending"

#### Scenario: Reconnection does not re-seed templates

- **WHEN** psychologist disconnects and reconnects WhatsApp, and templates already exist
- **THEN** system does not create duplicate templates; existing templates are preserved

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
