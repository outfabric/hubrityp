## ADDED Requirements

### Requirement: Psychologist can view and edit personal notes for a patient

The system SHALL provide a "Notas pessoais" tab within the prontuario that contains a rich-text editor (Tiptap) with auto-save. Personal notes have a 1:1 relationship with patients (one note document per patient). The tab MUST display a prominent banner stating these notes are NOT part of the official prontuario (Resolucao CFP 001/2009, art. 5).

#### Scenario: View personal notes without password

- **WHEN** psychologist opens the Notas tab for a patient with no password set
- **THEN** system displays the regulatory banner and the Tiptap editor with existing content (or empty for first use)

#### Scenario: Create personal notes for first time

- **WHEN** psychologist types in the editor for a patient with no existing personal_notes row
- **THEN** system creates a `personal_notes` row (upsert) and auto-saves content periodically

#### Scenario: Auto-save persists content

- **WHEN** psychologist edits content and waits for auto-save interval (10 seconds)
- **THEN** system saves content to database, shows "Salvo as HH:MM" indicator

#### Scenario: Regulatory banner always visible

- **WHEN** the Notas tab is displayed
- **THEN** a warning-50 background banner with Lock icon shows: "Estas notas sao pessoais do(a) psicologo(a) e NAO fazem parte do prontuario oficial que o paciente pode acessar (Resolucao CFP 001/2009, art. 5)."

#### Scenario: Export exclusion info note visible

- **WHEN** the Notas tab is displayed
- **THEN** an info note states: "Estas notas NAO entram na exportacao padrao. Para incluir explicitamente, marque a opcao ao exportar."

### Requirement: Psychologist can set an optional password on personal notes

The system SHALL allow the psychologist to set an extra password (min 6 characters) that gates access to personal notes for a specific patient. The password MUST be hashed with argon2id (memoryCost=65536, timeCost=3, parallelism=4). Setting a password MUST clear any existing failed_attempts counter.

#### Scenario: Set password on personal notes

- **WHEN** psychologist opens "Configurar senha extra" Sheet, enters a password (≥6 chars), and confirms
- **THEN** system hashes with argon2id, stores in `password_hash` column, clears `failed_attempts` to 0, and writes audit_log (action='personal-notes.password-set')

#### Scenario: Password too short rejected

- **WHEN** psychologist enters a password shorter than 6 characters
- **THEN** system rejects with validation error "Senha deve ter no minimo 6 caracteres"

#### Scenario: Warning about no recovery shown at set time

- **WHEN** password set Sheet is displayed
- **THEN** system shows warning: "Se voce esquecer esta senha, nao sera possivel recupera-la automaticamente."

### Requirement: Personal notes with password require verification before access

The system SHALL require the psychologist to enter the correct password before displaying personal notes content when `password_hash` is set. Verification uses argon2id timing-safe comparison. Successful verification MUST reset the `failed_attempts` counter to 0.

#### Scenario: Lock screen shown when password is set

- **WHEN** psychologist opens the Notas tab for a patient with `password_hash` set and has not verified in this session
- **THEN** system shows a lock screen with password Input and "Desbloquear" button (content is NOT loaded from server until verified)

#### Scenario: Correct password unlocks content

- **WHEN** psychologist enters the correct password on the lock screen
- **THEN** system verifies via argon2, resets `failed_attempts` to 0, clears `locked_until`, loads and displays the content, and writes audit_log (action='personal-notes.read')

#### Scenario: Wrong password shows error and decrements remaining attempts

- **WHEN** psychologist enters a wrong password
- **THEN** system increments `failed_attempts`, writes audit_log (action='personal-notes.password-failed', metadata includes attempt count), and shows "Senha incorreta. Tentativas restantes: N"

### Requirement: Lockout state machine prevents brute-force on personal notes password

The system SHALL lock access to personal notes after 5 consecutive failed password attempts. Lockout duration is 15 minutes. During lockout, ALL verification attempts MUST be rejected — even with the correct password. After lockout expires, the counter does NOT auto-reset; it resets only on successful verification.

#### Scenario: Fifth failed attempt triggers lockout

- **WHEN** psychologist enters wrong password and `failed_attempts` reaches 5
- **THEN** system sets `locked_until = now() + 15 minutes`, writes audit_log (action='personal-notes.locked'), and shows "Bloqueado por 15 minutos"

#### Scenario: Correct password rejected during lockout

