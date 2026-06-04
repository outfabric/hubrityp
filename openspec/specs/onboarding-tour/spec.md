# onboarding-tour Specification

## Purpose
The dashboard guided tour (PRD 11 §5.5): a Driver.js five-tooltip walkthrough
created in a `'use client'` leaf that highlights the sidebar nav, Seção Hoje,
Seção Pendências, "+ Novo paciente", and "+ Nova sessão". It auto-runs exactly
once for psychologists whose `profiles.tour_completed_at` is NULL, persists
completion via an owner-scoped `completeTour` Server Action so it never
auto-runs again (RN-11.05), stays non-blocking and pausable (skip control on
every step, click-outside does not trap, pause/resume on navigation), never
references post-MVP features, and can be replayed on demand from Configurações >
Ajuda > Refazer tour. Created by syncing the `onboarding-checklist-and-tour`
change.

## Requirements

### Requirement: Guided tour presents five tooltips over the dashboard
The system SHALL provide a Driver.js guided tour with exactly five steps highlighting, in order: (1) the sidebar navigation, (2) Seção Hoje, (3) Seção Pendências, (4) the "+ Novo paciente" quick action, (5) the "+ Nova sessão" quick action. Each tooltip MUST carry the PRD 11 §5.5 copy and a "Pular tour" control visible on every step. The Driver.js instance MUST be created in a `'use client'` leaf and its CSS imported there; it MUST NOT be imported by any Server Component or by the Edge middleware.

#### Scenario: Tour highlights the five surfaces in order
- **WHEN** the tour runs
- **THEN** it highlights the sidebar nav, then Seção Hoje, then Seção Pendências, then "+ Novo paciente", then "+ Nova sessão"

#### Scenario: Skip control present on every step
- **WHEN** any tour tooltip is shown
- **THEN** a "Pular tour" control is visible and dismisses the entire tour when activated

### Requirement: Tour runs automatically only once
The system SHALL auto-run the tour the first time a psychologist opens `/dashboard` after completing the wizard, and only for users who have not yet completed the tour. On completion or skip, the system SHALL set `profiles.tour_completed_at` via a `completeTour` Server Action (`getUser()` auth, owner-scoped write) so the tour never auto-runs again (RN-11.05). The auto-run gate MUST be derived from `tour_completed_at`, not from client-only storage.

#### Scenario: Tour auto-runs once then never again
- **GIVEN** a psychologist with `tour_completed_at IS NULL` opening the dashboard for the first time
- **WHEN** the dashboard loads
- **THEN** the tour auto-runs; after it finishes, `tour_completed_at` is set and the tour does not auto-run on subsequent visits

#### Scenario: completeTour writes only the owner's profile
- **WHEN** `completeTour` runs
- **THEN** it sets `tour_completed_at` only on the `auth.uid()` profile row, ignoring any client-supplied id

### Requirement: Tour is non-blocking and pausable
The system SHALL configure the tour so it does not block interaction with the interface: clicking outside a tooltip dismisses/advances that step (Driver.js `allowClose: true`, `overlayClickBehavior` not set to a blocking value), satisfying RNF-11.05. If the psychologist navigates away from the dashboard mid-tour, the tour SHALL be destroyed/paused and only resume when they return to the dashboard (the tour starts only from the dashboard).

#### Scenario: Clicking outside does not trap the user
- **GIVEN** the tour is on step 2
- **WHEN** the psychologist clicks outside the tooltip
- **THEN** the tour does not block the click and the user can continue using the page

#### Scenario: Navigating away pauses the tour
- **GIVEN** the tour is mid-flow on the dashboard
- **WHEN** the psychologist navigates to `/agenda`
- **THEN** the tour is destroyed/paused (not rendered on `/agenda`) and resumes only upon returning to `/dashboard`

### Requirement: Tour never references post-MVP features and can be replayed
The system SHALL ensure no tour tooltip mentions WhatsApp, Receita Saúde, cobrança/PIX, or recibos (RF-11.14). The system SHALL also provide a manual "Refazer tour" entry under Configurações > Ajuda (RF-11.13) that starts the tour on demand regardless of `tour_completed_at`.

#### Scenario: Tour copy is MVP-only
- **WHEN** all five tooltips render
- **THEN** their combined text contains none of: "WhatsApp", "Receita Saúde", "PIX", "cobrança", "recibo"

#### Scenario: Manual replay starts the tour
- **GIVEN** a psychologist with `tour_completed_at` already set
- **WHEN** they click "Refazer tour" in Configurações > Ajuda
- **THEN** the tour starts again from step 1
