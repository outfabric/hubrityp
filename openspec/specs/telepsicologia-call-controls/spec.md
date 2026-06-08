# telepsicologia-call-controls Specification

## Purpose

Call control UI components for the telepsychology video session: mic/camera toggles, screen sharing, chat, end call, connection quality indicator, and elapsed time display.

## Requirements

### Requirement: Call control bar provides mic, camera, screen share, and end call buttons

The call control bar SHALL render toggle buttons for microphone, camera, screen sharing (psychologist only), chat, and an end call button. All buttons SHALL have aria-labels in PT-BR.

The mic, camera, and screen-share controls SHALL be rendered with the platform's design-system components (shadcn `Button` + Lucide icons from the fixed icon map) and SHALL NOT use Stream's built-in control widgets (`ToggleAudioPublishingButton`, `ToggleVideoPublishingButton`, `ScreenShareButton`). They SHALL be backed by a single shared `DeviceToggleButton` component reused by the pre-call lobby, the patient call bar, and the psychologist call bar, so all three surfaces present the same icons, sizing, and active/inactive treatment (`variant="outline"` when the device is off/muted, `variant="ghost"` when on).

Button state SHALL be driven by Stream call-state hooks: microphone/camera via `useMicrophoneState()` / `useCameraState()` (`isMute`, `microphone.toggle()` / `camera.toggle()`), and screen share via `useScreenShareState()` with the active state derived from `status === 'enabled'`. The screen-share button SHALL be disabled when another participant is already sharing (`useHasOngoingScreenShare()` is true and the current user is not the one sharing). Screen share SHALL remain psychologist-only.

When the browser denies camera or microphone permission while toggling a device, the control SHALL surface a PT-BR error message to the user rather than silently swallowing the failure.

#### Scenario: Mic toggle

- **WHEN** the psychologist clicks the mic button
- **THEN** the microphone toggles between muted and unmuted states, and the button shows the Lucide `Mic` (on) or `MicOff` (muted) icon matching the pre-call lobby

#### Scenario: Camera toggle

- **WHEN** the psychologist clicks the camera button
- **THEN** the camera toggles between on and off states, and the button shows the Lucide `Video` (on) or `VideoOff` (off) icon matching the pre-call lobby

#### Scenario: Screen share (psychologist only)

- **WHEN** the psychologist clicks the screen share button
- **THEN** the browser's screen share dialog opens and the button reflects the active state derived from `status === 'enabled'`

#### Scenario: Screen share disabled while another participant shares

- **WHEN** another participant is already sharing their screen and the psychologist is not
- **THEN** the screen-share button is disabled

#### Scenario: Controls are visually consistent across surfaces

- **WHEN** the mic, camera, and screen-share controls render in the pre-call lobby, the patient call bar, and the psychologist call bar
- **THEN** they use the same shared `DeviceToggleButton` (same Lucide icons, sizing, and active/inactive variants) instead of mixed Stream and design-system widgets

#### Scenario: Permission denied surfaces a PT-BR error

- **WHEN** the user toggles the microphone or camera and the browser denies device permission
- **THEN** a PT-BR error message is shown (the failure is not silently swallowed)

### Requirement: Connection quality indicator shows color-coded status

A 3-level indicator SHALL display connection quality: green (good), yellow (degraded), red (poor). When quality is red, a message "Sua conexao esta instavel. Verifique sua internet." SHALL be shown.

#### Scenario: Good connection

- **WHEN** the connection quality is good
- **THEN** the indicator shows green (success-500)

#### Scenario: Poor connection

- **WHEN** the connection quality drops to poor
- **THEN** the indicator shows red (danger-500) and a warning message is displayed

### Requirement: Elapsed time display counts from call join

An elapsed time indicator SHALL display the duration since the psychologist joined the call, formatted as MM:SS or H:MM:SS.

#### Scenario: Timer starts on join

- **WHEN** the psychologist joins the call
- **THEN** the elapsed time counter starts from 00:00

### Requirement: Patient call bar reuses the shared device controls without screen share

The patient call bar SHALL reuse the shared `DeviceToggleButton` for its microphone and camera controls so it stays visually consistent with the psychologist bar and the pre-call lobby. The patient call bar SHALL NOT expose a screen-share control. The patient mic/camera toggles SHALL surface a PT-BR permission error on denial, matching the psychologist and lobby behavior.

#### Scenario: Patient mic and camera use the shared control

- **WHEN** the patient call bar renders its microphone and camera buttons
- **THEN** they use the same shared `DeviceToggleButton` (Lucide icons + design-system variants) as the psychologist bar and lobby

#### Scenario: Patient bar has no screen share

- **WHEN** the patient call bar renders
- **THEN** no screen-share control is present
