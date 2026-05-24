# telepsicologia-session-metadata Specification

## Purpose

Post-call metadata capture and dashboard statistics for telepsychology sessions: computing effective duration, start/end times, recording and screen-share flags from session logs, and monthly online session percentage for the dashboard.

## Requirements

### Requirement: Post-call metadata is captured from session logs
When a session transitions to 'done', the system SHALL compute real start time, real end time, effective duration, had_recording flag, and had_screen_share flag from `video_session_logs`, and insert a summary event.

#### Scenario: Session metadata captured after end
- **WHEN** a session is marked as done after a video call
- **THEN** a video_session_logs entry with event_type='session_summary' is inserted containing real_start, real_end, effective_duration, had_recording, and had_screen_share

### Requirement: Dashboard shows percentage of online sessions
A Server Action SHALL return the count of done online sessions, total done sessions, and the percentage for a given month. This powers the dashboard stat (RF-09.29).

#### Scenario: Monthly online session stats
- **WHEN** a psychologist requests their monthly stats
- **THEN** the response includes onlineCount, totalDoneCount, and percentage for the specified month
