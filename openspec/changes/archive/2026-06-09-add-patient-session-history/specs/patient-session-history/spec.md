## ADDED Requirements

### Requirement: Session history tab entry point

The system SHALL render a consolidated, single-patient session history inside the "Histórico de sessões" tab of `/pacientes/:id`, replacing the previous "Em breve" placeholder. The tab content SHALL be fetched lazily when the tab becomes active (not on patient-page load), via an owner-scoped server read. The first activation SHALL return, in a single round trip, the summary strip data, the nearest future session (if any), and the first page of historical sessions.

#### Scenario: Tab activation loads the history

- **WHEN** an authenticated psychologist opens the "Histórico de sessões" tab for one of their patients who has sessions
- **THEN** the system fetches and renders the summary strip, at most one future session, and the most recent historical sessions

#### Scenario: History is not fetched until the tab is opened

- **WHEN** the psychologist loads `/pacientes/:id` but never activates the "Histórico de sessões" tab
- **THEN** no session-history read query is executed and no session-history audit entry is written

### Requirement: Summary strip

The system SHALL display a horizontal summary strip at the top of the tab whose values are computed server-side via a single aggregate query (no additional round trips). The strip SHALL show: total realized sessions (`status = 'done'`); the attendance rate as `realizadas / (realizadas + canceladas_pelo_paciente + no_show) × 100`; a `warning` badge (bg `warning-50`, text `warning-700`) with the count of `done` sessions lacking a linked evolution, hidden when zero; and the date of the last realized session. The attendance-rate denominator SHALL exclude cancellations not made by the patient (i.e. only `cancelled_by = 'patient'` cancellations count toward the denominator). When the denominator is zero the rate SHALL be shown as `0%`, never hidden.

#### Scenario: Strip shows realized total, attendance rate and last session

- **WHEN** a patient has 8 `done`, 1 `no_show`, 1 `cancelled` by the patient, and 1 `cancelled` by the therapist
- **THEN** the strip shows "8" realized, an attendance rate of `80%` (8 / (8 + 1 + 1)), and the date of the most recent `done` session
- **AND** the therapist-initiated cancellation is excluded from the denominator

#### Scenario: Pending-evolution badge appears with a count

- **WHEN** the patient has 3 `done` sessions with no linked evolution
- **THEN** a `warning` badge displays "3" pending evolutions

#### Scenario: Pending-evolution badge is hidden when zero

- **WHEN** every `done` session has a linked evolution
- **THEN** no pending-evolution badge is rendered

#### Scenario: Attendance rate is zero, not hidden

- **WHEN** all of the patient's accountable sessions were cancelled by the patient or were no-shows (zero `done`)
- **THEN** the strip shows "0%" attendance rate

### Requirement: Chronological session list grouped by month

The system SHALL render the historical sessions in descending chronological order (most recent first), visually grouped by month/year. Each month/year divider SHALL use a `caption-upper` label (12px, weight 500, tracking 0.06em, uppercase, `text-tertiary`) over a `border-subtle` separator. Month grouping SHALL be computed in the `America/Sao_Paulo` timezone with the `pt-BR` locale so the December→January boundary is correct regardless of server clock.

#### Scenario: Sessions are grouped by month, newest first

- **WHEN** a patient has sessions across March and April
- **THEN** April sessions appear first under an "ABRIL DE 2026" divider, then March sessions under "MARÇO DE 2026", each in descending date order

#### Scenario: Year boundary grouping is correct

- **WHEN** a patient has a session on 2025-12-30 and one on 2026-01-05
- **THEN** the January 2026 session is grouped under "JANEIRO DE 2026" and the December session under "DEZEMBRO DE 2025", with no cross-year mixing

### Requirement: At most one future session

The system SHALL display at most one future session — the nearest upcoming `scheduled` or `confirmed` session (smallest `start_at >= now`). It SHALL appear at the top, separated from historical sessions by a "Próxima sessão" / "Sessões anteriores" divider. Additional future sessions (e.g. from recurrence) SHALL NOT be loaded in this tab.

#### Scenario: Only the nearest future session is shown

- **WHEN** a patient has 20 future `scheduled` sessions from a weekly recurrence
- **THEN** only the single nearest upcoming session is rendered, under the "Próxima sessão" divider, and the other 19 are not present

#### Scenario: No future session

- **WHEN** the patient has no upcoming `scheduled`/`confirmed` session
- **THEN** no "Próxima sessão" section is rendered and the list shows only historical sessions

### Requirement: Session card content and styling

