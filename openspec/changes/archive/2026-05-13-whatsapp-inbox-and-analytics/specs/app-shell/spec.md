## MODIFIED Requirements

### Requirement: App sidebar includes navigation to inbox

The system SHALL render a "Caixa de entrada" nav item in the main sidebar with the `MessageCircle` icon (Lucide). Clicking it navigates to `/app/caixa-de-entrada`. The item is positioned between "Pacientes" and "Agenda". When the psychologist has unread conversations (unread_count > 0 across all conversations), a `Badge danger` with the count is displayed to the right of the label. The item follows the sidebar nav DS pattern (idle: text secondary; hover: text primary, bg surface; active: text brand-700, bg brand-50, border-left 3px brand-500).

#### Scenario: Inbox nav item is visible

- **WHEN** psychologist is on any authenticated page
- **THEN** the sidebar shows "Caixa de entrada" with MessageCircle icon, positioned between "Pacientes" and "Agenda"

#### Scenario: Inbox nav item shows unread badge

- **WHEN** psychologist has 5 unread conversations
- **THEN** the "Caixa de entrada" nav item displays a Badge danger with text "5" to the right of the label

#### Scenario: Inbox nav item hides badge when no unread

- **WHEN** psychologist has 0 unread conversations
- **THEN** the "Caixa de entrada" nav item displays without any badge

#### Scenario: Inbox nav item is active on inbox page

- **WHEN** psychologist is on `/app/caixa-de-entrada`
- **THEN** the "Caixa de entrada" nav item is highlighted with active styling (text brand-700, bg brand-50, border-left 3px brand-500)
