# agenda-recurring-sessions Specification

## Purpose

Recurrence rule creation, materialization of N linked sessions, edit-3-options propagation logic (Google Calendar pattern), couple session (`patient_ids[]`) support, and late record (`is_late_record`) flag for retroactive session logging.

## Requirements

### Requirement: Psychologist can create a recurring session series

The system SHALL allow creating a recurring session series from the session creation form. When "Sessao recorrente" is checked, the form expands to show frequency (weekly/biweekly/monthly/custom), days of week (for weekly/custom), and repetition end condition (specific date / occurrence count / indefinite). On submit, the system creates a `session_recurrences` row and materializes N individual `sessions` rows linked by `recurrence_id`.

#### Scenario: Create weekly recurring session for 6 months

- **WHEN** psychologist creates a session with patient "Marina", Tuesday 14:00-14:50, checks "Sessao recorrente", selects frequency "Semanal", and sets end date 6 months from start
- **THEN** system creates 1 `session_recurrences` row and 26 individual `sessions` rows, all sharing the same `recurrence_id`, each on consecutive Tuesdays at 14:00

#### Scenario: Create biweekly recurring session with occurrence count

- **WHEN** psychologist creates a session with frequency "Quinzenal" and occurrence count 12
- **THEN** system creates 12 sessions spaced 2 weeks apart, linked by `recurrence_id`

#### Scenario: Create weekly session on multiple days

- **WHEN** psychologist selects frequency "Semanal" and days "Terca" and "Quinta"
- **THEN** system creates sessions on both Tuesdays and Thursdays within the specified period, all linked to the same `recurrence_id`

#### Scenario: Create indefinite recurring session

- **WHEN** psychologist selects repetition end "Indefinido"
- **THEN** system materializes sessions for the next 24 months (max 104 for weekly) and stores `is_indefinite=true` on the recurrence. Helper text informs: "O sistema criara sessoes para os proximos 2 anos automaticamente"

#### Scenario: Recurrence form validates required fields

- **WHEN** psychologist checks "Sessao recorrente" but does not select a frequency
- **THEN** form shows validation error "Selecione a frequencia da recorrencia"

#### Scenario: Recurrence respects conflict detection

- **WHEN** a generated session instance would overlap an existing non-cancelled session
- **THEN** system shows a warning listing the conflicting dates and allows the psychologist to skip those dates or proceed anyway (soft warning per RN-03.01)

### Requirement: Editing a recurring session offers three scope options

The system SHALL present an AlertDialog with three options when the psychologist edits a session that belongs to a recurrence: "Apenas esta sessao", "Esta e todas as proximas", "Toda a serie". The chosen scope determines which sessions are affected by the edit.

#### Scenario: Edit only this session ("Apenas esta sessao")

- **WHEN** psychologist edits session #5 of a 26-session series (changes time from 14:00 to 15:00) and selects "Apenas esta sessao"
- **THEN** only session #5 is updated to 15:00. Session #5 has `recurrence_id` set to NULL (detached from series). Sessions #1-4 and #6-26 remain unchanged

#### Scenario: Edit this and all future sessions ("Esta e todas as proximas")

- **WHEN** psychologist edits session #10 of a 26-session series (changes time to 15:00) and selects "Esta e todas as proximas"
- **THEN** sessions #10-26 are updated to 15:00. The original `session_recurrences` row has its `end_date` set to the day before session #10. A new `session_recurrences` row is created for sessions #10-26. Sessions #1-9 remain unchanged

#### Scenario: Edit the entire series ("Toda a serie")

- **WHEN** psychologist edits a session in a 26-session series (changes time to 15:00) and selects "Toda a serie"
- **THEN** all sessions in the series that are in the future and have status `scheduled` or `confirmed` are updated to 15:00. Past sessions and sessions with status `done`, `cancelled`, or `no_show` are NOT modified

#### Scenario: Edit scope modal shows correct descriptions

- **WHEN** the edit-scope AlertDialog opens
- **THEN** each option shows its subtitle: "Apenas esta sessao" -> "As demais sessoes da serie nao serao alteradas", "Esta e todas as proximas" -> "Sessoes anteriores permanecem como estao", "Toda a serie" -> "Todas as sessoes futuras serao atualizadas"

