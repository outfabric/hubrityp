## MODIFIED Requirements

### Requirement: Video recordings table supports full lifecycle status transitions
The `video_recordings` table status CHECK constraint SHALL include the status 'idle', 'recording', 'processing', 'transcribed', 'discarded'. Recordings with status 'processing' or 'transcribed' and recorded_at older than 24 hours SHALL be eligible for cleanup.

#### Scenario: Recording transitions through full lifecycle
- **WHEN** a recording starts, is processed, transcribed, and then cleaned up
- **THEN** the status transitions: idle -> recording -> processing -> transcribed -> discarded