- **WHEN** psychologist enters the correct password while `locked_until > now()`
- **THEN** system rejects the attempt without verifying the hash and shows countdown "Bloqueado por X minutos"

#### Scenario: Lockout expires and correct password succeeds

- **WHEN** `locked_until` has passed and psychologist enters the correct password
- **THEN** system verifies successfully, resets `failed_attempts` to 0, clears `locked_until`, and shows content

#### Scenario: Wrong password after lockout expires re-increments counter

- **WHEN** `locked_until` has passed and psychologist enters a wrong password
- **THEN** system increments `failed_attempts` (can re-trigger lockout at 5 again if it was not reset)

#### Scenario: Lockout is per-patient

- **WHEN** personal notes for patient A are locked out
- **THEN** personal notes for patient B (same psychologist) are unaffected

### Requirement: Psychologist can remove personal notes password

The system SHALL allow the psychologist to remove the password by verifying the current password first. Removal MUST null the `password_hash` and reset `failed_attempts` and `locked_until`.

#### Scenario: Remove password with correct current password

- **WHEN** psychologist opens "Remover senha extra" Sheet, enters current password correctly
- **THEN** system verifies via argon2, sets `password_hash = NULL`, `failed_attempts = 0`, `locked_until = NULL`, writes audit_log (action='personal-notes.password-removed')

#### Scenario: Remove password rejected with wrong current password

- **WHEN** psychologist enters wrong current password in removal flow
- **THEN** system increments `failed_attempts` (can trigger lockout), rejects removal

#### Scenario: Remove password blocked during lockout

- **WHEN** psychologist attempts to remove password while locked out
- **THEN** system rejects with lockout message

### Requirement: Personal notes excluded from default export

The system SHALL exclude personal notes content from the default prontuario PDF export (RN-05.03). An explicit opt-in option MUST be provided (forward reference to prontuario-export change #7) with a warning about the implications.

#### Scenario: Default export excludes personal notes

- **WHEN** psychologist exports prontuario with default settings
- **THEN** personal notes content is NOT included in the generated PDF

#### Scenario: Info note references export behavior

- **WHEN** the Notas tab is displayed
- **THEN** an informational message states personal notes are excluded from default export

### Requirement: RLS enforces owner-scoped access on personal_notes

The system SHALL enable RLS on `personal_notes` with per-operation policies: SELECT, INSERT, UPDATE scoped to `user_id = auth.uid()`. There SHALL be no DELETE policy (retention mandate). The UNIQUE constraint on `patient_id` enforces the 1:1 relationship.

#### Scenario: Owner can SELECT own personal notes

- **WHEN** psychologist queries `personal_notes`
- **THEN** only rows where `user_id` matches auth.uid() are returned

#### Scenario: RLS prevents cross-psychologist access

- **WHEN** psychologist B attempts to read personal notes for a patient belonging to psychologist A
- **THEN** the query returns zero results

#### Scenario: No DELETE policy exists

- **WHEN** any authenticated user attempts to DELETE from `personal_notes`
- **THEN** the operation is rejected (no DELETE policy)

#### Scenario: UNIQUE constraint on patient_id enforced

- **WHEN** a second INSERT for the same patient_id is attempted
- **THEN** the INSERT fails with a unique violation (upsert pattern required)

### Requirement: Personal notes operations generate audit log entries

The system SHALL write audit_log entries for read, update, password-set, password-failed, password-removed, and locked events. Entries MUST include the authenticated user_id, action, resource_type='personal_notes', resource_id=personal_notes.id, and relevant metadata (e.g., failed attempt count on failures).

#### Scenario: Read audit entry on successful access

- **WHEN** personal notes content is successfully loaded (password verified or no password)
- **THEN** system writes audit_log with action='personal-notes.read'

#### Scenario: Update audit entry on auto-save

- **WHEN** content is auto-saved
- **THEN** system writes audit_log with action='personal-notes.update'

#### Scenario: Password-failed audit entry includes attempt count

- **WHEN** a wrong password is entered
- **THEN** system writes audit_log with action='personal-notes.password-failed', metadata includes `{ failedAttempts: N }`

#### Scenario: Locked audit entry on lockout trigger

- **WHEN** the 5th failed attempt triggers lockout
- **THEN** system writes audit_log with action='personal-notes.locked', metadata includes `{ lockedUntil: ISO_timestamp }`
