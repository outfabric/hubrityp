# telepsicologia-psychologist-ui Specification

## Purpose

Psychologist-facing video call UI for telepsychology sessions: authenticated video page, pre-call lobby with device check, in-call layout with patient video and controls, waiting room with patient admission, and end-call flow with post-session prompt.

## Requirements

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

### Requirement: In-call layout includes screen share display and indicators

The psychologist's in-call view SHALL display a "Voce esta compartilhando sua tela" overlay when screen sharing is active, with a "Parar de compartilhar" button. Stream's SpeakerLayout SHALL handle the automatic layout switch to show the shared screen as the main content.

#### Scenario: Screen share overlay visible during sharing

- **WHEN** the psychologist is sharing their screen
- **THEN** a "Voce esta compartilhando sua tela" banner and "Parar de compartilhar" button are visible

#### Scenario: Patient sees shared screen

- **WHEN** the psychologist shares their screen
- **THEN** the patient's main video area switches to the shared screen content

### Requirement: Waiting room shows patient status and admit button

When a patient is actually present in the waiting room, the psychologist SHALL see a "Paciente aguardando" indicator with an "Admitir" button. The indicator SHALL be driven by HEARTBEAT FRESHNESS — present when the last heartbeat is within a named staleness TTL (`WAITING_PRESENCE_TTL_MS`, ~30s, tolerating ~2 missed 10s polls) — NOT by a one-shot arrival latch, NOT by the room merely being in the default `pending` status, and NOT by the Stream `participantCount` (the patient never enters the Stream call before admission). Presence SHALL be computed as `room.status === 'pending' && lastSeenAt != null && (now − lastSeenAt) < WAITING_PRESENCE_TTL_MS`. The psychologist page SHALL seed `lastSeenAt` from the server-rendered `patient_last_seen_at` (so a patient already present when the page opens is shown immediately) and SHALL update it live by subscribing to the owner-scoped PRIVATE Realtime channel `video-room:<roomId>` (`config: { private: true }`); each heartbeat broadcast SHALL refresh `lastSeenAt`, a broadcast carrying a null `last_seen_at` (patient departure beacon) SHALL clear the indicator immediately, and a periodic re-evaluation SHALL auto-clear the indicator once heartbeats stop and the TTL lapses (the guaranteed fallback when no departure broadcast arrives). The subscription and timers SHALL be torn down on unmount. The realtime payload SHALL be treated as untrusted transport and used only to record the heartbeat timestamp — never for any authorization decision. Clicking "Admitir" SHALL update the room status to 'active', SHALL clear the indicator immediately on the client (without depending on a refreshed `room.status` prop), and SHALL allow the patient to join the call.

#### Scenario: Patient present in waiting room

- **WHEN** a patient is present in the waiting room (a recent heartbeat is within the TTL) before the psychologist admits them
- **THEN** the psychologist sees "Paciente aguardando" with an "Admitir" button

#### Scenario: No patient present yet

- **WHEN** the room is `pending` but no patient has reached the waiting room (`patient_last_seen_at` is NULL)
- **THEN** no "Paciente aguardando" indicator is shown, regardless of the Stream participant count

#### Scenario: Already-present patient shown on first render

- **WHEN** the psychologist opens the video page for a room whose `patient_last_seen_at` is within the TTL
- **THEN** the "Paciente aguardando" indicator is shown on initial render without waiting for a realtime event

#### Scenario: Presence arrives live via realtime

- **WHEN** the psychologist is already on the video page and a patient then reaches the waiting room
- **THEN** the "Paciente aguardando" indicator appears via a `video-room:<roomId>` heartbeat broadcast without a page reload

#### Scenario: Patient departs — badge clears immediately via the departure beacon

- **WHEN** a present patient leaves the waiting room and a departure beacon clears `patient_last_seen_at`, producing a null-`last_seen_at` broadcast on `video-room:<roomId>`
- **THEN** the "Paciente aguardando" indicator clears immediately, without waiting out the TTL

#### Scenario: Patient leaves with no beacon — badge auto-clears after TTL

- **WHEN** a present patient stops polling (crash/network loss, no departure beacon) and no heartbeat arrives for longer than `WAITING_PRESENCE_TTL_MS`
- **THEN** the "Paciente aguardando" indicator clears automatically without a page reload

#### Scenario: Early arrival followed by immediate departure leaves no stale badge

- **WHEN** a patient arrives early, then leaves before admission, and the psychologist opens (or stays on) the page after the TTL has lapsed
- **THEN** no "Paciente aguardando" indicator is shown (the stale heartbeat is outside the TTL)

#### Scenario: Subscription is owner-scoped

- **WHEN** the psychologist subscribes to the presence channel
- **THEN** the channel is private and authorized by the `realtime.messages` policy to the room's owner, so no other user receives presence events for that room

#### Scenario: Badge clears immediately on admit

- **WHEN** the psychologist clicks "Admitir" and the action succeeds
- **THEN** the room status changes to 'active', the "Paciente aguardando" indicator disappears immediately on the client, and the patient enters the call

#### Scenario: Admitted patient who returns within expiry still rejoins

- **WHEN** an admitted patient (room `status='active'`) reconnects within the room's expiry window
- **THEN** their `POST /api/video/join` resolves to the `active` branch and returns the Stream JWT, allowing them to rejoin (this behavior is preserved by the presence change)

### Requirement: End call flow with confirmation and post-call prompt

The "Encerrar" button SHALL trigger a confirmation dialog. On confirm, the system SHALL end the Stream call, mark the session as 'done', disconnect the patient with notice, and show a "Registrar evolucao agora?" prompt linking to the prontuario.

#### Scenario: Psychologist ends the session

- **WHEN** the psychologist clicks "Encerrar" and confirms
- **THEN** the call ends, the session status becomes 'done', and a prompt to register an evolution is shown

#### Scenario: Psychologist cancels the end dialog

- **WHEN** the psychologist clicks "Encerrar" and then "Cancelar"
- **THEN** the call continues uninterrupted
