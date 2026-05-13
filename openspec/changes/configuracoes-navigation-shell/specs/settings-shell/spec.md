## ADDED Requirements

### Requirement: Settings index page lists all configuration areas as cards

The system SHALL render a Server Component at `/configuracoes` (`src/app/(app)/configuracoes/page.tsx`) that displays each available settings area as a `Card interactive` (DS Sálvia). Each card MUST include a Lucide icon from the DS icon map, an h3 title, a body-sm description in `text-text-secondary`, and the entire card MUST be a navigation link to the corresponding sub-route. Cards are arranged in a responsive CSS grid: 1 column below `sm` (640px), 2 columns at `sm` to `lg` (640–1024px), and 3 columns at `lg+`. The page MUST NOT fetch data from the database — the list of areas is a static constant co-located in `src/app/(app)/configuracoes/settings-areas.ts`. The page MUST use the h1 token (28px / weight 600) for the page title "Configurações".

#### Scenario: Index renders all four configured areas

- **WHEN** an authenticated psychologist navigates to `/configuracoes`
- **THEN** the page renders exactly four cards in this order: "Locais de atendimento", "WhatsApp", "Lembretes", "Agenda", each with its DS-mapped Lucide icon (`MapPin`, `MessageCircle`, `Bell`, `Calendar`), an h3 title, and a body-sm description in `text-text-secondary`

#### Scenario: Each card navigates to its sub-route

- **WHEN** the psychologist clicks the "WhatsApp" card
- **THEN** the browser navigates to `/configuracoes/integracoes/whatsapp`

#### Scenario: Each card navigates to its sub-route (Locais)

- **WHEN** the psychologist clicks the "Locais de atendimento" card
- **THEN** the browser navigates to `/configuracoes/locais`

#### Scenario: Each card navigates to its sub-route (Lembretes)

- **WHEN** the psychologist clicks the "Lembretes" card
- **THEN** the browser navigates to `/configuracoes/lembretes`

#### Scenario: Each card navigates to its sub-route (Agenda)

- **WHEN** the psychologist clicks the "Agenda" card
- **THEN** the browser navigates to `/configuracoes/agenda`

#### Scenario: Grid is responsive (mobile)

- **WHEN** the viewport width is 375px
- **THEN** the cards stack in a single column with full-width tap targets ≥ 44×44px

#### Scenario: Grid is responsive (tablet)

- **WHEN** the viewport width is 768px
- **THEN** the cards lay out in 2 columns

#### Scenario: Grid is responsive (desktop)

- **WHEN** the viewport width is 1280px
- **THEN** the cards lay out in 3 columns

#### Scenario: Cards use Card interactive variant from DS

- **WHEN** the psychologist hovers any card on a pointing device
- **THEN** the card shows the DS `Card interactive` hover state (border `border-strong`, cursor pointer) and the entire card area is the click target

#### Scenario: Index page does not fetch from database

- **WHEN** the page is rendered in production
- **THEN** the request to `/configuracoes` issues no Supabase query and renders entirely from static data co-located in `settings-areas.ts`

### Requirement: Breadcrumb persists across all settings sub-routes

The system SHALL render a `Breadcrumb` (shadcn `breadcrumb`) at the top of every page under `/configuracoes/*` except the index itself. The breadcrumb MUST be implemented in a group layout at `src/app/(app)/configuracoes/layout.tsx` so it is not duplicated per page. Segment labels MUST come from a single source of truth (`settings-areas.ts`) and MUST use the DS glossary ("Configurações", not "Configuracoes" nor "Preferências"). The breadcrumb MUST have `aria-label="breadcrumb"` and each link MUST be keyboard-focusable. The last (current) segment MUST be rendered as `text-text-primary` non-link; intermediate segments MUST be rendered as links with `text-text-tertiary` hover `text-text-primary`.

#### Scenario: Breadcrumb is absent on the index

- **WHEN** the psychologist is on `/configuracoes`
- **THEN** no breadcrumb is rendered (the h1 "Configurações" suffices as the only header)

#### Scenario: Breadcrumb on first-level sub-routes

- **WHEN** the psychologist is on `/configuracoes/locais`
- **THEN** the breadcrumb renders `Configurações > Locais de atendimento` with the first segment as a link to `/configuracoes` and the last segment as non-link `text-text-primary`

#### Scenario: Breadcrumb on second-level sub-routes (WhatsApp)

- **WHEN** the psychologist is on `/configuracoes/integracoes/whatsapp`
- **THEN** the breadcrumb renders `Configurações > WhatsApp` (the `integracoes` intermediate segment is collapsed; only labeled areas appear)

#### Scenario: Breadcrumb on Lembretes tabs

- **WHEN** the psychologist is on `/configuracoes/lembretes/templates`
- **THEN** the breadcrumb renders `Configurações > Lembretes > Templates`

#### Scenario: Breadcrumb intermediate links navigate up

- **WHEN** the psychologist is on `/configuracoes/lembretes/templates` and clicks the "Configurações" segment
- **THEN** the browser navigates to `/configuracoes`

#### Scenario: Breadcrumb intermediate links navigate up (one level)