Each session SHALL be rendered as a Sálvia `interactive` card (bg `surface`, border `border`, radius `xl`, shadow `xs`, padding `space-6` desktop / `space-4` mobile; hover border `border-strong`). The card SHALL display: status (Lucide icon + badge + label), the full date with weekday, the start–end time, the duration, and — only when present — the modality (Lucide icon), the location name (via `locations.name`), and the amount. Absent optional fields SHALL simply be omitted (no empty rows or placeholders).

#### Scenario: Card renders all available fields

- **WHEN** a session has modality `in_person`, a location, and an amount
- **THEN** the card shows the status badge+icon+label, the full date with weekday, the time range, the duration, the modality icon, the location name, and the amount

#### Scenario: Optional fields omitted when absent

- **WHEN** a session has no amount and no location
- **THEN** the card omits the amount and location entirely without showing empty placeholders

### Requirement: Status color and icon mapping

The system SHALL map each session status to a fixed badge variant, Lucide icon (16px inline, `currentColor`), and Portuguese label: `scheduled` → `info` badge / `Calendar` / "Agendada"; `confirmed` → `info` badge / `CheckCircle2` / "Confirmada"; `done` → `success` badge / `CheckCircle2` / "Realizada"; `cancelled` → `neutral` badge / `X` / "Cancelada"; `no_show` → `warning` badge / `AlertTriangle` / "Não compareceu". Modality icons SHALL be `MapPin` for `in_person` and `Video` for `online` (16px, `text-tertiary`).

#### Scenario: Done session uses success styling

- **WHEN** a session has status `done`
- **THEN** its card shows a `success` badge labelled "Realizada" with the `CheckCircle2` icon

#### Scenario: No-show session uses warning styling

- **WHEN** a session has status `no_show`
- **THEN** its card shows a `warning` badge labelled "Não compareceu" with the `AlertTriangle` icon

### Requirement: Evolution indicator and CTAs for done sessions

For `done` sessions only, the system SHALL show an evolution indicator. When an evolution is linked, it SHALL show a `success` badge "Evolução registrada" and a `link` button "Ver" navigating to `/pacientes/:id/prontuario/evolucoes/:evolutionId`. When no evolution is linked, it SHALL show a `warning` badge "Sem evolução" and a `primary` button "Registrar" navigating to `/pacientes/:id/prontuario/evolucoes/nova?sessionId=:sessionId`. When the linked evolution is finalized (`finalized_at` is set) and older than 30 days, a subtle "Finalizada" read-only hint SHALL appear next to the "Ver" link. Non-`done` statuses (`scheduled`, `confirmed`, `cancelled`, `no_show`) SHALL NOT show any evolution indicator.

#### Scenario: Done session without evolution offers "Registrar"

- **WHEN** a `done` session has no linked evolution
- **THEN** the card shows a `warning` "Sem evolução" badge and a `primary` "Registrar" button linking to `/pacientes/:id/prontuario/evolucoes/nova?sessionId=:sessionId`

#### Scenario: Done session with evolution offers "Ver"

- **WHEN** a `done` session has a linked evolution with id `EV`
- **THEN** the card shows a `success` "Evolução registrada" badge and a `link` "Ver" button linking to `/pacientes/:id/prontuario/evolucoes/EV`

#### Scenario: Finalized evolution older than 30 days shows the read-only hint

- **WHEN** the linked evolution has `finalized_at` set to a date more than 30 days ago
- **THEN** a subtle "Finalizada" hint is shown next to the "Ver" link

#### Scenario: Finalized evolution within 30 days does not show the hint

- **WHEN** the linked evolution has `finalized_at` set to a date 10 days ago
- **THEN** no "Finalizada" hint is shown

#### Scenario: Non-done sessions show no evolution indicator

- **WHEN** a session has status `scheduled`, `confirmed`, `cancelled`, or `no_show`
- **THEN** no evolution badge or evolution CTA is rendered for that card

### Requirement: Cancelled session details

For `cancelled` sessions, the system SHALL show, in the card body, who cancelled (`cancelled_by`), the reason (`cancellation_reason`), the notice (`cancellation_notice`), and whether it was charged (`charge_cancellation`).

#### Scenario: Cancelled session shows cancellation details

- **WHEN** a `cancelled` session has `cancelled_by`, `cancellation_reason`, `cancellation_notice`, and `charge_cancellation = true`
- **THEN** the card body shows who cancelled, the reason, the notice, and that it was charged

### Requirement: Open the next session in the agenda

For the nearest future `scheduled`/`confirmed` session, the system SHALL show a `ghost` button "Abrir na agenda" (Lucide `ArrowRight`, 16px) that navigates to `/agenda?focusSession=:sessionId`. The agenda page SHALL honor the `focusSession` query parameter by opening the calendar focused on that session.

#### Scenario: Open-in-agenda navigates with focusSession

