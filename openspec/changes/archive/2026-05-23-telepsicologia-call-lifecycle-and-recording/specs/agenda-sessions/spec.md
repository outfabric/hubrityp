## MODIFIED Requirements

### Requirement: Session completion captures video metadata
When a session with modality='online' transitions to status='done', the system SHALL compute and store real start time, real end time, effective duration, had_recording, and had_screen_share metadata derived from video_session_logs.

#### Scenario: Online session done triggers metadata capture
- **WHEN** an online session is marked as done via endVideoSession or webhook
- **THEN** a session_summary log entry is created with computed metadata
