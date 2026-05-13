## ADDED Requirements

### Requirement: App sidebar includes navigation to Configurações

The system SHALL render a "Configurações" nav item in the main sidebar with the `Settings` icon (Lucide). The label MUST use the cedilha-correct spelling "Configurações" (not "Configuracoes") matching the DS glossary entry. Clicking it MUST navigate to `/configuracoes` (the settings index page), NOT to a specific sub-route. The item is positioned last in the sidebar nav, after "Agenda". The item follows the sidebar nav DS pattern (idle: text secondary; hover: text primary, bg surface; active: text brand-700, bg brand-50, border-left 3px brand-500). The active state MUST be triggered for any path matching `/configuracoes` or `/configuracoes/*`, so that the item remains highlighted while the psychologist is anywhere in the settings area.

#### Scenario: Configurações nav item is visible

- **WHEN** psychologist is on any authenticated page
- **THEN** the sidebar shows "Configurações" (with cedilha) with the `Settings` Lucide icon, positioned after "Agenda"

#### Scenario: Configurações nav item navigates to the index

- **WHEN** psychologist clicks the "Configurações" nav item
- **THEN** the browser navigates to `/configuracoes` (not `/configuracoes/locais` nor any other sub-route)

#### Scenario: Configurações nav item is active on the index

- **WHEN** psychologist is on `/configuracoes`
- **THEN** the "Configurações" nav item is highlighted with active styling (text brand-700, bg brand-50, border-left 3px brand-500)

#### Scenario: Configurações nav item is active on any sub-route

- **WHEN** psychologist is on `/configuracoes/locais`, `/configuracoes/integracoes/whatsapp`, `/configuracoes/lembretes`, `/configuracoes/lembretes/templates`, `/configuracoes/lembretes/historico`, or `/configuracoes/agenda`
- **THEN** the "Configurações" nav item is highlighted with active styling

#### Scenario: Label spelling matches the DS glossary

- **WHEN** the sidebar nav item is inspected in the DOM
- **THEN** its visible text is exactly "Configurações" with cedilha; the string "Configuracoes" does not appear anywhere in the rendered sidebar