- **WHEN** the psychologist is on `/configuracoes/lembretes/templates` and clicks the "Lembretes" segment
- **THEN** the browser navigates to `/configuracoes/lembretes`

#### Scenario: Breadcrumb is keyboard accessible

- **WHEN** the psychologist tabs through the page from the sidebar
- **THEN** focus reaches each breadcrumb link in order and Enter on a focused link navigates

### Requirement: Lembretes section uses internal tabs for its three sub-views

The system SHALL render an internal tab bar at the top of `/configuracoes/lembretes` and all its sub-routes, with exactly three tabs in this order: "Configuração" → `/configuracoes/lembretes`, "Templates" → `/configuracoes/lembretes/templates`, "Histórico" → `/configuracoes/lembretes/historico`. The tab bar MUST be implemented in a layout at `src/app/(app)/configuracoes/lembretes/layout.tsx` so navigating between tabs preserves the tab bar without remounting. Tabs MUST follow the DS `Tabs` underline pattern (idle: `text-text-secondary`; active: `text-text-primary`, `border-b-2 border-brand-500`; padding `space-3 space-4`). Each tab MUST be a `<Link>` (not state-controlled) so that deep-links, back-button, and refresh all work. The active tab MUST be determined by `pathname.startsWith` of the tab href, with the most specific match winning. In viewports below `sm` (640px), the tab bar MUST be horizontally scrollable (`overflow-x-auto`) and each tab MUST remain ≥ 44×44px touch target.

#### Scenario: Tab bar renders the three lembretes views

- **WHEN** the psychologist is on `/configuracoes/lembretes`
- **THEN** the page renders a tab bar with three tabs labeled "Configuração", "Templates", "Histórico" in that order

#### Scenario: Configuração tab is active by default

- **WHEN** the psychologist is on `/configuracoes/lembretes`
- **THEN** the "Configuração" tab has DS active styling (text `text-text-primary`, border-bottom 2px `brand-500`) and the other tabs have idle styling

#### Scenario: Templates tab is active on templates routes

- **WHEN** the psychologist is on `/configuracoes/lembretes/templates`
- **THEN** the "Templates" tab is active and the other tabs are idle

#### Scenario: Templates tab is active on a specific template page

- **WHEN** the psychologist is on `/configuracoes/lembretes/templates/<templateKey>`
- **THEN** the "Templates" tab is active (most specific prefix match)

#### Scenario: Histórico tab is active on history route

- **WHEN** the psychologist is on `/configuracoes/lembretes/historico`
- **THEN** the "Histórico" tab is active

#### Scenario: Clicking a tab navigates to its URL

- **WHEN** the psychologist is on `/configuracoes/lembretes` and clicks the "Templates" tab
- **THEN** the browser navigates to `/configuracoes/lembretes/templates` and the new URL is reflected in `history` (back button returns to `/configuracoes/lembretes`)

#### Scenario: Tab bar scrolls on narrow viewport

- **WHEN** the viewport is 375px wide on `/configuracoes/lembretes`
- **THEN** the tab bar is horizontally scrollable and each tab keeps a touch target ≥ 44×44px

### Requirement: Settings sub-pages do not render their own page title duplicating the breadcrumb tail

The system SHALL ensure that pages under `/configuracoes/*` use the breadcrumb as their sole top-level wayfinding indicator and render their own h1 only when it adds information beyond the breadcrumb tail. Specifically, `/configuracoes/lembretes` MUST NOT render an h1 "Configurações de Lembretes" — the breadcrumb "Configurações > Lembretes" already names it; the tab bar names the current sub-view. Pages MAY render an h2 for sub-sections within their content area.

#### Scenario: Lembretes page omits redundant page title

- **WHEN** the psychologist is on `/configuracoes/lembretes`
- **THEN** the page does not render the previous h1 "Configuracoes de Lembretes"; the breadcrumb "Configurações > Lembretes" and the tab bar suffice for wayfinding

#### Scenario: Locais and Agenda pages keep a single h1

- **WHEN** the psychologist is on `/configuracoes/locais` or `/configuracoes/agenda`
- **THEN** the page renders exactly one h1 matching the breadcrumb tail (using `Configurações` cedilla-correct spelling where applicable)

### Requirement: Settings shell respects Server Components by default

The system SHALL keep the index `page.tsx`, the group `layout.tsx`, and the `lembretes/layout.tsx` as Server Components. The only client component permitted in the settings shell is the breadcrumb (which reads `usePathname`) and the tab bar (which reads `usePathname` to mark the active tab). No state, effect, or browser API SHALL be introduced in the index page itself.

#### Scenario: Index page is a Server Component

- **WHEN** `src/app/(app)/configuracoes/page.tsx` is inspected
- **THEN** the file does not begin with the `'use client'` directive

#### Scenario: Group layout is a Server Component

- **WHEN** `src/app/(app)/configuracoes/layout.tsx` is inspected
- **THEN** the file does not begin with the `'use client'` directive; only its imported breadcrumb component is a client component

#### Scenario: Lembretes layout is a Server Component

- **WHEN** `src/app/(app)/configuracoes/lembretes/layout.tsx` is inspected
- **THEN** the file does not begin with the `'use client'` directive; only its imported tab bar is a client component
