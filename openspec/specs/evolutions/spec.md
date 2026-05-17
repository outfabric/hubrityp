# evolutions Specification

## Purpose

Defines the clinical evolution (session notes) domain: creation linked to sessions, template-based content structure (TCC, psicanalise, sistemica, ABA, livre, custom), the 30-day free-edit window with addendum enforcement after finalization (Lei 13.787/2018 compliance), auto-save behavior, listing/pagination, version history, RLS owner isolation, reminder cron for overdue sessions, and long-form reading typography. Created by archiving change `prontuario-foundation-and-evolutions`.

## Requirements

### Requirement: Psychologist can create an evolution linked to a session

The system SHALL allow creation of one evolution per session (1:1 via UNIQUE constraint on `session_id`). The evolution MUST be linked to the patient, the session, and the authenticated psychologist (`user_id = auth.uid()`). The psychologist MUST select a template type (tcc, psicanalise, sistemica, aba, livre, or custom) at creation time. Content is stored as JSONB whose structure varies by template.

#### Scenario: Create evolution from a done session

- **WHEN** psychologist navigates to create evolution for a session with status `done`
- **THEN** system displays the template selector and a Tiptap editor pre-configured for the chosen template

#### Scenario: Attempt to create duplicate evolution for same session

- **WHEN** psychologist attempts to create an evolution for a session that already has one
- **THEN** system rejects with an appropriate error (UNIQUE constraint violation on session_id)

#### Scenario: RLS enforces ownership on create

- **WHEN** a request attempts to INSERT an evolution with a user_id different from auth.uid()
- **THEN** the INSERT is rejected by RLS WITH CHECK policy

### Requirement: Psychologist can update an evolution within 30 days

The system SHALL allow free editing of an evolution's content within 30 days of creation (RN-05.02). Each update MUST create a new `evolution_versions` row with `is_addendum = false`, increment `current_version`, and persist the new content to `evolutions.content`. The original content is preserved in `evolution_versions` version 1.

#### Scenario: Edit evolution within 30-day window

- **WHEN** psychologist edits an evolution created 15 days ago and saves
- **THEN** system updates `evolutions.content`, increments `current_version`, and creates a new `evolution_versions` row with `is_addendum = false`

#### Scenario: First version is preserved on creation

- **WHEN** an evolution is created
- **THEN** system creates an `evolution_versions` row with `version_number = 1`, `is_addendum = false`, and the initial content

### Requirement: Edits after 30 days create addendum versions

The system SHALL enforce that after 30 days from creation, any modification MUST be stored as an addendum (`is_addendum = true` in `evolution_versions`). The original `evolutions.content` field MUST remain untouched at the server level. The `finalized_at` timestamp on the evolution MUST be set to the time of the first addendum creation. The psychologist MUST provide a `reason` field explaining the addendum.

#### Scenario: Edit evolution after 30-day window

- **WHEN** psychologist edits an evolution created 35 days ago and saves
- **THEN** system creates a new `evolution_versions` row with `is_addendum = true` and a reason, does NOT update `evolutions.content`, and sets `finalized_at` if not already set

#### Scenario: Server-side enforcement of immutability

- **WHEN** a Server Action receives an update for an evolution older than 30 days
- **THEN** the `shouldForceAddendum(createdAt, now)` helper returns `true` and the action creates an addendum version (not a direct update)

#### Scenario: Addendum requires reason

- **WHEN** psychologist submits an addendum without a reason
- **THEN** system rejects the request with a Zod validation error

### Requirement: Evolution templates define content structure

The system SHALL support the following template types, each with a predefined JSONB content schema:

- **tcc**: humor_inicial (0-10), humor_final (0-10), pauta_sessao (rich text), conteudo_trabalhado (rich text), tarefa_casa_atribuida (rich text), tarefa_anterior_status (sim|parcial|nao), proximos_passos (rich text)
- **psicanalise**: conteudo_manifesto (rich text), associacoes_livres (rich text), sonhos_relatados (rich text), transferencia_observada (rich text)
- **sistemica**: participantes (text[]), conteudo_trabalhado (rich text), padroes_observados (rich text), intervencao_realizada (rich text), tarefa_casa (rich text)
- **aba**: comportamentos_alvo (rich text), linha_base (rich text), abc (rich text), reforcadores (rich text), foco_proxima (rich text)
- **livre**: conteudo (single rich text field)
- **custom**: arbitrary JSONB (validated as non-empty object)

#### Scenario: TCC template validates required fields

- **WHEN** psychologist submits a TCC evolution with `humor_inicial` missing
- **THEN** system rejects with a Zod validation error specifying the missing field

#### Scenario: Livre template accepts freeform content

- **WHEN** psychologist submits a livre evolution with a single `conteudo` field
- **THEN** system accepts and persists the evolution

### Requirement: Evolution editor auto-saves using existing hook

