## ADDED Requirements

### Requirement: NPS modal appears once on day 7
The system SHALL show an NPS modal exactly once to a psychologist on the 7th day after their `first_access_at`, asking "Em uma escala de 0 a 10, qual a chance de você recomendar o sistema a uma colega?" with a 0–10 selector, an optional open field "O que faria você dar nota mais alta?", and a "Não responder agora" control. The modal MUST NOT reappear automatically once shown (whether answered or dismissed). The eligibility (day-7, not yet shown/answered) MUST be derived server-side from `first_access_at` and `nps_responded_at`, never solely from client storage.

#### Scenario: Modal shows on day 7 for an eligible user
- **GIVEN** a psychologist whose `first_access_at` was 7 days ago and `nps_responded_at IS NULL`
- **WHEN** they open the app
- **THEN** the NPS modal is shown once

#### Scenario: Modal does not reappear after dismissal
- **GIVEN** a psychologist who dismissed the modal via "Não responder agora"
- **WHEN** they reopen the app
- **THEN** the NPS modal does not auto-appear again

#### Scenario: Modal not shown before day 7
- **GIVEN** a psychologist whose `first_access_at` was 2 days ago
- **WHEN** they open the app
- **THEN** the NPS modal is not shown

### Requirement: NPS answer is persisted owner-scoped and validated
The system SHALL persist the NPS answer via a `submitNps` Server Action that authenticates via `supabase.auth.getUser()`, validates the payload with Zod (`score` integer 0–10, optional `feedback` string), and writes `nps_score`, `nps_feedback`, `nps_responded_at = now()` only on the `auth.uid()` profile row. Dismissal ("Não responder agora") MUST set `nps_responded_at` without a score so the modal does not reappear, while leaving the answer available later in Configurações > Feedback.

#### Scenario: Valid answer is persisted
- **WHEN** a psychologist submits `{ score: 9, feedback: 'Adorei a agenda' }`
- **THEN** `nps_score = 9`, `nps_feedback` is stored, and `nps_responded_at` is set on their own profile row only

#### Scenario: Out-of-range score is rejected
- **WHEN** `submitNps` is called with `score = 12`
- **THEN** the Zod boundary rejects it before any write

#### Scenario: Answer can be submitted later from Configurações > Feedback
- **GIVEN** a psychologist who dismissed the modal
- **WHEN** they open Configurações > Feedback and submit a score
- **THEN** the same `submitNps` action persists it owner-scoped

### Requirement: Detractors receive a follow-up email without PII in logs
The system SHALL, when a psychologist submits an NPS score of 0–6 (detractor), send a follow-up email via Resend offering a conversation, scheduled through an Inngest function. The email send MUST be triggered server-side after persistence, MUST contain no clinical content, and any log line MUST reference the internal user id (UUID) — never the email address, name, or feedback text.

#### Scenario: Detractor triggers a follow-up email
- **GIVEN** a psychologist submits `{ score: 4 }`
- **WHEN** `submitNps` persists the answer
- **THEN** a follow-up email job is enqueued and the Resend send is attempted; the log line contains the user id but no email/name/feedback

#### Scenario: Promoter/passive does not trigger the follow-up
- **WHEN** a psychologist submits `{ score: 9 }`
- **THEN** no follow-up email job is enqueued

### Requirement: NPS scheduling is service-role and not user-reachable
The system SHALL schedule the day-7 trigger through an Inngest scheduled/sleep-based function that determines eligibility from `first_access_at`. This job and the detractor-email job SHALL run with the service-role client (justified comment) and MUST be registered in the Inngest serve route. They MUST NOT be reachable from a public, unauthenticated request path.

#### Scenario: Scheduling job is registered and service-role
- **WHEN** the Inngest serve route is built
- **THEN** the NPS scheduling and detractor-email functions are registered and use the service-role client with a justifying comment
