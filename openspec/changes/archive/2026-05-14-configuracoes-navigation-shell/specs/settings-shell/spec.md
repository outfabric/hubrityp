## ADDED Requirements

### Requirement: Settings index page displays interactive cards for each settings area

The system SHALL render a Server Component page at `/configuracoes` displaying 4 interactive cards in a responsive grid. Each card uses `Card interactive` (DS: bg `surface`, border `border`, radius `xl`, shadow `xs`, padding `space-6`; hover: border `border-strong`, cursor pointer). The grid is 1 column on mobile (<640px), 2 columns on md (>=768px), and 3 columns on lg (>=1024px), with gap `space-6`. Each card displays a Lucide icon (20px, `text-text-secondary`), a label in `h3` style (18px/600, `text-text-primary`), and a description in `body-sm` (13px/400, `text-text-secondary`). Cards link to their respective settings area via `next/link`. Card data is static (no DB fetch, no Suspense).

The page title is an `<h1>` "Configurações" (28px/600, `text-text-primary`), consistent with the DS heading hierarchy (h1 unique per page). The page uses `data-testid="settings-index-page"` on the container and `data-testid="settings-area-card-{slug}"` on each card (where slug is: `locais`, `whatsapp`, `lembretes`, `agenda`).

Cards and their content (exact microcopy):
- Locais de atendimento / "Endereços e modalidades onde você atende presencial ou online." / `MapPin` / href `/configuracoes/locais`
- WhatsApp / "Conecte sua conta do WhatsApp para enviar lembretes e mensagens." / `MessageCircle` / href `/configuracoes/integracoes/whatsapp`
- Lembretes / "Personalize quando e como avisar pacientes sobre suas sessões." / `Bell` / href `/configuracoes/lembretes`
- Agenda / "Horários de trabalho, duração padrão e regras de agendamento." / `Calendar` / href `/configuracoes/agenda`

Tap targets on mobile SHALL be at least 44x44px. Icons are decorative (`aria-hidden="true"`). Each card has a visible focus ring (`shadow-focus`) for keyboard navigation.

#### Scenario: Index page renders 4 cards with correct labels and icons

- **WHEN** psychologist navigates to `/configuracoes`
- **THEN** the page displays an h1 "Configurações" and 4 interactive cards with labels "Locais de atendimento", "WhatsApp", "Lembretes", and "Agenda", each with its prescribed Lucide icon

#### Scenario: Card navigates to the correct settings area

- **WHEN** psychologist clicks the "WhatsApp" card
- **THEN** the browser navigates to `/configuracoes/integracoes/whatsapp`

#### Scenario: Grid is responsive — 1 column on mobile

- **WHEN** viewport width is 375px
- **THEN** the cards are in a single column stack and each card has a minimum tap target of 44x44px

#### Scenario: Grid is responsive — 2 columns on md

- **WHEN** viewport width is 768px
- **THEN** the cards are in a 2-column grid

#### Scenario: Grid is responsive — 3 columns on lg

- **WHEN** viewport width is 1024px
- **THEN** the cards are in a 3-column grid with gap space-6

#### Scenario: Cards are keyboard-navigable

- **WHEN** psychologist uses Tab key on the index page
- **THEN** focus moves through each card sequentially with a visible focus ring (shadow-focus), and pressing Enter activates the focused card's link

#### Scenario: No loading state on index

- **WHEN** psychologist navigates to `/configuracoes`
- **THEN** the page renders immediately without any loading spinner or skeleton — data is static

### Requirement: Settings layout renders a persistent breadcrumb

The system SHALL provide a `layout.tsx` at `src/app/(app)/configuracoes/layout.tsx` that renders a breadcrumb navigation above `{children}`. The breadcrumb uses the shadcn `Breadcrumb` component pattern with `ChevronRight` separators (Lucide, 12px, `aria-hidden="true"`). Breadcrumb text uses `body-sm` (13px) in `text-text-tertiary`, with the current (last) segment in `text-text-primary` and `font-medium`. Intermediate segments are `<Link>` elements with `hover:text-text-primary` transition (`duration-fast`). The layout has `data-testid="settings-breadcrumb"` on the `<nav>` element.

The breadcrumb maps URL segments to human-readable labels using a static lookup:

| Segment | Label |
|---|---|
| `configuracoes` | Configurações |
| `locais` | Locais de atendimento |
| `integracoes` | Integrações |
| `whatsapp` | WhatsApp |
| `lembretes` | Lembretes |
| `templates` | Templates |
| `historico` | Histórico |
| `agenda` | Agenda |

On the index page (`/configuracoes`), the breadcrumb shows only "Configurações" as the current page (non-linked). On sub-routes, intermediate segments are linked. Dynamic segments (e.g., `[templateKey]`) render as the raw segment value.

The layout does NOT duplicate the app shell (header, sidebar). It nests inside `src/app/(app)/layout.tsx` and adds only the breadcrumb wrapper and consistent page padding (`mx-auto max-w-[1200px]`).

