## MODIFIED Requirements

### Requirement: Sticky public header with brand, nav, and CTAs

The system SHALL render a sticky header at the top of every public page containing: the Hubrity logo (horizontal lockup) linking to `/`; navigation links "Funcionalidades" (anchor to `#funcionalidades` on the homepage) and "Preços" (link to `/precos`); a secondary "Entrar" button linking to `/login`; and a primary "Começar grátis" button linking to `/signup`. The header height is 72px on desktop and 60px on mobile, using DS tokens. On desktop the logo SHALL sit at the left edge while the nav links and both CTAs SHALL be grouped together in a single right-aligned cluster (the nav is NOT center-spread). The "Entrar" control SHALL use the DS **secondary** (bordered) button variant — not a borderless ghost/text style — in both the desktop bar and the mobile menu.

#### Scenario: Header links resolve to the correct destinations

- **WHEN** the public header renders for an anonymous visitor
- **THEN** the logo links to `/`, "Preços" links to `/precos`, "Entrar" links to `/login`, and "Começar grátis" links to `/signup`

#### Scenario: Funcionalidades anchor targets the homepage section

- **WHEN** the visitor is on `/` and activates "Funcionalidades"
- **THEN** the viewport scrolls to the element with id `funcionalidades`
- **WHEN** the visitor is on a non-homepage public page (e.g. `/precos`) and activates "Funcionalidades"
- **THEN** the link navigates to `/#funcionalidades`

#### Scenario: Nav and CTAs are grouped in a right-aligned cluster

- **WHEN** the desktop header renders
- **THEN** the "Funcionalidades"/"Preços" links sit adjacent to the "Entrar" and "Começar grátis" buttons in a single right-aligned group, with the logo alone on the left

#### Scenario: Entrar uses the secondary bordered button variant

- **WHEN** the header (or the open mobile menu) renders for an anonymous visitor
- **THEN** "Entrar" is rendered as the DS secondary bordered button, not a borderless ghost/text control

### Requirement: Public footer

The system SHALL render a footer on every public page (rendered in the dark surface), containing: the Hubrity brand lockup (the tricolor symbol with a light "hubrity" wordmark on the dark surface) and the tagline "O sistema único para o consultório de psicólogos autônomos no Brasil."; a "Produto" column (Funcionalidades anchor, Preços); a "Legal" column (Política de Privacidade, Termos de Uso); a "Contato" column (support email `suporte@hubrity.com`); and a copyright line "© 2026 Hubrity. Feito para psicólogos autônomos brasileiros." The footer layout SHALL place the brand block on the left with the three link columns clustered to the right, and the column headings SHALL use the uppercase tertiary caption style. The footer component MUST be reusable by the authenticated app.

#### Scenario: Footer legal links resolve to functional pages

- **WHEN** the footer renders
- **THEN** "Política de Privacidade" links to `/politica-de-privacidade`, "Termos de Uso" links to `/termos-de-uso`, and the support email `suporte@hubrity.com` is rendered as a `mailto:` link

#### Scenario: Footer Legal column omits the standalone LGPD link

- **WHEN** the footer Legal column renders
- **THEN** it contains exactly two links — Política de Privacidade and Termos de Uso — and no separate "LGPD" link

#### Scenario: Footer brand lockup uses the dark-surface tone

- **WHEN** the footer renders on its dark surface
- **THEN** the brand symbol keeps its tricolor fills and the "hubrity" wordmark renders light, not an all-white lockup

#### Scenario: Footer is a contentinfo landmark

- **WHEN** the footer renders
- **THEN** it is exposed as a single `contentinfo` landmark with accessible column headings
