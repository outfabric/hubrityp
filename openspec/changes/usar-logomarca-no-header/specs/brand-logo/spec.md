## ADDED Requirements

### Requirement: Reusable Logo component with variant and tone props

The system SHALL provide a reusable `Logo` component at `src/shared/ui/logo.tsx` that renders the Hubrity brand identity from the assets in `public/brand/`. The component MUST accept a `variant` prop with the values `"lockup-h"` (horizontal lockup: symbol + "hubrity" wordmark), `"lockup-v"` (vertical lockup), and `"symbol"` (symbol only). The component MUST accept a `tone` prop with the values `"color"`, `"white"`, and `"mono"`. When no `variant` is provided the component SHALL default to `"lockup-h"`; when no `tone` is provided it SHALL default to `"color"`.

#### Scenario: Default variant and tone

- **WHEN** the `Logo` component is rendered without `variant` or `tone` props
- **THEN** it renders the horizontal lockup in full color (symbol + "hubrity" wordmark)

#### Scenario: Symbol variant renders the symbol only

- **WHEN** the `Logo` component is rendered with `variant="symbol"`
- **THEN** it renders only the brand symbol (the "H" mark) without the "hubrity" wordmark

#### Scenario: Vertical lockup variant

- **WHEN** the `Logo` component is rendered with `variant="lockup-v"`
- **THEN** it renders the symbol stacked above the "hubrity" wordmark

### Requirement: Logo renders brand assets as inline SVG

The system SHALL render the `Logo` component as inline SVG markup, NOT via `next/image` and NOT via an `<img>` element. This is a deliberate, documented exception to the project's default "always `next/image`" rule, justified by the need to retint the mark via `currentColor` (covering the `white` and `mono` tones from a single source) and to avoid extra network requests for small static marks. The justification MUST be recorded in a comment in `src/shared/ui/logo.tsx`.

#### Scenario: Logo output is inline SVG

- **WHEN** a page rendering the `Logo` component is inspected
- **THEN** the brand mark is present as an inline `<svg>` element and there is no `<img>` element nor a `next/image`-generated element representing the logo

### Requirement: Logo exposes the accessible name "Hubrity"

The system SHALL give every rendered `Logo` an accessible name of `"Hubrity"`, regardless of `variant` or `tone`, via `role="img"` plus an `aria-label` and/or an SVG `<title>` element. The `symbol` variant, which has no visible wordmark, MUST still expose the same accessible name so assistive technology announces the brand.

#### Scenario: Lockup exposes accessible name

- **WHEN** the `Logo` is rendered with any lockup variant
- **THEN** it exposes `role="img"` and an accessible name of "Hubrity"

#### Scenario: Symbol-only variant still names the brand

- **WHEN** the `Logo` is rendered with `variant="symbol"`
- **THEN** it still exposes an accessible name of "Hubrity" (not empty, not "H")

### Requirement: Mono and white tones inherit the current text color

The system SHALL render the `mono` and `white` tones using `currentColor` so the mark adopts the surrounding text color rather than hard-coded fills, allowing a single inline SVG to serve dark, light, and single-color contexts. The `color` tone SHALL preserve the brand palette (sálvia `#587355`, azul-sereno `#5B7A93`, teal `#3F6F63`).

#### Scenario: Mono tone follows currentColor

- **WHEN** the `Logo` is rendered with `tone="mono"` inside a container with a given text color
- **THEN** the mark's fill resolves to `currentColor` and visually matches that text color

#### Scenario: Color tone preserves the brand palette

- **WHEN** the `Logo` is rendered with `tone="color"`
- **THEN** the symbol uses the brand colors sálvia, azul-sereno, and teal and does not inherit `currentColor`

### Requirement: Logo is non-interactive by default

The system SHALL render the `Logo` as a non-interactive brand mark by default — it MUST NOT wrap the mark in a link or button and MUST NOT change the existing navigation behavior of the surfaces that adopt it. Replacing a text wordmark with the `Logo` preserves the prior behavior (the wordmark was a non-interactive element).

#### Scenario: Logo is not a link

- **WHEN** the `Logo` component is rendered on any surface in this change
- **THEN** the mark is not wrapped in an anchor (`<a>`) or button and clicking it triggers no navigation

### Requirement: Public and home surfaces render the Logo instead of the text wordmark

The system SHALL replace the plain-text `HubrityP` wordmark with the `Logo` component on the home page and the public token-gated layouts. Specifically: `src/app/page.tsx` (home) SHALL render a prominent vertical lockup; and `src/app/termo/layout.tsx`, `src/app/escala/layout.tsx`, `src/app/confirmar-sessao/layout.tsx`, and `src/app/v/[token]/layout.tsx` SHALL render the centered Logo in place of their current `<span>HubrityP</span>` headers. These surfaces remain public; this change does not alter their auth classification.

#### Scenario: Home page shows the brand logo

- **WHEN** a visitor loads `/`
- **THEN** the page renders the Hubrity `Logo` (vertical lockup) and no longer renders the plain-text "HubrityP" heading

#### Scenario: Public token layout shows the brand logo

- **WHEN** a patient opens a public token page (e.g., `/termo/:token`, `/escala/:token`, `/confirmar-sessao/:token`, `/v/:token`)
- **THEN** the centered header renders the Hubrity `Logo` instead of the plain-text "HubrityP"
