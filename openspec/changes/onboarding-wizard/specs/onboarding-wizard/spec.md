## ADDED Requirements

### Requirement: Welcome screen greets the verified psychologist
The system SHALL provide a gated `/onboarding/welcome` page that renders a personalized greeting "Olá, {firstName}! Tudo pronto para começar.", a short paragraph, a primary button "Começar configuração (5 min)" (linking to step 1 of the wizard), and a secondary link "Pular e explorar por conta própria" (which marks onboarding skipped and routes to `/dashboard`). The page MUST use the Sálvia design tokens (no gradients, brand color only on the primary button) and the design-system Button `primary`/`link` variants.

#### Scenario: Verified psychologist sees the welcome greeting
- **GIVEN** an authenticated psychologist with `status = active` whose first name is "Marina"
- **WHEN** they visit `/onboarding/welcome`
- **THEN** the page renders "Olá, Marina! Tudo pronto para começar." and a primary "Começar configuração (5 min)" button

#### Scenario: Anonymous request to welcome is redirected
- **WHEN** an anonymous client visits `/onboarding/welcome`
- **THEN** the middleware redirects to `/login?redirectTo=%2Fonboarding%2Fwelcome`

#### Scenario: Skip-and-explore marks onboarding skipped
- **WHEN** the psychologist clicks "Pular e explorar por conta própria"
- **THEN** the `skipOnboarding` Server Action runs, `onboarding_step` is advanced to `'done'` without forcing any step, and the browser navigates to `/dashboard`

### Requirement: Four-step setup wizard with visible progress
The system SHALL provide a wizard at `/onboarding/setup/[step]` covering exactly four MVP steps in order: `profile` (Sobre você), `location` (Local e agenda), `patients` (Importe pacientes), `done` (Pronto). Each step page MUST show a progress indicator ("Passo N de 4") and MUST NOT mention WhatsApp, Receita Saúde, cobrança/PIX, or recibos. An invalid `[step]` segment MUST 404 (or redirect to the first incomplete step), never render a blank page.

#### Scenario: Progress indicator reflects the current step
- **WHEN** the psychologist is on `/onboarding/setup/location`
- **THEN** the page shows "Passo 2 de 4"

#### Scenario: Wizard never references post-MVP modules
- **WHEN** any of the four step pages render
- **THEN** the rendered text contains none of: "WhatsApp", "Receita Saúde", "PIX", "cobrança", "recibo"

#### Scenario: Unknown step segment does not render a blank page
- **WHEN** the psychologist visits `/onboarding/setup/billing`
- **THEN** the response is a 404 or a redirect to the first incomplete step — never an empty wizard frame

### Requirement: Each step persists on advance and is individually skippable
The system SHALL persist the wizard's progress when the psychologist advances a step, via a `saveOnboardingStep` Server Action that validates input with Zod, authenticates via `supabase.auth.getUser()`, and writes only the authenticated owner's `profiles.onboarding_step` and the relevant checklist booleans. Every step MUST offer a "Pular" control that advances `onboarding_step` to the next step WITHOUT requiring the step's data. Skipping a step SHALL NOT block any later step.

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
The system SHALL resume the wizard at the step following the last saved `onboarding_step`. If a psychologist with `onboarding_completed_at IS NULL` opens `/onboarding/welcome` or `/onboarding/setup` without a step (or with a step earlier than their saved progress), they SHALL be routed to their saved resume point. A `resumeOnboardingStep` read helper computes that point from the session owner's profile.

#### Scenario: Resume returns to the saved step after closing the browser
- **GIVEN** a psychologist whose `onboarding_step` is `'patients'` and `onboarding_completed_at` is NULL
- **WHEN** they return to `/onboarding/setup` (no explicit step)
- **THEN** they are routed to `/onboarding/setup/patients`

### Requirement: Unfinished-setup banner appears in the app
The system SHALL display a non-blocking banner at the top of authenticated app pages for psychologists with `onboarding_completed_at IS NULL` and `onboarding_step != 'done'`: "Você ainda não terminou a configuração inicial — [continuar]", where "continuar" links to the resume step. The banner MUST disappear once onboarding is completed or skipped to `'done'`. It MUST use the design-system info/neutral alert styling (no brand color as background).

