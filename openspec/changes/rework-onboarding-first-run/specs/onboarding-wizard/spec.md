## ADDED Requirements

### Requirement: Wizard recognizes data already created elsewhere (no double entry)
The system SHALL treat real domain data as the single source of truth for step completion, so that information entered on the dashboard or in Configurações counts in the wizard (and vice-versa) and the psychologist is NEVER asked to provide the same information twice. Specifically: the profile step SHALL pre-fill `displayName` from the current `profiles.full_name`; the location step SHALL be idempotent against existing locations (see "Step 2"); and the patients step SHALL recognize existing patients as satisfying the step. No wizard step SHALL create a duplicate domain row for data that already exists.

#### Scenario: Profile step pre-fills the known name
- **GIVEN** a psychologist whose `profiles.full_name` is "Marina Costa"
- **WHEN** the profile step renders
- **THEN** the `displayName` field is pre-filled with "Marina Costa" (confirm, not re-type)

#### Scenario: Reactivated user is not asked to recreate existing data
- **GIVEN** a reactivated psychologist who already has ≥1 location and ≥1 active patient, with onboarding incomplete
- **WHEN** they pass through the wizard
- **THEN** the location and patients steps are treated as satisfied, no duplicate rows are created, and they are advanced to the first genuinely pending step

### Requirement: Wizard entry stamps first_access_at
The system SHALL set `profiles.first_access_at = now()` on the first authenticated render of the onboarding wizard when `first_access_at IS NULL`, using a session-scoped (`auth.uid()`), idempotent, fire-and-forget write that never blocks the page. Because active psychologists with incomplete onboarding are redirected to the wizard before the dashboard, stamping here preserves the day-7 NPS anchor at the true first authenticated destination. The dashboard SHALL NO LONGER stamp `first_access_at`.

#### Scenario: First access is stamped at the wizard
- **GIVEN** an authenticated active psychologist with `first_access_at IS NULL` redirected to `/onboarding/welcome`
- **WHEN** the wizard page renders for the first time
- **THEN** `first_access_at` is set to now(); a subsequent render does not overwrite it

## MODIFIED Requirements

### Requirement: Each step persists on advance and is individually skippable
The system SHALL persist the wizard's progress when the psychologist advances a step, via a `saveOnboardingStep` Server Action that validates input with Zod, authenticates via `supabase.auth.getUser()`, and writes only the authenticated owner's `profiles.onboarding_step` and the relevant checklist booleans. Every step MUST offer a "Pular" control that advances `onboarding_step` to the next step WITHOUT requiring the step's data. Skipping a step SHALL NOT block any later step. The "Pular e explorar" shortcut on the welcome screen and the per-step skips are preserved (they satisfy the soft gate by advancing `onboarding_step` to `'done'`).

#### Scenario: Advancing step 1 persists profile fields and sets onboarding_step
- **GIVEN** a psychologist on `/onboarding/setup/profile`
- **WHEN** they submit a display name + specialization and click "Continuar"
- **THEN** `saveOnboardingStep` writes the profile fields and sets `onboarding_step = 'location'`, flips `onboarding_checklist.profile_configured = true`, and navigates to step 2

#### Scenario: Skipping step 3 still allows step 4
- **GIVEN** a psychologist on `/onboarding/setup/patients`
- **WHEN** they click "Pular"
- **THEN** `onboarding_step` advances to `'done'` and step 4 renders without error, with `first_patient_added` left FALSE

#### Scenario: A step action ignores a client-supplied user id
- **WHEN** the wizard payload includes a `userId` field pointing at another account
- **THEN** the Server Action ignores it and writes only the row owned by the session's `auth.uid()`

### Requirement: Wizard is resumable after leaving the browser
The system SHALL resume the wizard at the first **pending** step, computed from BOTH the saved `onboarding_step` AND the owner's real domain data. A step whose underlying data already exists (`full_name` set, ≥1 location, ≥1 active patient) SHALL be treated as satisfied and fast-forwarded, so the psychologist is never routed back into a step they have effectively completed elsewhere. The `resumeOnboardingStep` read helper SHALL compute that point from the session owner's data and synchronize `onboarding_step` idempotently to the computed pending step (absolute write, not increment). If a psychologist with `onboarding_completed_at IS NULL` opens `/onboarding/welcome` or `/onboarding/setup` without a step (or with a step earlier than their progress), they SHALL be routed to that resume point.

