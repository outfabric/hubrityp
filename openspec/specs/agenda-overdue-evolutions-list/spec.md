# agenda-overdue-evolutions-list Specification

## Purpose

Server-rendered list view on `/agenda?filtro=sem-evolucao` that surfaces the authenticated psychologist's sessions overdue for an evolution, using the same source-of-truth predicate as the dashboard pendência count. Provides a register-evolution CTA per row, a removable active-filter chip, a positive empty state, and revalidation so resolved sessions disappear without manual reload.

## Requirements

### Requirement: `listOverdueEvolutionsImpl` is the canonical overdue-evolution query

The system SHALL provide `listOverdueEvolutionsImpl` in the agenda module, returning the authenticated psychologist's sessions that are overdue for an evolution, using the **same predicate as the dashboard count**: `sessions.status = 'done' AND sessions.start_at < (now − 7 days) AND sessions.deleted_at IS NULL`, anti-joined against `evolutions` on `session_id` (no evolution exists), scoped to `user_id = auth.uid()`. Results SHALL be ordered by `start_at` ascending (oldest first) and SHALL NOT be limited to the current week. Each item SHALL carry `sessionId`, `patientId`, `patientName`, `startAt`, the session modality when available, and the elapsed days without evolution. The query authenticates via `getUser()` and is owner-scoped server-side in addition to RLS; no caller-supplied id is accepted.

#### Scenario: Returns only the count predicate set, oldest first
- **GIVEN** the psychologist has `done` sessions older than 7 days without evolution on several past dates, plus `done` sessions with an evolution, recent `done` sessions, and soft-deleted sessions
- **WHEN** `listOverdueEvolutionsImpl` runs
- **THEN** only the `done` + older-than-7-days + no-evolution + not-soft-deleted sessions are returned
- **AND** they are ordered from the oldest `start_at` to the most recent

#### Scenario: Not limited to the current week
- **GIVEN** an eligible overdue session whose `start_at` is several weeks in the past
- **WHEN** `listOverdueEvolutionsImpl` runs
- **THEN** that session is included regardless of the current week window

#### Scenario: Returns only the caller's own sessions
- **GIVEN** psychologists A and B each have overdue sessions
- **WHEN** A calls `listOverdueEvolutionsImpl`
- **THEN** only A's sessions are returned; none of B's rows ever appear

### Requirement: `/agenda?filtro=sem-evolucao` renders the list view instead of the calendar

The system SHALL interpret a `filtro` search param on `/agenda` against a closed allowlist whose only MVP value is `sem-evolucao`. When `filtro=sem-evolucao`, the route SHALL render a server-rendered **list view** of the overdue-evolution sessions (from `listOverdueEvolutionsImpl`) instead of the week calendar, applied on the first paint with no flash of the calendar. Any other `filtro` value (unknown, empty, or array) SHALL be ignored and the default week calendar SHALL render with no error. The `filtro` value is validated server-side as defense against URL-injected view switching and never widens the owner scope.

#### Scenario: Filter renders the list, not the calendar
- **GIVEN** the authenticated psychologist has overdue sessions
- **WHEN** the page loads at `/agenda?filtro=sem-evolucao`
- **THEN** the overdue-evolution list view is rendered on first paint
- **AND** the week calendar is not rendered

#### Scenario: No param renders the calendar
- **WHEN** the page loads at `/agenda`
- **THEN** the default week calendar renders unchanged

#### Scenario: Unknown filter value degrades to the calendar
- **WHEN** the page loads at `/agenda?filtro=xyz` (or `?filtro=` empty, or `filtro` repeated as an array)
- **THEN** the default week calendar renders with no error and no blank screen

#### Scenario: Anonymous deep-link is redirected
- **WHEN** an anonymous request hits `/agenda?filtro=sem-evolucao`
- **THEN** middleware redirects to `/login`

### Requirement: Each overdue row shows session details and a register-evolution CTA

Each row in the list SHALL display at minimum the patient name, the session date and time in São Paulo timezone, the modality (presencial/online) when available, and the elapsed time without evolution rendered as "há N dias". Each row SHALL provide a primary CTA "Registrar evolução" that links to the existing evolution-create route for that session: `/pacientes/{patientId}/prontuario/evolucoes/nova?sessionId={sessionId}`.

#### Scenario: Row content and CTA target
- **GIVEN** an overdue session for patient "Maria S." on 22/05 14h, online, 16 days without evolution
- **WHEN** the list renders the row
- **THEN** it shows "Maria S.", the São Paulo date/time, the modality, and "há 16 dias"
- **AND** the "Registrar evolução" CTA points to `/pacientes/{patientId}/prontuario/evolucoes/nova?sessionId={sessionId}`

#### Scenario: Dates render in São Paulo timezone
- **GIVEN** a session stored in UTC
- **WHEN** the row renders the date/time
- **THEN** it is displayed in America/Sao_Paulo local time

### Requirement: List shows a removable active-filter chip that returns to the calendar

The list view SHALL display a removable chip/badge indicating the active filter with its count (e.g. "Sem evolução · N"). The chip SHALL be announceable by a screen reader and removable by keyboard. Removing it SHALL drop the `filtro` param from the URL and return to the default agenda calendar view.

#### Scenario: Chip reflects the filtered count
- **GIVEN** 3 overdue sessions
- **WHEN** the list renders
- **THEN** a chip reading the active filter with count 3 is visible and exposed to assistive technology

#### Scenario: Removing the chip returns to the calendar
- **GIVEN** the list view is active
- **WHEN** the psychologist activates the chip's remove control (click or keyboard)
- **THEN** the URL no longer contains `filtro=sem-evolucao`
- **AND** the agenda calendar view is shown

#### Scenario: List count matches the dashboard pendência
- **GIVEN** the dashboard Pendências section shows N overdue evolutions for the user
- **WHEN** the user opens `/agenda?filtro=sem-evolucao` at the same instant
- **THEN** the list header count equals N (same source-of-truth predicate)

### Requirement: Resolving an evolution removes the row and decrements the count without manual reload

When the psychologist registers an evolution for a listed session and returns to the list, the resolved session SHALL no longer appear and the active-filter count SHALL be decremented, without requiring a manual page reload. The list view SHALL be a dynamic, uncached server render so navigation back reflects current data, and the evolution-create success path SHALL revalidate the agenda route.

#### Scenario: Resolved session leaves the list
- **GIVEN** a list of 3 overdue sessions and the psychologist registers an evolution for one of them
- **WHEN** they return to `/agenda?filtro=sem-evolucao`
- **THEN** the resolved session is no longer listed
- **AND** the active-filter count reads 2

### Requirement: Empty overdue set shows a positive state, not the calendar

When the overdue set resolves to zero (the pendência was resolved or expired between the dashboard load and the click), the list view SHALL show a positive, specific empty state — "Nenhuma sessão sem evolução. Tudo em dia. 🎉" — with a link to the full agenda, never the calendar unexplained.

#### Scenario: Empty filtered set shows the positive state
- **GIVEN** the user has zero sessions matching the overdue predicate
- **WHEN** the page loads at `/agenda?filtro=sem-evolucao`
- **THEN** the empty state "Nenhuma sessão sem evolução. Tudo em dia. 🎉" is shown with a link to the full agenda
