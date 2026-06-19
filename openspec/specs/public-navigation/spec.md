# public-navigation Specification

## Purpose

Defines the navigation chrome of the public marketing site: the sticky header (brand, nav links, CTAs, scrolled state, mobile hamburger, authenticated-visitor variant) and the public footer. Created by syncing change `public-site-foundation`.

## Requirements

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

### Requirement: Header solid-opaque scrolled state without blur

The header SHALL be transparent over the hero at scroll position 0 and switch to a **solid opaque** surface (`bg/surface` background, `border/subtle` bottom border, `Shadow/Light/xs`) once the page is scrolled. Backdrop-blur / glassmorphism MUST NOT be used (prohibited by the Design System).

#### Scenario: Header becomes opaque on scroll

- **WHEN** the user scrolls the page downward past the threshold
- **THEN** the header gains the solid `bg/surface` background, a `border/subtle` bottom border, and `Shadow/Light/xs`, and uses no `backdrop-filter`/blur

#### Scenario: No backdrop-blur is applied in any state

- **WHEN** the header is inspected in either the top or scrolled state
- **THEN** its computed style contains no `backdrop-filter` blur

### Requirement: Mobile hamburger navigation with persistent primary CTA

On viewports below the desktop breakpoint, the navigation links SHALL collapse into a hamburger menu, while the "Começar grátis" primary CTA remains always visible in the header bar. The hamburger toggle and menu MUST be keyboard-operable with correct ARIA (`aria-expanded`, `aria-controls`), close on Escape, and trap focus while open. All interactive targets MUST be ≥ 44×44px.

#### Scenario: Hamburger toggles the mobile menu

- **WHEN** a mobile user activates the hamburger button
- **THEN** `aria-expanded` becomes `true`, the menu reveals "Funcionalidades", "Preços", and "Entrar", while "Começar grátis" stays visible in the bar

#### Scenario: Menu closes on Escape and restores focus

- **WHEN** the mobile menu is open and the user presses Escape
- **THEN** the menu closes, `aria-expanded` becomes `false`, and focus returns to the hamburger button

#### Scenario: No-JS fallback exposes inline links

- **WHEN** JavaScript is disabled
- **THEN** a `<noscript>` fallback renders the navigation links inline so the menu is not required to navigate

### Requirement: Authenticated-visitor header variant

When the request carries a valid active session, the header SHALL replace "Entrar" and "Começar grátis" with a single "Acessar plataforma" button linking to `/dashboard`. The marketing page itself MUST NOT redirect — an authenticated psychologist can still browse and share the link.

#### Scenario: Active user sees the platform CTA

- **WHEN** an authenticated active user loads a public page
- **THEN** the header shows "Acessar plataforma" → `/dashboard` and does not show "Entrar"/"Começar grátis", and the page is not redirected

#### Scenario: Anonymous visitor sees the default CTAs

- **WHEN** an anonymous visitor loads a public page
- **THEN** the header shows "Entrar" and "Começar grátis" and not "Acessar plataforma"

### Requirement: Session presence is resolved via `supabase.auth.getUser()`

The header's authenticated/anonymous variant decision SHALL be derived from `supabase.auth.getUser()` on the server (cookie-bearing RLS-scoped client), never from `getSession()`, and MUST only expose a boolean "is authenticated" signal — no user id, email, or profile field is rendered into the public markup.

#### Scenario: No PII reaches public markup

- **WHEN** the authenticated header variant renders
- **THEN** the served HTML contains no email, user id, CRP, or name — only the "Acessar plataforma" affordance

### Requirement: Public footer

The system SHALL render a footer on every public page (rendered in the dark surface), containing: the Hubrity brand lockup (the tricolor symbol with a light "hubrity" wordmark on the dark surface) and the tagline "O sistema único para o consultório de psicólogos autônomos no Brasil."; a "Produto" column (Funcionalidades anchor, Preços); a "Legal" column (Política de Privacidade, Termos de Uso); a "Contato" column (support email `hubrity.platform@gmail.com`); and a copyright line "© 2026 Hubrity. Feito para psicólogos autônomos brasileiros." The footer layout SHALL place the brand block on the left with the three link columns clustered to the right, and the column headings SHALL use the uppercase tertiary caption style. The footer component MUST be reusable by the authenticated app.

#### Scenario: Footer legal links resolve to functional pages

- **WHEN** the footer renders
- **THEN** "Política de Privacidade" links to `/politica-de-privacidade`, "Termos de Uso" links to `/termos-de-uso`, and the support email `hubrity.platform@gmail.com` is rendered as a `mailto:` link

#### Scenario: Footer Legal column omits the standalone LGPD link

- **WHEN** the footer Legal column renders
- **THEN** it contains exactly two links — Política de Privacidade and Termos de Uso — and no separate "LGPD" link

#### Scenario: Footer brand lockup uses the dark-surface tone

- **WHEN** the footer renders on its dark surface
- **THEN** the brand symbol keeps its tricolor fills and the "hubrity" wordmark renders light, not an all-white lockup

#### Scenario: Footer is a contentinfo landmark

- **WHEN** the footer renders
- **THEN** it is exposed as a single `contentinfo` landmark with accessible column headings