#### Scenario: Resume returns to the saved step after closing the browser
- **GIVEN** a psychologist whose `onboarding_step` is `'patients'` and `onboarding_completed_at` is NULL
- **WHEN** they return to `/onboarding/setup` (no explicit step)
- **THEN** they are routed to `/onboarding/setup/patients`

#### Scenario: Steps already satisfied by real data are fast-forwarded
- **GIVEN** a psychologist with `onboarding_step = 'location'`, `onboarding_completed_at` NULL, who already has ≥1 location created in Configurações
- **WHEN** they open `/onboarding/setup`
- **THEN** the location step is treated as satisfied and they are routed to the next pending step (`patients`), and `onboarding_step` is synchronized accordingly

### Requirement: Step 2 reuses existing location and agenda-settings persistence
The system SHALL implement step 2 ("Local e agenda") by reusing the existing `@/modules/agenda` location create path and `agenda_settings` (session duration default 50 min, interval default 10 min, working hours), NOT by creating duplicate tables or CRUD. The step SHALL be **idempotent** with respect to existing locations: when the owner already has ≥1 location, completing step 2 SHALL NOT insert another location row — it ensures an `agenda_settings` row exists, treats the step as satisfied, and advances. Completing step 2 with at least one location present SHALL flip `onboarding_checklist.location_configured = true`.

#### Scenario: Adding the first location flips the checklist flag
- **GIVEN** a psychologist on step 2 with zero locations
- **WHEN** they add a location named "Consultório Vila Madalena"
- **THEN** the existing location create action persists it and `onboarding_checklist.location_configured` becomes TRUE

#### Scenario: An existing location is not duplicated
- **GIVEN** a psychologist who already has a location "Consultório A"
- **WHEN** they pass through wizard step 2
- **THEN** no second location row is created, `agenda_settings` is ensured, and the step advances with `location_configured = TRUE`

### Requirement: Step 4 summarizes setup and routes onward
The system SHALL render step 4 ("Pronto") as a read-only summary with a check icon per configured item (perfil, local, pacientes) **derived from authoritative domain data — the same recompute source used by the dashboard checklist, not from potentially-stale stored flags** — and a "Configurar agora" link for each item still missing (non-blocking). It MUST include a primary "Ver minha agenda" button (to `/agenda`), a secondary "Ir para o dashboard" button (to `/dashboard`), and an informational "O que vem em breve" section listing WhatsApp/PIX/Receita Saúde as future, without enabling any of them. Reaching step 4 and choosing either CTA SHALL set `onboarding_completed_at = now()` and `onboarding_step = 'done'`.

#### Scenario: Completing onboarding stamps completion time
- **GIVEN** a psychologist on step 4
- **WHEN** they click "Ir para o dashboard"
- **THEN** `completeOnboarding` sets `onboarding_completed_at = now()` and `onboarding_step = 'done'`, then navigates to `/dashboard`

#### Scenario: Missing item shows a non-blocking "Configurar agora" link
- **GIVEN** a psychologist who skipped step 3
- **WHEN** step 4 renders
- **THEN** the "pacientes" item shows "Configurar agora" linking to the patient creation flow, and the CTAs remain enabled

#### Scenario: Summary reflects data created outside the wizard
- **GIVEN** a psychologist who created a location via `/configuracoes/locais` before reaching step 4
- **WHEN** step 4 renders
- **THEN** the "local" item shows a check (the summary derives from real data, matching the dashboard checklist)

### Requirement: Unfinished-setup banner appears in the app
Because active psychologists with incomplete onboarding are redirected to the onboarding wizard (see `middleware-gating`), the dashboard and other authenticated app pages are reachable only when `onboarding_step = 'done'` OR `onboarding_completed_at IS NOT NULL`. The system SHALL therefore NOT render the unfinished-setup banner on those pages: its visibility condition (`onboarding_completed_at IS NULL` AND `onboarding_step != 'done'`) is never met once the app shell is reached. The banner component remains presentational and returns null in that state, so the dashboard never shows the banner and the "Primeiros passos" checklist simultaneously.

#### Scenario: Incomplete onboarding is redirected, never shown the banner
- **GIVEN** a psychologist with `onboarding_completed_at` NULL and `onboarding_step = 'location'`
- **WHEN** they request `/dashboard`
- **THEN** the middleware redirects them to `/onboarding/welcome` and no app page (and no banner) is rendered

#### Scenario: Skipped user on the dashboard sees no banner
- **GIVEN** a psychologist who skipped onboarding (`onboarding_step = 'done'`, `onboarding_completed_at` NULL)
- **WHEN** they open `/dashboard`
- **THEN** the unfinished-setup banner is not rendered
