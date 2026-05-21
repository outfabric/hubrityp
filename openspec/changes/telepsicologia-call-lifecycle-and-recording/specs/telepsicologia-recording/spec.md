## ADDED Requirements

### Requirement: Recording requires verified patient consent per Res. CFP 13/2022
The `toggleRecording` Server Action SHALL verify that the patient has active recording consent (recording_consent_signed_at IS NOT NULL AND recording_consent_revoked_at IS NULL) before starting a recording. If consent is invalid, the action SHALL return `{ ok: false, code: 'CONSENT_REQUIRED' }`.

#### Scenario: Start recording with valid consent
- **WHEN** the psychologist starts recording and the patient has signed the consent
- **THEN** Stream recording starts, video_recordings is updated, and video_rooms.recording_enabled is set to true

#### Scenario: Start recording without consent
- **WHEN** the psychologist attempts to start recording but the patient has not signed consent
- **THEN** the action returns CONSENT_REQUIRED without starting the recording

#### Scenario: Start recording with revoked consent
- **WHEN** the psychologist attempts to start recording but the patient's consent was revoked
- **THEN** the action returns CONSENT_REQUIRED

#### Scenario: Stop recording
- **WHEN** the psychologist stops recording
- **THEN** Stream recording stops, video_recordings status changes to 'processing', and recording_enabled is set to false

### Requirement: Recording UI shows consent-gated controls
The recording toggle button SHALL be disabled with a tooltip when patient consent is not signed. When recording is active, the patient SHALL see a banner "Esta sessao esta sendo gravada". If PRD 10 (transcription) is not implemented, the recording option SHALL be disabled with "Em breve".

#### Scenario: Recording button disabled without consent
- **WHEN** the patient has not signed recording consent
- **THEN** the "Gravar sessao" button is disabled with tooltip text

#### Scenario: Patient sees recording banner
- **WHEN** recording is active
- **THEN** the patient sees "Esta sessao esta sendo gravada" banner

### Requirement: Extend session adds 15 minutes
The `extendSession` Server Action SHALL add 15 minutes to the room's `expires_at` and log a `session_extended` event. The action SHALL verify room ownership and active status.

#### Scenario: Successful session extension
- **WHEN** the psychologist extends an active session
- **THEN** expires_at increases by 15 minutes and a log entry is created

#### Scenario: Cannot extend inactive room
- **WHEN** extendSession is called for a room that is not active
- **THEN** the action returns an error