#### Scenario: Breadcrumb on index page shows only root

- **WHEN** psychologist is on `/configuracoes`
- **THEN** the breadcrumb shows "Configurações" as non-linked current page text

#### Scenario: Breadcrumb on first-level sub-route

- **WHEN** psychologist is on `/configuracoes/locais`
- **THEN** the breadcrumb shows "Configurações" (linked to `/configuracoes`) > "Locais de atendimento" (current page, non-linked)

#### Scenario: Breadcrumb on deeply nested sub-route

- **WHEN** psychologist is on `/configuracoes/lembretes/templates`
- **THEN** the breadcrumb shows "Configurações" (linked) > "Lembretes" (linked to `/configuracoes/lembretes`) > "Templates" (current page)

#### Scenario: Breadcrumb intermediate link navigates correctly

- **WHEN** psychologist is on `/configuracoes/lembretes/templates` and clicks "Configurações" in the breadcrumb
- **THEN** the browser navigates to `/configuracoes`

#### Scenario: Breadcrumb for whatsapp nested under integrações

- **WHEN** psychologist is on `/configuracoes/integracoes/whatsapp`
- **THEN** the breadcrumb shows "Configurações" (linked) > "Integrações" (linked to `/configuracoes/integracoes`) > "WhatsApp" (current page)

#### Scenario: Breadcrumb with dynamic segment renders raw value

- **WHEN** psychologist is on `/configuracoes/lembretes/templates/lembrete_24h`
- **THEN** the breadcrumb shows "Configurações" > "Lembretes" > "Templates" > "lembrete_24h" (current page), with all intermediate segments linked

### Requirement: Lembretes area renders tab navigation for its sub-sections

The system SHALL render `Tabs underline` (DS) at the top of the Lembretes area for its 3 sub-sections. Tabs are `<Link>` elements (not state-controlled) preserving deep-link, refresh, and back/forward behavior. Each tab has padding `space-3` vertical, `space-4` horizontal. Idle tabs have `text-text-secondary`. The active tab has `text-text-primary` and `border-bottom` 2px `brand-500`. Tab activation is determined by `pathname` matching.

Tab definitions:
- "Configuração" → href `/configuracoes/lembretes` (exact match)
- "Templates" → href `/configuracoes/lembretes/templates` (startsWith match, covers `/templates/[templateKey]`)
- "Histórico" → href `/configuracoes/lembretes/historico` (exact match)

The tab bar has `data-testid="lembretes-tabs"`. Each tab has `data-testid="lembretes-tab-{slug}"` (slug: `configuracao`, `templates`, `historico`). On mobile, if the tab bar overflows, it scrolls horizontally with `overflow-x-auto` and `-webkit-overflow-scrolling: touch`. Each tab has a minimum height of 44px for tap targets.

The tab component is rendered within a `layout.tsx` at `src/app/(app)/configuracoes/lembretes/layout.tsx`, so it persists across Lembretes sub-routes.

#### Scenario: Lembretes page shows 3 tabs

- **WHEN** psychologist navigates to `/configuracoes/lembretes`
- **THEN** 3 tabs are visible: "Configuração", "Templates", "Histórico", with "Configuração" active (text-primary, border-bottom brand-500)

#### Scenario: Clicking Templates tab navigates and activates

- **WHEN** psychologist clicks the "Templates" tab
- **THEN** the URL changes to `/configuracoes/lembretes/templates`, the "Templates" tab becomes active, and the Templates page content renders

#### Scenario: Deep-link to Histórico tab works

- **WHEN** psychologist enters `/configuracoes/lembretes/historico` directly in the browser
- **THEN** the page loads with the "Histórico" tab active and Histórico content visible

#### Scenario: Templates tab is active on template edit page

- **WHEN** psychologist is on `/configuracoes/lembretes/templates/lembrete_24h`
- **THEN** the "Templates" tab is active (startsWith match)

#### Scenario: Browser back/forward preserves tab state

- **WHEN** psychologist navigates from "Configuração" to "Templates" to "Histórico", then presses Back twice
- **THEN** the browser navigates to "Configuração" tab with correct active state

#### Scenario: Mobile tab bar scrolls horizontally

- **WHEN** viewport width is 375px
- **THEN** the tab bar supports horizontal scroll if content overflows, each tab has minimum height 44px

#### Scenario: Tabs are keyboard-navigable

- **WHEN** psychologist uses Tab key in the Lembretes area
- **THEN** focus moves through each tab link with visible focus ring (shadow-focus), and Enter activates the focused tab

### Requirement: Integrações index page lists available integrations

The system SHALL render a Server Component page at `/configuracoes/integracoes` displaying a list of available integrations as `Card interactive` (DS) in the same responsive grid pattern as the main settings index (1 column mobile, 2 columns md, 3 columns lg, gap `space-6`). For v1, a single card is rendered: WhatsApp. The page exists so the breadcrumb segment "Integrações" links to a real destination instead of producing a 404.

