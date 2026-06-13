## ADDED Requirements

### Requirement: App header renders the brand logomark

The system SHALL render the Hubrity logomark in the authenticated app header (`src/app/(app)/layout.tsx`) in place of the plain-text `HubrityP` wordmark. On viewports at the `md` breakpoint and above, the header SHALL render the horizontal lockup (`variant="lockup-h"`); below `md`, where horizontal space is constrained by the sidebar toggle, it SHALL render the symbol only (`variant="symbol"`), honoring the brand manual's minimum-size rule (horizontal lockup ≥ 120px wide; below that, symbol only). The header logo MUST remain non-interactive (not a link), preserving the prior behavior, and MUST expose the accessible name "Hubrity".

#### Scenario: Desktop header shows the horizontal lockup

- **WHEN** a psychologist views any authenticated page on a viewport at or above the `md` breakpoint
- **THEN** the header renders the Hubrity horizontal lockup (symbol + "hubrity" wordmark) and no longer renders the plain-text "HubrityP"

#### Scenario: Mobile header shows the symbol only

- **WHEN** a psychologist views any authenticated page on a viewport below the `md` breakpoint
- **THEN** the header renders only the Hubrity symbol (not the horizontal lockup)

#### Scenario: Header logo is non-interactive

- **WHEN** the header logo is rendered
- **THEN** it is not wrapped in a link and clicking it triggers no navigation

#### Scenario: Header logo exposes the brand name

- **WHEN** the header logo is rendered
- **THEN** it exposes `role="img"` with an accessible name of "Hubrity"

## MODIFIED Requirements

### Requirement: Application boots and serves the placeholder page

The system SHALL provide a Next.js 16+ App Router application that boots locally via `npm run dev` and renders the home page at `/`. The home page SHALL display the Hubrity brand logo (an inline SVG with the accessible name "Hubrity"). The application MUST also build successfully via `npm run build` and serve the built output via `npm run start`.

#### Scenario: Dev server boots and serves the home page

- **WHEN** a developer runs `npm run dev` and navigates to `http://localhost:3000`
- **THEN** the response is HTTP 200, the HTML contains the Hubrity brand logo (an inline `<svg>` with accessible name "Hubrity"), and there are no React or Next.js error overlays

#### Scenario: Production build succeeds

- **WHEN** a developer runs `npm run build` against a clean repository
- **THEN** the command exits 0, produces a `.next/` directory, and reports no compilation errors

#### Scenario: Production server serves the same home page

- **WHEN** a developer runs `npm run build && npm run start` and navigates to `http://localhost:3000`
- **THEN** the response is HTTP 200 and contains the Hubrity brand logo (inline `<svg>` with accessible name "Hubrity")
