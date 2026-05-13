## ADDED Requirements

### Requirement: Psychologist can configure reminder windows

The system SHALL provide a `reminder_settings` table (UNIQUE on `user_id`) storing: `early_reminder_hours` (nullable INT — NULL means disabled), `final_reminder_hours` (nullable INT), `video_link_minutes` (INT DEFAULT 30), `send_during_night` (BOOLEAN DEFAULT FALSE). RLS enforces `user_id = auth.uid()`. Defaults when no row exists: early=24, final=2, video=30, night=false.

#### Scenario: Get settings when no row exists returns defaults

- **WHEN** psychologist has never configured reminder settings and the system fetches settings
- **THEN** system returns defaults: early_reminder_hours=24, final_reminder_hours=2, video_link_minutes=30, send_during_night=false

#### Scenario: Save settings creates row via upsert

- **WHEN** psychologist saves settings with early=48, final=1, video=15, night=true for the first time
- **THEN** system inserts a `reminder_settings` row with those values and `user_id = auth.uid()`

#### Scenario: Save settings updates existing row

- **WHEN** psychologist changes early reminder from 24h to 12h and saves
- **THEN** system updates the existing row (upsert on user_id conflict)

#### Scenario: Disable early reminder by setting to null

- **WHEN** psychologist selects "Nao enviar" for the early reminder
- **THEN** `early_reminder_hours` is set to NULL and no early reminders are dispatched

#### Scenario: RLS prevents cross-user access

- **WHEN** psychologist A queries reminder_settings
- **THEN** only psychologist A's settings row is returned; psychologist B's row is invisible

### Requirement: Reminder settings UI page

The system SHALL provide a page at `/app/configuracoes/lembretes` with a form for configuring reminder windows. The page uses a Server Component that loads current settings, rendering a Client Component form.

#### Scenario: Page renders with current settings

- **WHEN** psychologist navigates to `/app/configuracoes/lembretes`
- **THEN** page shows h1 "Configuracoes de Lembretes" (28px/600) and a Card with RadioGroups pre-selected to current settings

#### Scenario: Save shows success toast

- **WHEN** psychologist changes settings and clicks "Salvar"
- **THEN** settings are persisted and a Sonner toast "Configuracoes de lembretes salvas" appears with border-left `success-500`

#### Scenario: RadioGroup options for early reminder

- **WHEN** psychologist views the early reminder section
- **THEN** RadioGroup shows options: "Nao enviar", "24 horas antes", "12 horas antes", "48 horas antes"

#### Scenario: RadioGroup options for final reminder

- **WHEN** psychologist views the final reminder section
- **THEN** RadioGroup shows options: "Nao enviar", "2 horas antes", "1 hora antes", "30 minutos antes"

#### Scenario: Select options for video link

- **WHEN** psychologist views the video link section
- **THEN** Select shows options: "15 minutos antes", "30 minutos antes", "60 minutos antes"

#### Scenario: Night switch default is OFF

- **WHEN** psychologist views the night switch with default settings
- **THEN** Switch is OFF with helper text "Por padrao, lembretes que cairiam entre 22h e 7h sao enviados as 7h da manha"

### Requirement: Reminder settings validated with Zod

The system SHALL validate reminder settings input with a Zod schema: `early_reminder_hours` (nullable number, one of [null, 12, 24, 48]), `final_reminder_hours` (nullable number, one of [null, 0.5, 1, 2]), `video_link_minutes` (number, one of [15, 30, 60]), `send_during_night` (boolean).

#### Scenario: Valid input passes validation

- **WHEN** input is { early_reminder_hours: 24, final_reminder_hours: 2, video_link_minutes: 30, send_during_night: false }
- **THEN** Zod validation passes

#### Scenario: Invalid early_reminder_hours rejected

- **WHEN** input has early_reminder_hours: 6
- **THEN** Zod validation fails with error on early_reminder_hours

#### Scenario: Null values for disabled reminders accepted

- **WHEN** input has early_reminder_hours: null, final_reminder_hours: null
- **THEN** Zod validation passes (both reminders disabled)
