## MODIFIED Requirements

### Requirement: At most one future session

The system SHALL display at most one future session — the nearest upcoming `scheduled` or `confirmed` session (smallest `start_at >= now`). It SHALL appear at the top, separated from historical sessions by a "Próxima sessão" / "Sessões anteriores" divider. Additional future sessions (e.g. from recurrence) SHALL NOT be loaded in this tab.

The historical list SHALL be time-bounded: it SHALL only return sessions with `start_at < now()`. This time bound — not id exclusion — is the primary mechanism that keeps recurrence-generated future occurrences out of the list. The list SHALL additionally exclude the nearest-future session by id as defense-in-depth against the `now()` race between the nearest-future read and the list read (the two reads evaluate `now()` at slightly different instants), so the nearest session can never be rendered twice.

A session whose `start_at` is in the past but whose status is still non-terminal (`scheduled` or `confirmed`, i.e. an overdue session not yet marked `done`/`no_show`/`cancelled`) SHALL appear in the historical list under "Sessões anteriores", because its time has passed and it is not eligible as the upcoming session (which requires `start_at >= now`).

#### Scenario: Only the nearest future session is shown

- **WHEN** a patient has 20 future `scheduled` sessions from a weekly recurrence
- **THEN** only the single nearest upcoming session is rendered, under the "Próxima sessão" divider, and the other 19 are not present in the historical list

#### Scenario: Multiple future sessions never leak into the historical list

- **WHEN** a patient has several future `scheduled`/`confirmed` sessions and some past sessions, and the historical list page is read
- **THEN** the list contains only the past sessions (`start_at < now()`) and zero future sessions, regardless of how many future occurrences exist

#### Scenario: Overdue non-terminal session appears under historical sessions

- **WHEN** a patient has a `scheduled` session whose `start_at` is in the past (overdue, not yet marked done/no-show)
- **THEN** that session is not selected as the nearest future session and instead appears in the historical list under "Sessões anteriores"

#### Scenario: No future session

- **WHEN** the patient has no upcoming `scheduled`/`confirmed` session
- **THEN** no "Próxima sessão" section is rendered and the list shows only historical sessions
