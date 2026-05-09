# agenda-settings Specification

## Purpose

Psychologist-level agenda configuration: default session duration, inter-session interval, per-day business hours, cancellation policy text, and default session color. One settings row per psychologist (upsert pattern).

## Requirements

### Requirement: Psychologist can configure default session duration

The system SHALL allow the psychologist to set a default session duration in minutes. This value pre-populates the duration field when creating new sessions. Default is 50 minutes.

#### Scenario: Set default duration to 45 minutes

- **WHEN** psychologist changes default duration to 45 and saves
- **THEN** new session creation forms default to 45-minute duration

#### Scenario: Default duration is 50 minutes for new accounts

- **WHEN** psychologist accesses agenda settings for the first time
- **THEN** default duration shows 50 minutes

### Requirement: Psychologist can configure interval between sessions

The system SHALL allow the psychologist to set an interval (in minutes) between sessions. This is used for visual spacing and availability hints. Default is 10 minutes.

#### Scenario: Set interval to 15 minutes

- **WHEN** psychologist sets interval to 15 and saves
- **THEN** the setting is persisted and used when suggesting next available time slots

### Requirement: Psychologist can configure business hours

The system SHALL allow the psychologist to set per-day business hours (which days are active, start time, end time for each). Business hours are displayed as highlighted background in the calendar and constrain the visible time range.

#### Scenario: Set weekday business hours

- **WHEN** psychologist enables Mon-Fri with 08:00-20:00 and Sat with 08:00-12:00, Sun disabled
- **THEN** the calendar views highlight those hours and dim off-hours slots

#### Scenario: Business hours with no active days

- **WHEN** psychologist disables all days
- **THEN** system shows validation error "Selecione pelo menos um dia de atendimento"

### Requirement: Psychologist can write a cancellation policy

The system SHALL allow the psychologist to write a free-text cancellation policy. This text is informational and will be included in consent terms (future integration).

#### Scenario: Write cancellation policy

- **WHEN** psychologist types "Cancelamentos com menos de 24h de antecedencia serao cobrados integralmente" and saves
- **THEN** the policy text is persisted

#### Scenario: Cancellation policy is optional

- **WHEN** psychologist leaves the cancellation policy field empty
- **THEN** system saves without error; the field remains null

### Requirement: Psychologist can set a default session color

The system SHALL allow the psychologist to choose a default color for sessions from a predefined palette of 6 colors. Sessions without an explicit color use this default.

#### Scenario: Set default color

- **WHEN** psychologist selects a teal swatch as default color
- **THEN** new sessions without explicit color use teal in calendar views

### Requirement: Agenda settings use upsert pattern

The system SHALL use INSERT ON CONFLICT (user_id) DO UPDATE for saving settings. The first save creates the row; subsequent saves update it. There is exactly one `agenda_settings` row per psychologist (1:1 with profiles).

#### Scenario: First save creates settings

- **WHEN** psychologist saves agenda settings for the first time
- **THEN** system creates a new `agenda_settings` row with the provided values

#### Scenario: Subsequent save updates settings

- **WHEN** psychologist modifies duration and saves again
- **THEN** the existing row is updated (not duplicated)

### Requirement: RLS enforces owner-scoped access on agenda_settings table

The system SHALL enable RLS on `agenda_settings` using `user_id = auth.uid()`.

#### Scenario: Cross-psychologist access is blocked

- **WHEN** psychologist A queries the agenda_settings table
- **THEN** only psychologist A's settings are returned
