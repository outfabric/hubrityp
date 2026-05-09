## MODIFIED Requirements

### Requirement: App sidebar includes navigation to agenda

The system SHALL render an "Agenda" nav item in the main sidebar with the `Calendar` icon (Lucide). Clicking it navigates to `/app/agenda`. The item follows the sidebar nav DS pattern (idle: text secondary; hover: text primary, bg surface; active: text brand-700, bg brand-50, border-left 3px brand-500).

#### Scenario: Agenda nav item is visible

- **WHEN** psychologist is on any authenticated page
- **THEN** the sidebar shows "Agenda" with Calendar icon, positioned after "Pacientes"

#### Scenario: Agenda nav item is active on agenda pages

- **WHEN** psychologist is on /app/agenda
- **THEN** the "Agenda" nav item is highlighted with active styling
