## Why

Psychologists schedule most patients on a recurring basis — same day/time every week for months or even years. Today, creating each session manually is tedious and error-prone. The system needs to support creating a series of linked sessions from a single form, editing them with Google Calendar-style scope options (this one / this and future / all), and handling edge cases like couple therapy (2 patients per session) and retroactive session logging.

## What Changes

- New table `session_recurrences` storing the recurrence rule (frequency, days_of_week, start/end date, occurrence count). Each generated session references `recurrence_id` in the `sessions` table
- Recurrence UI in the session creation form: checkbox "Sessao recorrente" expanding frequency, repetition end, and day-of-week options
- Edit-3-options modal: when editing a recurring session, the system offers "Apenas esta sessao", "Esta e todas as proximas", "Toda a serie" — propagation logic server-side
- Couple session support: `patient_ids UUID[]` column in `sessions` enabling 2 patients per session, with multi-patient selection in the creation/edit form
- Late record flag (`is_late_record`) in `sessions` allowing retroactive session logging without triggering past-date validation (RN-03.02)
- Recurrence generation function: pure function that materializes N individual session timestamps from a recurrence rule

## Capabilities

### New Capabilities
- `agenda-recurring-sessions`: Recurrence rule creation, materialization of N linked sessions, edit-3-options propagation logic, couple session (`patient_ids[]`) support, and late record (`is_late_record`) flag

### Modified Capabilities
- `agenda-sessions` (from `agenda-foundation-and-sessions`): Sessions table gains `recurrence_id`, `patient_ids`, and `is_late_record` columns. Session creation/edit form gains recurrence checkbox, couple patient selector, and late record toggle
- `agenda-views` (from `agenda-foundation-and-sessions`): Calendar views display recurring session indicators (link icon or series badge) and couple session indicators (two-patient names)

## Impact

- **Dependency:** This change DEPENDS on `agenda-foundation-and-sessions` which creates the `sessions`, `locations`, and `agenda_settings` tables, the base session CRUD, and the calendar views. The `session_recurrences` table and columns added to `sessions` (`recurrence_id`, `patient_ids`, `is_late_record`) are defined in this change
- **Database:** New migration creating `session_recurrences` table with RLS (user_id = auth.uid()). Migration altering `sessions` to add `recurrence_id UUID REFERENCES session_recurrences(id)`, `patient_ids UUID[]`, and `is_late_record BOOLEAN DEFAULT FALSE` — if not already added by foundation
- **Drizzle schema:** New table in `src/shared/db/schema/sessions/tables.ts`, updated `sessions` table definition
- **Module:** New server actions for creating/editing/deleting recurring series, new pure functions for recurrence generation, new Zod schemas for recurrence form validation
- **Frontend:** Recurrence section in session form (Checkbox, RadioGroup, ToggleGroup for days), edit-scope AlertDialog, couple patient multi-select, late record toggle
