## ADDED Requirements

### Requirement: Psychologist can copy patient video link from session detail drawer

The Session Detail Drawer SHALL display a "Link do paciente" section for online sessions with status `scheduled` or `confirmed`. The section SHALL show the patient video URL (truncated) and a "Copiar link" button that copies the full URL to the clipboard. The section SHALL NOT appear for blocking slots, in-person sessions, or sessions in terminal statuses (`done`, `cancelled`, `no_show`). The section SHALL appear between the "Modality" and "Amount" sections in the drawer body.

#### Scenario: Online scheduled session shows copy link section

- **WHEN** the psychologist opens the session detail drawer for a session with `modality='online'` and `status='scheduled'`
- **THEN** a "Link do paciente" section is displayed with the patient video URL and a "Copiar link" button

#### Scenario: Online confirmed session shows copy link section

- **WHEN** the psychologist opens the session detail drawer for a session with `modality='online'` and `status='confirmed'`
- **THEN** the "Link do paciente" section is displayed

#### Scenario: In-person session does not show copy link section

- **WHEN** the psychologist opens the session detail drawer for a session with `modality='in_person'`
- **THEN** no "Link do paciente" section is displayed

#### Scenario: Blocking slot does not show copy link section

- **WHEN** the psychologist opens the session detail drawer for a blocking slot
- **THEN** no "Link do paciente" section is displayed

#### Scenario: Cancelled online session does not show copy link section

- **WHEN** the psychologist opens the session detail drawer for a session with `modality='online'` and `status='cancelled'`
- **THEN** no "Link do paciente" section is displayed

#### Scenario: Session without patient video URL does not show copy link section

- **WHEN** the psychologist opens the session detail drawer for an online session and `patientVideoUrl` is `null` (e.g., `APP_URL` not configured)
- **THEN** no "Link do paciente" section is displayed

### Requirement: Copy link button copies URL to clipboard and shows confirmation

The "Copiar link" button SHALL use `navigator.clipboard.writeText()` to copy the patient video URL. On successful copy, the button icon SHALL change from `Copy` to `Check` (Lucide icons) and the button text SHALL change to "Copiado!" for 2 seconds, then revert. A Sonner success toast SHALL NOT be shown (the inline visual feedback is sufficient). The button SHALL be `variant="secondary"` `size="sm"` per the Sálvia design system.

#### Scenario: Successful clipboard copy

- **WHEN** the psychologist clicks "Copiar link"
- **THEN** the patient video URL is copied to the clipboard
- **AND** the button shows `Check` icon with text "Copiado!" for 2 seconds
- **AND** after 2 seconds the button reverts to `Copy` icon with text "Copiar link"

#### Scenario: Clipboard API unavailable

- **WHEN** the psychologist clicks "Copiar link" in a browser that does not support `navigator.clipboard`
- **THEN** a Sonner error toast is shown with message "Não foi possível copiar. Copie o link manualmente."
- **AND** the URL text remains visible and selectable for manual copy

### Requirement: Copy link section follows Sálvia design system

The "Link do paciente" section SHALL follow the existing drawer section pattern:
- Section label: `text-text-secondary text-[12px] font-medium tracking-wide uppercase` (caption-upper token, matching "Observacoes" and "Historico" labels)
- URL text: `text-text-secondary text-[13px]` (body-sm), truncated with `truncate` CSS class, full URL in `title` attribute
- Button: `variant="secondary"` `size="sm"`, with `Copy` Lucide icon (16px, `aria-hidden="true"`), text "Copiar link"
- Layout: section label on top, URL text and button below with `flex items-center gap-2`
- Separated from adjacent sections by `<Separator />`

#### Scenario: Section renders with correct visual hierarchy

- **WHEN** the "Link do paciente" section is rendered
- **THEN** the section label uses caption-upper styling
- **AND** the URL text uses body-sm styling with truncation
- **AND** the button uses secondary variant at sm size
- **AND** the section is separated from adjacent content by Separator components

