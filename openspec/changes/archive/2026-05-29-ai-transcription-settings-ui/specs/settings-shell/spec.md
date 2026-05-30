## MODIFIED Requirements

### Requirement: Settings index page displays interactive cards for each settings area

The settings index at `/configuracoes/page.tsx` SHALL render a grid of interactive cards (`<Card variant="interactive">`) for each settings area defined in `src/app/(app)/configuracoes/settings-areas.ts`. Clicking a card navigates to that area. Each card shows: title, short description, Lucide icon, and a chevron affordance.

The current set of areas is: Agenda, Locais, Lembretes, Integrações, **and Transcrição IA (added by `ai-transcription-settings-ui`)**. The Transcrição IA entry SHALL be defined as `{ id: 'transcricao-ia', label: 'Transcrição IA', description: 'Ativar a feature, escolher template padrão, sensibilidade de risco e ver estatísticas.', icon: Sparkles, href: '/configuracoes/transcricao-ia' }`.

The breadcrumb label registry at `src/app/(app)/configuracoes/breadcrumb-labels.ts` SHALL include `'transcricao-ia': 'Transcrição IA'` so that the settings layout breadcrumb renders the correct label.

#### Scenario: All current areas have cards on the index
- **WHEN** the index renders
- **THEN** Agenda, Locais, Lembretes, Integrações, and Transcrição IA each appear as a clickable card

#### Scenario: Card navigation is keyboard accessible
- **WHEN** a card is focused with Tab and Enter is pressed
- **THEN** the navigation happens (no mouse required)

#### Scenario: Cards comply with Sálvia interactive variant
- **WHEN** a card is hovered
- **THEN** the border transitions to `border-strong` (Sálvia interactive variant), no shadow color change, no gradient

#### Scenario: Adding a new area requires updating BOTH `settings-areas.ts` AND `breadcrumb-labels.ts`
- **WHEN** a future change adds a new area
- **THEN** an integration test (existing pattern) asserts that every `settings-areas` entry has a corresponding label in `breadcrumb-labels`
- **AND** Transcrição IA satisfies this rule
