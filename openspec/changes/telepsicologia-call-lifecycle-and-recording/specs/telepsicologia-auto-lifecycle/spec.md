## ADDED Requirements

### Requirement: Video rooms are auto-created when a session is set to online
An Inngest function SHALL listen to `agenda/session.created` and `agenda/session.updated` events. When the session has modality='online' and status IN ('scheduled', 'confirmed'), the function SHALL create a video room if one does not already exist. If a session is updated from online to in_person, the existing room SHALL be expired.

#### Scenario: Online session triggers auto room creation
- **WHEN** a session is created with modality='online' and status='scheduled'
- **THEN** a video_rooms row is created with Stream call, tokens, and availability window

#### Scenario: Duplicate room creation is prevented
- **WHEN** the event fires for a session that already has a video room
- **THEN** no duplicate room is created

#### Scenario: Session changed to in_person expires the room
- **WHEN** a session is updated from modality='online' to modality='in_person'
- **THEN** the existing video room status is set to 'expired'

#### Scenario: Cancelled session does not trigger room creation
- **WHEN** a session event fires with status='cancelled'
- **THEN** no video room is created

### Requirement: Expired rooms are cleaned up by cron
An Inngest cron running every 15 minutes SHALL find rooms with status IN ('pending', 'active') and expires_at < NOW(), end the Stream call, and set status to 'expired'. Rooms that have been empty for more than 5 minutes (no participants) SHALL also be expired.

#### Scenario: Past-expiry room is cleaned up
- **WHEN** the cron runs and finds a room with expires_at in the past
- **THEN** the Stream call is ended and room status is set to 'expired'

#### Scenario: Empty room for 5 minutes is expired
- **WHEN** the cron runs and finds an active room where the last participant left more than 5 minutes ago
- **THEN** the room is expired

#### Scenario: Active room with participants is not touched
- **WHEN** the cron runs and finds an active room with connected participants
- **THEN** the room is left unchanged

### Requirement: Recording audio is discarded within 24 hours
An Inngest cron running hourly SHALL find recordings with status IN ('processing', 'transcribed') and recorded_at older than 24 hours, set status to 'discarded', clear audio_temp_url, and set discarded_at.

#### Scenario: Old recording is discarded
- **WHEN** the cron runs and finds a recording with recorded_at > 24h ago and status='processing'
- **THEN** the recording status becomes 'discarded' and audio_temp_url is set to NULL

#### Scenario: Recent recording is preserved
- **WHEN** the cron runs and finds a recording with recorded_at < 24h ago
- **THEN** the recording is not modified