The system SHALL reuse the `useAutoSave` hook from `src/modules/patients/lib/use-auto-save.ts` with a 10-second debounce interval. Auto-save MUST only fire if content has changed since last save. A visual indicator MUST show status: "Salvo as HH:MM" (text-tertiary, 12px), "Salvando..." with spinner, or "Erro ao salvar" (danger-700 with AlertCircle icon). The indicator MUST use `aria-live="polite"`.

#### Scenario: Auto-save fires after 10 seconds of inactivity

- **WHEN** psychologist edits evolution content and stops typing for 10 seconds
- **THEN** system saves automatically and displays "Salvo as HH:MM"

#### Scenario: No save when content unchanged

- **WHEN** psychologist opens an evolution and does not modify content for 10 seconds
- **THEN** no save request is triggered

#### Scenario: Auto-save error displays indicator

- **WHEN** auto-save fails due to network or server error
- **THEN** system displays "Erro ao salvar" in danger-700 with AlertCircle icon

### Requirement: Psychologist can list evolutions for a patient

The system SHALL display evolutions in reverse chronological order (newest first). The list MUST show: template type badge, created_at date, session date reference, and a snippet of content. For patients with >100 evolutions, the list MUST paginate by month groups.

#### Scenario: List evolutions for patient with records

- **WHEN** psychologist navigates to the Evolucoes tab for a patient with 5 evolutions
- **THEN** system displays all 5 in reverse chronological order with template badge and date

#### Scenario: Empty state for patient without evolutions

- **WHEN** psychologist navigates to the Evolucoes tab for a patient with zero evolutions
- **THEN** system displays an empty state with FileText icon, heading, description, and a CTA "Registrar evolucao"

#### Scenario: Pagination for >100 evolutions

- **WHEN** patient has 120 evolutions
- **THEN** system groups by month and paginates, loading one month group at a time

### Requirement: Psychologist can view evolution detail and version history

The system SHALL display the full evolution content at `/pacientes/[id]/prontuario/evolucoes/[evolutionId]`. A version history panel (Sheet component, right-side) MUST list all `evolution_versions` rows for the evolution, showing version number, date, is_addendum badge, and modified_by. Clicking a version MUST display its content in read-only mode.

#### Scenario: View evolution detail

- **WHEN** psychologist clicks on an evolution in the list
- **THEN** system navigates to the detail page showing full content with template-appropriate layout

#### Scenario: View version history

- **WHEN** psychologist clicks "Historico" button on the evolution detail page
- **THEN** system opens a Sheet panel listing all versions with badges for addendum entries

#### Scenario: Compare with previous version

- **WHEN** psychologist selects a previous version in the history panel
- **THEN** system displays that version's content in read-only mode

### Requirement: RLS enforces strict owner isolation on evolutions

The system SHALL enforce that psychologist A cannot SELECT, INSERT, or UPDATE evolutions belonging to psychologist B. The RLS policy on `evolutions` MUST use `user_id = auth.uid()`. The RLS policy on `evolution_versions` MUST use a JOIN-scoped subquery: `evolution_id IN (SELECT id FROM evolutions WHERE user_id = auth.uid())`.

#### Scenario: Cross-psychologist SELECT blocked

- **WHEN** psychologist B queries evolutions
- **THEN** only evolutions where `user_id = psychologist_B.id` are returned; psychologist A's records are invisible

#### Scenario: Cross-psychologist INSERT blocked

- **WHEN** psychologist B attempts to INSERT an evolution with psychologist A's user_id
- **THEN** the INSERT is rejected by RLS

#### Scenario: evolution_versions JOIN-scoped isolation

- **WHEN** psychologist B queries evolution_versions
- **THEN** only versions for evolutions owned by psychologist B are returned

### Requirement: Done sessions without evolution generate reminder after 7 days

The system SHALL run a daily Inngest cron job (`prontuario/remind-missing-evolution`) that scans sessions with `status = 'done'` and `created_at` older than 7 days that have no linked evolution row. For each match, the system MUST emit an in-app notification to the owning psychologist.

#### Scenario: Reminder emitted for overdue session

- **WHEN** the cron job runs and finds a session done 8 days ago without a linked evolution
- **THEN** system creates a notification for the psychologist: "Sessao de [data] com [paciente] ainda nao possui evolucao"

#### Scenario: No reminder for session with evolution

- **WHEN** the cron job runs and finds a session done 8 days ago that already has a linked evolution
- **THEN** no notification is emitted for that session

#### Scenario: No reminder for session done less than 7 days ago

- **WHEN** the cron job runs and finds a session done 5 days ago without evolution
- **THEN** no notification is emitted (grace period not exceeded)

### Requirement: Evolution reading width follows long-form typography rule

The system SHALL render evolution content with a maximum width of 720px (72ch equivalent) following the Salvia design system long-form reading rule. Body text MUST use `body-lg` (17px, weight 400, line-height 1.65).

#### Scenario: Content respects max-width

- **WHEN** psychologist views an evolution with a long paragraph
- **THEN** the content area does not exceed 720px in width regardless of viewport size
