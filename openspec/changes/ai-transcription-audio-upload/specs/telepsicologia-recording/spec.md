## MODIFIED Requirements

### Requirement: Recording requires verified patient consent per Res. CFP 13/2022

The system SHALL gate the start of every video-session recording on TWO independent checks executed by the same Server Action (`toggleRecording`):

1. **Legacy check (preserved during MVP transition):** the patient row has `recording_consent_signed_at IS NOT NULL` AND `recording_consent_revoked_at IS NULL`.
2. **AI consent check (new authority introduced by the `ai-transcription-consent` change):** `assertAiConsentActive({ userId, patientId })` returns `ok: true`. This helper consults `consent_terms` for `kind = 'ai_recording'`.

If either check is negative, the action SHALL return the error code `CONSENT_INVALID` without starting the Stream recording.

The recording-cleanup pipeline (Inngest function `recording-cleanup` or equivalent) SHALL, in addition to its existing behavior, emit the event `ai-transcription/recording.completed` (Zod-validated payload `{ userId, patientId, sessionId, streamRecordingUrl, streamCallId }`) when Stream confirms the recording is ready. The event SHALL be dispatched fire-and-forget — any `inngest.send` failure is logged without leaking payload contents and does NOT block the cleanup itself.

#### Scenario: Recording starts only when both checks pass
- **GIVEN** a patient with both legacy consent set and an active `ai_recording` term
- **WHEN** the psychologist starts recording
- **THEN** Stream `startRecording` is invoked
- **AND** the `video_recordings` row transitions to `recording`

#### Scenario: Legacy missing blocks recording
- **GIVEN** the legacy field is absent or revoked
- **WHEN** the psychologist starts recording
- **THEN** the action returns `CONSENT_INVALID`
- **AND** no Stream call is made

#### Scenario: AI term missing blocks recording
- **GIVEN** the legacy field is set but `assertAiConsentActive` returns anything other than `ok: true`
- **WHEN** the psychologist starts recording
- **THEN** the action returns `CONSENT_INVALID`
- **AND** the response carries enough hint (UI-side) to suggest generating the AI term — but the error code itself is opaque (no PII leakage)

#### Scenario: Recording cleanup emits `ai-transcription/recording.completed`
- **WHEN** Stream confirms the recording is ready
- **THEN** the cleanup function dispatches the event with a valid payload
- **AND** the `ai-transcription-audio-upload` capability's `ingestStreamRecording` function picks it up
- **AND** subsequent retries of the cleanup do NOT re-dispatch the event (idempotency keyed on `video_recordings.status` transition)
