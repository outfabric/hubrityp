## MODIFIED Requirements

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
