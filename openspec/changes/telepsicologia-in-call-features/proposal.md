## Why

Changes 2 and 3 deliver the core video call for psychologist and patient, but the PRD specifies additional in-call features that enhance the clinical workflow: text chat during the session (RF-09.16 — useful when audio drops), screen sharing by the psychologist (RF-09.15), a lateral prontuario drawer for real-time note-taking (RF-09.10), and the "Problema tecnico?" troubleshooting help button (RF-09.19). These features are grouped because they share the in-call context and can ship as a single increment without blocking the core video flow.

## What Changes

- In-call text chat panel (Drawer right on desktop, Sheet bottom on mobile) using Stream's built-in chat channel scoped to the call. Chat messages are NOT persisted after session ends (RF-09.16 — ephemeral)
- Screen sharing integration: psychologist's ScreenShareButton already placed in change 2's CallControlBar; this change adds the screen share rendering area and the patient's view of the shared screen
- Prontuario side drawer: when psychologist opens the drawer during a call, it loads the patient's prontuario page in a panel alongside the video. Allows real-time evolution note-taking
- "Problema tecnico?" help button: opens a troubleshooting panel with common fixes (check mic, restart browser, change browser)
- Connection quality degradation handling: when quality is red, offer "Reduzir qualidade do video" option (RF-09.17)

## Capabilities

### New Capabilities

- `telepsicologia-in-call-chat`: Ephemeral text chat during video session using Stream's call chat, with Drawer UI. Chat cleared after session ends
- `telepsicologia-prontuario-drawer`: Side panel during video call that embeds the patient prontuario for real-time note-taking
- `telepsicologia-troubleshooting`: "Problema tecnico?" help panel with common troubleshooting steps

### Modified Capabilities

- `telepsicologia-psychologist-ui`: Extends the in-call view with chat toggle, prontuario toggle, screen share display, help button, and quality degradation controls
- `telepsicologia-patient-join`: Extends patient in-call view with chat panel (receive + send) and screen share display (view only)

## Impact

- **Components:** New chat drawer, prontuario drawer, troubleshooting panel, screen share overlay
- **Module expansion:** `src/modules/telepsicologia/components/` gains chat, prontuario, and help components
- **No new routes, no new tables, no new Server Actions** — this is purely frontend enhancement of the existing call UI
- **Stream SDK:** Uses built-in chat channel per call (no additional Stream Chat SDK needed — video calls include a data channel)
- **Security:** Prontuario drawer loads data via the existing RLS-scoped queries (psychologist is authenticated). Chat messages are ephemeral — Stream's call data channel does not persist messages after the call ends
