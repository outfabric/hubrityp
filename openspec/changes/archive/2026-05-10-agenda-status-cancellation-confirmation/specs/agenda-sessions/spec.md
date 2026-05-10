## MODIFIED Requirements

### Requirement: Sessions table includes cancellation, confirmation, and reschedule columns

The `sessions` table (created by `agenda-foundation-and-sessions`) SHALL be extended with the following columns for status lifecycle management:

- `cancellation_reason VARCHAR(50)` — predefined reason code: `'patient_cancelled'`, `'therapist_cancelled'`, `'unforeseen'`, `'other'`
- `cancelled_by VARCHAR(20)` — `'patient'` or `'therapist'`
- `cancellation_notice VARCHAR(20)` — auto-calculated: `'24h+'`, `'less_24h'`, `'less_1h'`, `'on_time'`
- `cancelled_at TIMESTAMPTZ` — when cancellation occurred
- `charge_cancellation BOOLEAN DEFAULT FALSE` — whether to charge for the cancellation
- `confirmation_token VARCHAR(64) UNIQUE` — public confirmation link token
- `confirmed_at TIMESTAMPTZ` — when patient confirmed attendance
- `rescheduled_to_session_id UUID REFERENCES sessions(id)` — replacement session (set on cancelled session)
- `rescheduled_from_session_id UUID REFERENCES sessions(id)` — original session (set on new session)
- `deleted_at TIMESTAMPTZ` — soft-delete timestamp (filtered from all queries)
- CHECK constraint: `status IN ('scheduled', 'confirmed', 'done', 'cancelled', 'no_show')`

#### Scenario: Migration adds all columns to existing sessions table

- **WHEN** the migration for this change runs
- **THEN** all new columns are added to the `sessions` table as nullable (except `charge_cancellation` which defaults to FALSE and the CHECK constraint), and the UNIQUE index on `confirmation_token` is created

#### Scenario: CHECK constraint prevents invalid status

- **WHEN** a SQL update attempts `SET status = 'invalid_status'`
- **THEN** Postgres rejects with a CHECK constraint violation

#### Scenario: Reschedule self-references are valid

- **WHEN** session A is rescheduled to session B
- **THEN** `A.rescheduled_to_session_id = B.id` and `B.rescheduled_from_session_id = A.id` — self-referencing FK on sessions is valid

### Requirement: Sessions RLS prevents DELETE operations

The system SHALL configure RLS policies on `sessions` to grant SELECT, INSERT, and UPDATE (scoped to `user_id = auth.uid()`) but NOT DELETE. This enforces RN-03.05 at the database level — cancelled sessions are preserved forever. The soft-delete pattern (`deleted_at IS NOT NULL`) handles cleanup without violating this constraint.

#### Scenario: Authenticated user cannot DELETE session via RLS

- **WHEN** an authenticated psychologist issues a DELETE query against their own session
- **THEN** RLS blocks the operation (no DELETE policy exists)

#### Scenario: Authenticated user can UPDATE their own session

- **WHEN** an authenticated psychologist updates status of their own session
- **THEN** the UPDATE succeeds (scoped by `user_id = auth.uid()`)

### Requirement: All session queries filter soft-deleted records

The system SHALL append `WHERE deleted_at IS NULL` (or Drizzle equivalent `isNull(sessions.deletedAt)`) to all session queries by default. Soft-deleted sessions are invisible in calendar views, listings, statistics, and search.

#### Scenario: Soft-deleted session does not appear in agenda view

- **WHEN** a session has `deleted_at` set
- **THEN** it does not appear in day/week/month calendar views

#### Scenario: Soft-deleted session does not appear in patient session history

- **WHEN** a session has `deleted_at` set
- **THEN** it does not appear in the patient's session history listing

### Requirement: Calendar views display status badges with semantic colors

The system SHALL render session status as a Badge on each calendar event using Design System Salvia semantic colors: `scheduled`=neutral, `confirmed`=success, `done`=brand, `cancelled`=danger, `no_show`=warning. Each badge includes a Lucide icon (Clock, CheckCircle2, Check, XCircle, AlertTriangle respectively).

#### Scenario: Confirmed session shows green badge

- **WHEN** a `confirmed` session is rendered in the week view
- **THEN** the event shows a Badge with bg `success-50`, text `success-700`, label "Confirmada", and icon `CheckCircle2`

#### Scenario: No-show session shows yellow/amber badge

- **WHEN** a `no_show` session is rendered in the day view
- **THEN** the event shows a Badge with bg `warning-50`, text `warning-700`, label "Falta", and icon `AlertTriangle`

#### Scenario: Cancelled session is visually de-emphasized

- **WHEN** a `cancelled` session is rendered in the calendar
- **THEN** the event shows a Badge with bg `danger-50`, text `danger-700`, label "Cancelada", and the event card has reduced opacity or muted styling to indicate it is no longer active