- **WHEN** the psychologist clicks "Abrir na agenda" on the next future session with id `S`
- **THEN** the browser navigates to `/agenda?focusSession=S`

#### Scenario: Agenda focuses the targeted session

- **WHEN** the agenda page loads with `?focusSession=S` for a session belonging to the authenticated psychologist
- **THEN** the calendar is positioned/focused on session `S`

### Requirement: Status filter

The system SHALL render a single-select chip filter bar below the summary strip with options: "Todas" (default), "Realizadas", "Canceladas", "Não compareceu". The filter SHALL apply only to historical sessions; the nearest future session (when present) SHALL remain visible regardless of the active filter. The filter SHALL be applied client-side when the number of loaded sessions is ≤ 50; above 50 loaded sessions, changing the filter SHALL trigger a new server-parameterized query and reset pagination.

#### Scenario: Client-side filter under threshold

- **WHEN** 20 sessions are loaded and the psychologist selects "Canceladas"
- **THEN** only `cancelled` historical sessions are shown, applied client-side without a new request, and the future session (if any) remains visible

#### Scenario: Server-side filter above threshold

- **WHEN** more than 50 sessions are loaded and the psychologist selects "Não compareceu"
- **THEN** a new parameterized query is issued for `no_show` sessions and pagination is reset

#### Scenario: Future session ignores the filter

- **WHEN** a future session exists and the psychologist selects "Realizadas"
- **THEN** the future session remains visible at the top even though it is not `done`

### Requirement: Pagination with load more

The system SHALL load the 12 most recent historical sessions on tab open and render a `secondary` "Carregar mais (N sessões anteriores)" button at the end of the list that loads 12 more per click. The button SHALL show a loading state (spinner replacing the left icon) during the request, SHALL display the count of remaining sessions, and SHALL disappear when there are none left. Loading more SHALL preserve the active filter and SHALL NOT reset the scroll position.

#### Scenario: Initial page loads 12 sessions

- **WHEN** a patient has 30 historical sessions and the tab is opened
- **THEN** the 12 most recent are shown and a "Carregar mais" button reports the remaining count

#### Scenario: Load more appends the next page

- **WHEN** the psychologist clicks "Carregar mais"
- **THEN** 12 additional older sessions are appended, the scroll position is preserved, and the remaining count updates

#### Scenario: Load more disappears when exhausted

- **WHEN** all historical sessions have been loaded
- **THEN** the "Carregar mais" button is no longer rendered

#### Scenario: Load more preserves the active filter

- **WHEN** a filter is active and the psychologist clicks "Carregar mais"
- **THEN** the additional sessions respect the active filter and the remaining count reflects that filter

### Requirement: Couple-session confidentiality

For couple sessions (`patient_ids` is non-null), the system SHALL display a `neutral` badge "Sessão de casal" and SHALL NEVER expose the partner's name, phone, id, or any other identifier in this tab. The server payload for a couple session SHALL NOT include any partner identifying field beyond the boolean fact that it is a couple session.

#### Scenario: Couple session shows only the tag

- **WHEN** a session has `patient_ids` populated with two patients
- **THEN** the card shows the "Sessão de casal" `neutral` badge and shows no partner name, phone, or identifier

#### Scenario: Server payload excludes partner identifiers

- **WHEN** the server returns a couple session
- **THEN** the response contains no partner patient id, name, or contact field — only an indicator that the session is a couple session

### Requirement: Rescheduled and late-record tags

The system SHALL show a `neutral` badge "Remarcada de [data]" when `rescheduled_from_session_id` is set, using the original session's date; when a session has been rescheduled multiple times, only the most recent reschedule tag SHALL be shown. The system SHALL show a `neutral` badge "Registro retroativo" when `is_late_record = true`.

#### Scenario: Rescheduled session shows the original date

- **WHEN** a session has `rescheduled_from_session_id` pointing to a session originally on 2026-04-02
- **THEN** the card shows a `neutral` "Remarcada de 02/04/2026" badge

#### Scenario: Late record shows the retroactive tag

- **WHEN** a session has `is_late_record = true`
- **THEN** the card shows a `neutral` "Registro retroativo" badge

### Requirement: Empty state

When the patient has no sessions, the system SHALL render the Sálvia 3-part empty state: a Lucide `Calendar` icon (32px, `text-tertiary`); an h4 headline "Nenhuma sessão registrada"; a `text-secondary` body-sm description "Agende a primeira sessão com [Nome] para começar a acompanhar o histórico."; and a `primary` CTA "Agendar primeira sessão" that navigates to `/agenda`.

#### Scenario: Patient with no sessions shows the empty state and CTA

