## ADDED Requirements

### Requirement: Psychologist accesses video call via authenticated route
The system SHALL provide an authenticated page at `/sessao/[id]/video` where the psychologist joins their video session. The page SHALL load the session and video room data via RLS-scoped queries, verify ownership, mint a call-scoped JWT, and render the call UI.

#### Scenario: Psychologist opens their online session video page
- **WHEN** an authenticated psychologist navigates to `/sessao/[sessionId]/video` for a session they own with modality='online'
- **THEN** the page loads with the Stream video client initialized using the psychologist's token

#### Scenario: Psychologist tries to access another user's session
- **WHEN** a psychologist navigates to `/sessao/[sessionId]/video` for a session they do not own
- **THEN** the page shows an error or redirects (no data is exposed)

#### Scenario: Anonymous user tries to access the video page
- **WHEN** an unauthenticated user navigates to `/sessao/[id]/video`
- **THEN** they are redirected to `/login`

### Requirement: Pre-call lobby with device check
The video page SHALL display a pre-call lobby before joining the call. The lobby SHALL show camera preview, microphone level indicator, and an "Entrar na sessao" button. If the browser denies camera/mic permissions, an inline error with troubleshooting instructions SHALL be shown.

#### Scenario: Psychologist previews camera in lobby
- **WHEN** the psychologist opens the video page and grants camera/mic permissions
- **THEN** the lobby shows the camera preview and mic level indicator

#### Scenario: Browser denies permissions
- **WHEN** the browser denies camera/mic access
- **THEN** an inline error message is displayed with instructions to grant permissions

### Requirement: In-call layout shows patient video with controls
During an active call, the page SHALL show the patient's video feed as the main view, the psychologist's own video as a small PiP, and a controls bar with mic toggle, camera toggle, screen share, chat toggle, and end call button. An elapsed time indicator and connection quality indicator SHALL be visible.

#### Scenario: In-call layout renders correctly
- **WHEN** the psychologist joins the call and the patient is connected
- **THEN** the patient's video fills the main area, the psychologist's video appears in a small PiP, and all control buttons are visible

### Requirement: Waiting room shows patient status and admit button
When a patient is waiting in the lobby, the psychologist SHALL see a "Paciente aguardando" indicator with an "Admitir" button. Clicking "Admitir" SHALL update the room status to 'active' and allow the patient to join the call.

#### Scenario: Patient arrives in waiting room
- **WHEN** a patient enters the waiting room before the psychologist admits them
- **THEN** the psychologist sees "Paciente aguardando" with an "Admitir" button

#### Scenario: Psychologist admits patient
- **WHEN** the psychologist clicks "Admitir"
- **THEN** the room status changes to 'active' and the patient enters the call

### Requirement: End call flow with confirmation and post-call prompt
The "Encerrar" button SHALL trigger a confirmation dialog. On confirm, the system SHALL end the Stream call, mark the session as 'done', disconnect the patient with notice, and show a "Registrar evolucao agora?" prompt linking to the prontuario.

#### Scenario: Psychologist ends the session
- **WHEN** the psychologist clicks "Encerrar" and confirms
- **THEN** the call ends, the session status becomes 'done', and a prompt to register an evolution is shown

#### Scenario: Psychologist cancels the end dialog
- **WHEN** the psychologist clicks "Encerrar" and then "Cancelar"
- **THEN** the call continues uninterrupted