### Requirement: Deleting/cancelling a recurring session offers three scope options

The system SHALL present the same three-option AlertDialog when cancelling a session that belongs to a recurrence. Cancellation follows RN-03.05 (soft-delete, never hard delete).

#### Scenario: Cancel only this session

- **WHEN** psychologist cancels session #5 and selects "Apenas esta sessao"
- **THEN** only session #5 is marked as `cancelled`. The rest of the series is unaffected

#### Scenario: Cancel this and all future sessions

- **WHEN** psychologist cancels session #10 and selects "Esta e todas as proximas"
- **THEN** sessions #10-26 are marked as `cancelled`. The `session_recurrences.end_date` is updated to the day before session #10. Sessions #1-9 remain unchanged

#### Scenario: Cancel the entire series

- **WHEN** psychologist cancels and selects "Toda a serie"
- **THEN** all future non-completed sessions in the series are marked as `cancelled`

### Requirement: Couple session supports up to 2 patients

The system SHALL allow linking up to 2 patients to a single session via `patient_ids UUID[]`. The first patient is also stored in `patient_id` (primary FK). The session creation form provides a "Atendimento de casal" checkbox that reveals a second patient selector.

#### Scenario: Create couple session with 2 patients

- **WHEN** psychologist checks "Atendimento de casal", selects patient "Ana" as primary and patient "Carlos" as secondary
- **THEN** session is created with `patient_id = Ana.id`, `patient_ids = [Ana.id, Carlos.id]`

#### Scenario: Prevent selecting same patient twice

- **WHEN** psychologist selects "Ana" in both the primary and secondary patient fields
- **THEN** form shows inline validation error "Selecione pacientes diferentes"

#### Scenario: Couple session displays both names in calendar

- **WHEN** a couple session appears in the calendar view
- **THEN** the cell shows "Ana & Carlos" instead of a single patient name

#### Scenario: patient_ids limited to 2 entries

- **WHEN** system receives a session creation request with `patient_ids` containing more than 2 UUIDs
- **THEN** server-side Zod validation rejects with error "Maximo de 2 pacientes por sessao"

### Requirement: Psychologist can log a past session retroactively

The system SHALL allow creating a session with a past date/time when `is_late_record` is set to `true`. This bypasses the RN-03.02 validation (no scheduling in the past). The session is created with status `done` directly.

#### Scenario: Create late record for yesterday

- **WHEN** psychologist selects yesterday's date and time, checks "Lancamento retroativo"
- **THEN** session is created with `is_late_record=true`, `status='done'`, and past date/time is accepted

#### Scenario: Late record toggle appears only for past dates

- **WHEN** psychologist selects a future date in the session form
- **THEN** the "Lancamento retroativo" checkbox is not visible

#### Scenario: Late record does not trigger reminders

- **WHEN** a session is created with `is_late_record=true`
- **THEN** no reminder event is dispatched (the session already happened)

#### Scenario: Late record still validates conflicts

- **WHEN** psychologist creates a late record that overlaps an existing session on the same past date
- **THEN** system shows the standard conflict warning (RN-03.01 still applies)

### Requirement: RLS enforces owner-scoped access on session_recurrences

The system SHALL enable RLS on the `session_recurrences` table with a policy: the user can only access rows where `user_id = auth.uid()`.

#### Scenario: Psychologist can only read own recurrences

- **WHEN** psychologist A queries the `session_recurrences` table
- **THEN** only recurrence rows where `user_id = A.id` are returned

#### Scenario: Cross-psychologist access is blocked

- **WHEN** psychologist A tries to read a recurrence row owned by psychologist B
- **THEN** query returns empty result (RLS blocks access)

### Requirement: Recurring session indicator in calendar views

The system SHALL display a visual indicator on calendar cells for sessions that belong to a recurrence series. This helps the psychologist distinguish one-off sessions from recurring ones.

#### Scenario: Recurring session shows repeat icon

- **WHEN** a session with non-null `recurrence_id` is displayed in the calendar
- **THEN** the calendar cell shows a small repeat icon (Lucide `Repeat`, 12px) in the bottom-right corner

#### Scenario: Non-recurring session has no indicator

- **WHEN** a session with `recurrence_id = NULL` is displayed in the calendar
- **THEN** no repeat icon is shown