- **WHEN** the patient has zero sessions
- **THEN** the tab shows the `Calendar` icon, the "Nenhuma sessão registrada" headline, the description naming the patient, and a "Agendar primeira sessão" primary button navigating to `/agenda`

### Requirement: Loading and error states

The system SHALL show a skeleton of 3 cards (bg `surface-muted`, radius `xl`, pulse animation ≤ 200ms honoring `prefers-reduced-motion`) while loading. On error it SHALL show a Lucide `AlertCircle` icon (32px, `text-tertiary`), an h4 headline "Não foi possível carregar o histórico", a `text-secondary` body-sm description, and a `secondary` "Tentar novamente" button that retries the fetch. Error responses SHALL NOT expose internal details (stack traces, SQL, table names, or other tenants' data).

#### Scenario: Loading shows the 3-card skeleton

- **WHEN** the history fetch is in flight
- **THEN** a 3-card skeleton is shown, with pulse animation suppressed under `prefers-reduced-motion`

#### Scenario: Error shows a sanitized retry state

- **WHEN** the history fetch fails
- **THEN** the tab shows the `AlertCircle` icon, the "Não foi possível carregar o histórico" headline, a generic description, and a "Tentar novamente" button — with no internal error detail exposed

#### Scenario: Retry refetches the history

- **WHEN** the psychologist clicks "Tentar novamente" after an error
- **THEN** the system re-issues the history fetch

### Requirement: Visibility rules for excluded sessions

The system SHALL NOT include soft-deleted sessions (`deleted_at IS NOT NULL`) nor blocking slots (`is_blocking = true`) in the history list, the summary, or the future-session selection.

#### Scenario: Soft-deleted sessions are excluded

- **WHEN** a patient has a session with `deleted_at` set
- **THEN** that session does not appear in the list and is not counted in the summary

#### Scenario: Blocking slots are excluded

- **WHEN** the psychologist has a blocking slot (`is_blocking = true`) overlapping the patient's timeline
- **THEN** the blocking slot does not appear in the patient's history and is not counted

### Requirement: Owner-scoped access and tenant isolation

The system SHALL authenticate every session-history read via `supabase.auth.getUser()` and SHALL scope every query to the authenticated user (`sessions.user_id = auth.uid()`); the `patientId` from input SHALL be treated as a filter, never as a trust boundary. Postgres RLS on `sessions` and `evolutions` SHALL enforce the same `user_id = auth.uid()` scoping as the last line of defense. Unauthenticated requests SHALL be rejected, and a request referencing another psychologist's patient SHALL return no sessions belonging to that other psychologist.

#### Scenario: Anonymous request is rejected

- **WHEN** an unauthenticated request attempts to reach the patient session history
- **THEN** the system rejects it (the `/pacientes/:id` route redirects to `/login` via middleware; the server read returns an unauthorized result)

#### Scenario: Cross-tenant access returns nothing

- **WHEN** psychologist A requests the session history for a `patientId` belonging to psychologist B
- **THEN** no sessions belonging to psychologist B are returned

#### Scenario: RLS blocks cross-tenant rows

- **WHEN** a session-scoped query is executed under psychologist A's session for psychologist B's patient
- **THEN** RLS yields zero rows for B's data

### Requirement: LGPD read audit

On each tab open (the initial fetch), the system SHALL write one `audit_log` entry capturing the authenticated `user_id` and the accessed `patient_id`, following the prontuario read-audit pattern. The audit write SHALL use the verified session `user_id` (never a client-supplied value) and SHALL be best-effort (a failure is logged internally without PII and does not block the read). "Load more" pagination requests SHALL NOT write additional audit entries.

#### Scenario: Tab open writes one audit entry

- **WHEN** the psychologist opens the session-history tab for patient `P`
- **THEN** exactly one `audit_log` entry is written with the authenticated `user_id` and `resource_id = P`

#### Scenario: Load more does not write audit entries

- **WHEN** the psychologist clicks "Carregar mais"
- **THEN** no additional `audit_log` entry is written for the pagination request

#### Scenario: Audit logs contain no PII or clinical content

- **WHEN** an audit entry is written
- **THEN** it records identifiers (user_id, patient_id) only — no patient name, session notes, or other clinical content

### Requirement: Performance

The session-history query SHALL use the existing `sessions_patient_id_start_at_idx` index (no new migration). Tab open (12 sessions + summary) SHALL complete in under 600ms p95 for a patient with up to 300 sessions, and "Carregar mais" SHALL return the next page in under 400ms.

#### Scenario: Query uses the patient/start_at index

- **WHEN** the history list query runs for a patient
- **THEN** the query plan uses `sessions_patient_id_start_at_idx` (no sequential scan of `sessions`)