The page title is `<h1>` "Integrações" (28px/600, `text-text-primary`). Card data is static, sourced from a co-located constant in `src/app/(app)/configuracoes/integracoes/integrations.ts` exporting `INTEGRATIONS` (analogous to `SETTINGS_AREAS`). Each card has `data-testid="integration-card-{slug}"`. Container has `data-testid="integrations-index-page"`.

v1 card content:
- WhatsApp / "Conecte sua conta para enviar lembretes e mensagens." / `MessageCircle` / href `/configuracoes/integracoes/whatsapp` / slug `whatsapp`

The card uses the same `Card interactive` styling, focus ring, tap target, and a11y rules as the main settings index cards (see Requirement: Settings index page displays interactive cards). The grid is responsive even with 1 card so adding future integrations (Asaas, Receita Saúde, Google Calendar, e-CAC) requires only appending to `INTEGRATIONS`.

#### Scenario: Integrações index renders with WhatsApp card

- **WHEN** psychologist navigates to `/configuracoes/integracoes`
- **THEN** the page displays an h1 "Integrações" and a single interactive card with label "WhatsApp", description "Conecte sua conta para enviar lembretes e mensagens.", and `MessageCircle` icon

#### Scenario: WhatsApp card on integrações index navigates to its area

- **WHEN** psychologist clicks the WhatsApp card on `/configuracoes/integracoes`
- **THEN** the browser navigates to `/configuracoes/integracoes/whatsapp`

#### Scenario: Breadcrumb segment "Integrações" navigates to integrações index

- **WHEN** psychologist is on `/configuracoes/integracoes/whatsapp` and clicks "Integrações" in the breadcrumb
- **THEN** the browser navigates to `/configuracoes/integracoes` and the index page renders with no 404

#### Scenario: Integrações index breadcrumb shows correct trail

- **WHEN** psychologist is on `/configuracoes/integracoes`
- **THEN** the breadcrumb shows "Configurações" (linked to `/configuracoes`) > "Integrações" (current page, non-linked)

#### Scenario: Integrações index grid is responsive

- **WHEN** viewport width is 375px
- **THEN** the card stacks in a single column with tap target ≥ 44×44px; same grid layout adapts to 2 cols at 768px and 3 cols at 1024px once additional integrations exist

### Requirement: Template edit page uses layout breadcrumb instead of manual breadcrumb

The system SHALL remove the manual breadcrumb from `src/app/(app)/configuracoes/lembretes/templates/[templateKey]/page.tsx`. The shared layout breadcrumb at `configuracoes/layout.tsx` provides the hierarchical trail instead. The page retains its `<h1>` with the template label.

#### Scenario: Template edit page has no duplicate breadcrumb

- **WHEN** psychologist navigates to `/configuracoes/lembretes/templates/lembrete_24h`
- **THEN** only one breadcrumb is visible (from the layout), not two

#### Scenario: Template edit page retains its title

- **WHEN** psychologist navigates to `/configuracoes/lembretes/templates/lembrete_24h`
- **THEN** the page `<h1>` still shows the human-readable template label (e.g., "Lembrete 24h antes")

### Requirement: Settings navigation E2E tests cover all critical user flows

The system SHALL include E2E tests in `src/__tests__/e2e/seeded/configuracoes-navigation.spec.ts` covering:
- Sidebar navigation to index, index renders 4 cards
- Card navigation to each of the 4 settings areas
- Breadcrumb navigation back to index from sub-routes
- Breadcrumb intermediate link "Integrações" navigates to `/configuracoes/integracoes` (no 404)
- Integrações index renders with the WhatsApp card and the card navigates correctly
- Lembretes tabs: switching between 3 tabs with URL and active state assertions
- Deep-link to each Lembretes tab
- Browser back/forward with tabs
- Breadcrumb on nested routes (e.g., `/configuracoes/lembretes/templates`)
- Mobile viewport (375x667): grid in 1 column, tabs with horizontal scroll, tap targets >= 44px
- Keyboard navigation: Tab through cards and tabs, Enter activates, focus ring visible

#### Scenario: E2E covers sidebar to index to card to area round-trip

- **WHEN** E2E test runs: login, click sidebar "Configurações", assert URL `/configuracoes`, click "Locais de atendimento" card, assert URL `/configuracoes/locais`
- **THEN** the test passes confirming the full navigation path works

#### Scenario: E2E covers Lembretes tab switching and deep-links

- **WHEN** E2E test navigates to `/configuracoes/lembretes`, clicks each tab, asserts URL and active styling, then navigates directly to `/configuracoes/lembretes/historico`
- **THEN** the test passes confirming tab navigation and deep-linking work

#### Scenario: E2E covers mobile responsiveness

- **WHEN** E2E test sets viewport to 375x667 and navigates to `/configuracoes`
- **THEN** the test asserts cards are in 1-column layout and tap targets meet the 44px minimum

#### Scenario: E2E covers keyboard navigation

- **WHEN** E2E test uses keyboard Tab and Enter to navigate cards and tabs
- **THEN** the test asserts focus ring is visible on focused elements and Enter activates navigation