### Requirement: Post-scheduling toast shows copy action for online sessions

After successfully creating an online session, the `SessionFormModal` SHALL display a Sonner success toast with an action button to copy the patient video URL. The toast SHALL have: title "Sessão agendada com sucesso.", description "Link do paciente disponível para cópia.", and an action button labeled "Copiar link" that copies the URL to the clipboard. Auto-dismiss SHALL be 8 seconds. If `patientVideoUrl` is absent from the mutation result, the standard simple toast SHALL be shown (no copy action, default 4s auto-dismiss).

#### Scenario: Online session created with APP_URL configured

- **WHEN** the psychologist creates a new session with `modality='online'` and `APP_URL` is configured
- **THEN** a Sonner success toast appears with title "Sessão agendada com sucesso.", description "Link do paciente disponível para cópia.", and a "Copiar link" action button
- **AND** the toast auto-dismisses after 8 seconds

#### Scenario: Copy action in toast copies URL to clipboard

- **WHEN** the psychologist clicks "Copiar link" in the post-scheduling toast
- **THEN** the patient video URL is copied to the clipboard

#### Scenario: Online session created without APP_URL

- **WHEN** the psychologist creates a new session with `modality='online'` and `APP_URL` is not configured
- **THEN** the standard simple toast "Sessão agendada com sucesso." is shown without a copy action

#### Scenario: In-person session created

- **WHEN** the psychologist creates a new session with `modality='in_person'`
- **THEN** the standard simple toast "Sessão agendada com sucesso." is shown without a copy action

#### Scenario: Session edited (not created)

- **WHEN** the psychologist edits an existing session (regardless of modality)
- **THEN** the standard simple toast "Sessão atualizada com sucesso." is shown without a copy action

### Requirement: SessionWithDetails includes patient video URL

The `SessionWithDetails` type returned by `listSessionsImpl` SHALL include a `patientVideoUrl: string | null` field. The query SHALL LEFT JOIN `video_rooms` on `session_id` and select `patient_token`. The URL SHALL be constructed server-side using `generatePatientVideoUrl(APP_URL, patient_token)` when both `APP_URL` is configured and `patient_token` is present. Otherwise `patientVideoUrl` SHALL be `null`.

#### Scenario: Online session with reserved room has video URL

- **WHEN** `listSessionsImpl` returns sessions and one has a reserved video room with `patient_token`
- **THEN** the corresponding `SessionWithDetails` has `patientVideoUrl` set to `{APP_URL}/v/{patient_token}`

#### Scenario: In-person session has null video URL

- **WHEN** `listSessionsImpl` returns sessions and one has `modality='in_person'`
- **THEN** the corresponding `SessionWithDetails` has `patientVideoUrl` set to `null`

#### Scenario: Online session without reserved room has null video URL

- **WHEN** `listSessionsImpl` returns sessions and one has `modality='online'` but no `video_rooms` row
- **THEN** the corresponding `SessionWithDetails` has `patientVideoUrl` set to `null`

#### Scenario: APP_URL not configured results in null video URL

- **WHEN** `listSessionsImpl` runs without `APP_URL` configured
- **THEN** all sessions have `patientVideoUrl` set to `null`

### Requirement: MutationResult includes patient video URL

The `MutationResult` interface in `SessionFormModal` SHALL include an optional `patientVideoUrl?: string` field. `CreateSessionResult` SHALL include `patientVideoUrl?: string` when the session is online and `APP_URL` is configured. The `SessionFormModal` SHALL pass this field through from the `onCreate` callback result.

#### Scenario: Create online session returns patient video URL

- **WHEN** `createSessionImpl` succeeds for an online session with `APP_URL` configured
- **THEN** the result includes `patientVideoUrl` with the patient video URL

#### Scenario: Create in-person session does not return patient video URL

- **WHEN** `createSessionImpl` succeeds for an in-person session
- **THEN** the result does not include `patientVideoUrl`
