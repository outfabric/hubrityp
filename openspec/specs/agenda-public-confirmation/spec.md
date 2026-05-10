# agenda-public-confirmation Specification

## Purpose

Public (unauthenticated) session confirmation page where patients can confirm or decline attendance via a unique token link, with token lifecycle management and security constraints.

## Requirements

### Requirement: System generates a unique confirmation token per session

The system SHALL generate a `confirmation_token` for sessions using `crypto.randomBytes(32).toString('base64url')` (43 characters, 256-bit entropy, URL-safe). The token is stored in `sessions.confirmation_token` (VARCHAR(64), UNIQUE). The token is generated at session creation or on-demand when the psychologist requests the confirmation link.

#### Scenario: Token is generated at session creation

- **WHEN** a new session is created with a patient (not a time block)
- **THEN** a unique `confirmation_token` is generated and stored on the session

#### Scenario: Token format is URL-safe

- **WHEN** a confirmation token is generated
- **THEN** the token contains only base64url characters (A-Z, a-z, 0-9, -, _) and is 43 characters long

#### Scenario: Token uniqueness is enforced at database level

- **WHEN** a duplicate token is somehow generated (statistically near-impossible)
- **THEN** the UNIQUE constraint on `confirmation_token` rejects the insert, and the system retries with a new token

### Requirement: Patient can confirm attendance via public link

The system SHALL serve a public page at `/confirmar-sessao/[token]` (no authentication required) where the patient sees session details (date, time, psychologist name) and can confirm attendance. Confirmation sets `confirmed_at`, changes status to `confirmed`, and emits a notification event.

#### Scenario: Patient opens valid confirmation link and confirms

- **WHEN** patient opens `/confirmar-sessao/{token}` for a `scheduled` session and clicks "Confirmar presenca"
- **THEN** `sessions.confirmed_at` is set to current timestamp, status changes to `confirmed`, a history entry is created with `performed_by='patient'`, and `agenda/session.confirmed` event is emitted

#### Scenario: Confirmation page shows session details

- **WHEN** patient opens a valid confirmation link
- **THEN** page displays: session date and time (formatted in pt-BR, timezone America/Sao_Paulo), psychologist name, and location (if present) with appropriate icon (MapPin for in-person, Monitor for online)

#### Scenario: Confirmation page does not expose clinical data

- **WHEN** patient opens a confirmation link
- **THEN** page shows ONLY session date/time, psychologist name, and location — no patient clinical data, notes, amount, or other sensitive fields

### Requirement: Patient can decline attendance via public link

The system SHALL allow the patient to indicate they cannot attend via the public confirmation page. Declining triggers a cancellation with `cancelled_by='patient'`, auto-calculates the notice period, and emits a cancellation event.

#### Scenario: Patient declines with optional reason

- **WHEN** patient clicks "Nao posso comparecer" and optionally enters a reason in the textarea, then clicks "Confirmar cancelamento"
- **THEN** session status changes to `cancelled`, `cancelled_by='patient'`, `cancellation_reason='patient_cancelled'`, `cancellation_notice` is auto-calculated, `cancelled_at=NOW()`, the optional reason text is stored in `cancellation_reason` metadata, and `agenda/session.cancelled` event is emitted

#### Scenario: Decline auto-calculates notice period

- **WHEN** patient declines a session that starts in 2 hours
- **THEN** `cancellation_notice` is set to `'less_24h'`

#### Scenario: Decline immediately notifies psychologist

- **WHEN** patient declines via the public page
- **THEN** `agenda/session.cancelled` event is emitted with `confirmedBy: 'patient'` for immediate downstream notification

### Requirement: Confirmation token expires after session start time

The system SHALL treat confirmation tokens as expired once the session's `start_at` has passed. Expired tokens show an expiration message and do not allow any action.

#### Scenario: Token accessed after session time

- **WHEN** patient opens `/confirmar-sessao/{token}` after the session's `start_at` has passed
- **THEN** page shows "Link expirado" with message "O horario desta sessao ja passou" and no action buttons

#### Scenario: Token accessed before session time

- **WHEN** patient opens `/confirmar-sessao/{token}` before the session's `start_at`
- **THEN** page shows the confirmation form with action buttons

### Requirement: Confirmation token is single-use after action

The system SHALL prevent repeated actions on the same confirmation token. After the patient confirms or declines, subsequent visits show a "already responded" message.

#### Scenario: Token already used for confirmation

- **WHEN** patient opens a confirmation link that was already used to confirm
- **THEN** page shows "Voce ja respondeu" with message "Esta confirmacao ja foi processada" and no action buttons

#### Scenario: Session cancelled before patient acts

- **WHEN** patient opens a confirmation link for a session that was already cancelled by the psychologist
- **THEN** page shows "Sessao cancelada" with message "Esta sessao foi cancelada pela sua psicologa"

#### Scenario: Invalid token shows error

- **WHEN** someone opens `/confirmar-sessao/invalid-token`
- **THEN** page shows "Link invalido" with message "Este link de confirmacao nao e valido"

### Requirement: Public confirmation page uses service-role for data access

The system SHALL use the Supabase service-role client (bypassing RLS) to read session data on the public confirmation page, since there is no authenticated user. The Server Component/Action filters ONLY by token and exposes only confirmation-relevant fields.

#### Scenario: Service-role reads session by token

- **WHEN** the public page server component loads
- **THEN** it queries sessions using service-role client with `WHERE confirmation_token = :token AND deleted_at IS NULL`

#### Scenario: Public page does not expose sensitive data

- **WHEN** session is loaded via service-role for the public page
- **THEN** only the following fields are returned to the page: session date/time, psychologist name, location name/type/instructions — not amount, notes, clinical data, or other patient data

### Requirement: RLS on sessions prevents unauthorized public access

The system SHALL ensure that RLS policies on `sessions` do NOT grant any access to unauthenticated users. The public confirmation page operates exclusively via service-role. A patient from psychologist B cannot confirm a session belonging to psychologist A (each session has its own unique token).

#### Scenario: Patient B cannot confirm session of patient A

- **WHEN** patient B somehow obtains the confirmation token for patient A's session and confirms
- **THEN** the confirmation succeeds (token-based, not identity-based) BUT the session belongs to the correct psychologist and patient — the token is the sole authorization. This is acceptable because the token is 256-bit entropy and single-use

#### Scenario: Direct DB access without service-role is blocked

- **WHEN** an unauthenticated request attempts to query sessions via the Supabase anon client
- **THEN** RLS blocks all access (no rows returned)
