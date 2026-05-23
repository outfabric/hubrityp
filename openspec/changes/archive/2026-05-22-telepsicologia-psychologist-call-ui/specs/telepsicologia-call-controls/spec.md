## ADDED Requirements

### Requirement: Call control bar provides mic, camera, screen share, and end call buttons
The call control bar SHALL render toggle buttons for microphone, camera, screen sharing (psychologist only), chat, and an end call button. All buttons SHALL have aria-labels in PT-BR.

#### Scenario: Mic toggle
- **WHEN** the psychologist clicks the mic button
- **THEN** the microphone toggles between muted and unmuted states

#### Scenario: Camera toggle
- **WHEN** the psychologist clicks the camera button
- **THEN** the camera toggles between on and off states

#### Scenario: Screen share (psychologist only)
- **WHEN** the psychologist clicks the screen share button
- **THEN** the browser's screen share dialog opens

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