#### Scenario: Banner shows for an incomplete onboarding
- **GIVEN** a psychologist with `onboarding_completed_at` NULL and `onboarding_step = 'location'`
- **WHEN** they open `/dashboard`
- **THEN** the unfinished-setup banner renders with a "continuar" link to `/onboarding/setup/location`

#### Scenario: Banner hidden after completion
- **GIVEN** a psychologist with `onboarding_completed_at` set
- **WHEN** they open `/dashboard`
- **THEN** the unfinished-setup banner is not rendered

### Requirement: Step 2 reuses existing location and agenda-settings persistence
The system SHALL implement step 2 ("Local e agenda") by reusing the existing `@/modules/agenda` location create path and `agenda_settings` (session duration default 50 min, interval default 10 min, working hours), NOT by creating duplicate tables or CRUD. Completing step 2 with at least one location SHALL flip `onboarding_checklist.location_configured = true`.

#### Scenario: Adding the first location flips the checklist flag
- **GIVEN** a psychologist on step 2 with zero locations
- **WHEN** they add a location named "Consultório Vila Madalena"
- **THEN** the existing location create action persists it and `onboarding_checklist.location_configured` becomes TRUE

### Requirement: Step 3 CSV import is gated by sensitive-data consent
The system SHALL, on step 3, offer (A) CSV upload with column mapping + 5-row preview + pre-import validation, (B) quick "add first patient" using the existing patient create path, or (C) skip. CSV upload MUST be disabled when the psychologist has not accepted the sensitive-data consent term (`profiles.sensitive_data_consent_at IS NULL`), showing copy that directs them to Configurações > Privacidade (RN-11.03). Successful patient creation/import SHALL flip `onboarding_checklist.first_patient_added = true`.

#### Scenario: CSV upload blocked without sensitive-data consent
- **GIVEN** a psychologist on step 3 with `sensitive_data_consent_at` NULL
- **WHEN** the step renders
- **THEN** the CSV upload control is disabled and a message points to "Configurações > Privacidade" to accept the term

#### Scenario: Adding the first patient flips the checklist flag
- **GIVEN** a psychologist on step 3
- **WHEN** they create one patient via the quick-add form
- **THEN** the existing patient create action runs and `onboarding_checklist.first_patient_added` becomes TRUE

### Requirement: Step 4 summarizes setup and routes onward
The system SHALL render step 4 ("Pronto") as a read-only summary with a check icon per configured item (perfil, local, pacientes) and a "Configurar agora" link for each item still missing (non-blocking). It MUST include a primary "Ver minha agenda" button (to `/agenda`), a secondary "Ir para o dashboard" button (to `/dashboard`), and an informational "O que vem em breve" section listing WhatsApp/PIX/Receita Saúde as future, without enabling any of them. Reaching step 4 and choosing either CTA SHALL set `onboarding_completed_at = now()` and `onboarding_step = 'done'`.

#### Scenario: Completing onboarding stamps completion time
- **GIVEN** a psychologist on step 4
- **WHEN** they click "Ir para o dashboard"
- **THEN** `completeOnboarding` sets `onboarding_completed_at = now()` and `onboarding_step = 'done'`, then navigates to `/dashboard`

#### Scenario: Missing item shows a non-blocking "Configurar agora" link
- **GIVEN** a psychologist who skipped step 3
- **WHEN** step 4 renders
- **THEN** the "pacientes" item shows "Configurar agora" linking to the patient creation flow, and the CTAs remain enabled

### Requirement: Profile photo upload is server-validated
The system SHALL, when a profile photo is uploaded in step 1, validate MIME type, file size, and extension on the SERVER (never trusting client validation), store it in Supabase Storage under a server-generated UUID filename (never the user-supplied name), and reject any file that fails validation with a sanitized error. The photo bucket path MUST be owner-scoped.

#### Scenario: Oversized or wrong-type upload is rejected server-side
- **WHEN** a psychologist uploads a 20 MB file or a non-image MIME type as their profile photo
- **THEN** the Server Action rejects it with a stable, sanitized error code and stores nothing
