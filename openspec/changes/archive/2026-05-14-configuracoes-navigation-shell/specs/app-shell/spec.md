## ADDED Requirements

### Requirement: App sidebar includes navigation to Configurações

The system SHALL render a "Configurações" nav item in the main sidebar with the `Settings` icon (Lucide). Clicking it navigates to `/configuracoes`. The item is positioned last in the navigation list (after "Agenda"). The item follows the sidebar nav DS pattern (idle: text `text-secondary`; hover: text `text-primary`, bg `surface`; active: text `brand-700`, bg `brand-50`, border-left 3px `brand-500`). The active state triggers when `pathname.startsWith('/configuracoes')`, matching the index and all sub-routes.

The label MUST use the correct Portuguese spelling with cedilha and tilde: "Configurações" (per DS glossary). The current sidebar incorrectly renders "Configuracoes" without diacritics.

#### Scenario: Configurações nav item is visible with correct label

- **WHEN** psychologist is on any authenticated page
- **THEN** the sidebar shows "Configurações" with Settings icon, positioned after "Agenda"

#### Scenario: Configurações nav item links to index

- **WHEN** psychologist clicks "Configurações" in the sidebar
- **THEN** the browser navigates to `/configuracoes` (not `/configuracoes/locais`)

#### Scenario: Configurações nav item is active on index

- **WHEN** psychologist is on `/configuracoes`
- **THEN** the "Configurações" nav item is highlighted with active styling (text brand-700, bg brand-50, border-left 3px brand-500)

#### Scenario: Configurações nav item is active on sub-routes

- **WHEN** psychologist is on `/configuracoes/lembretes/templates`
- **THEN** the "Configurações" nav item is highlighted with active styling

#### Scenario: Configurações nav item label uses correct diacritics

- **WHEN** psychologist views the sidebar
- **THEN** the label reads "Configurações" (with cedilha on c and tilde on o), not "Configuracoes"
