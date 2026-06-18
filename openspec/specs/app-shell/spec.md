# app-shell Specification

## Purpose
TBD - created by archiving change bootstrap-foundation. Update Purpose after archive.
## Requirements
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

### Requirement: Root layout sets locale and base metadata

The system SHALL declare `src/app/layout.tsx` as the root layout with `<html lang="pt-BR">`, a global font configured via `next/font`, a no-flash theme-resolution inline script (see `design-system-foundation`), and a base `metadata` export setting at minimum the application title, a `metadataBase` derived from the configured site URL, and default Open Graph defaults (site name, locale `pt_BR`, type `website`, default `og:image`).

#### Scenario: Locale is pt-BR

- **WHEN** any page is rendered
- **THEN** the `<html>` element has `lang="pt-BR"`

#### Scenario: Font is loaded via next/font, not CSS

- **WHEN** the rendered HTML is inspected
- **THEN** the page does not include any `@import url(...)` for fonts and the font is delivered via `next/font` self-hosting

#### Scenario: metadataBase and OG defaults are set

- **WHEN** the root metadata is resolved
- **THEN** `metadataBase` equals the configured site URL and default Open Graph fields (site name, `pt_BR` locale, `website` type, default image) are present for child pages to inherit

#### Scenario: Theme is resolved before first paint

- **WHEN** a page loads with a stored dark preference
- **THEN** the inline head script sets `data-theme='dark'` before first paint, with no light-theme flash

### Requirement: Security response headers are set on every route

The system SHALL configure the following security headers via `next.config.ts` `headers()` and apply them to every route under `/`:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- A baseline `Content-Security-Policy` directive

The CSP MAY be extended with a host-allowlisted entry for the consent-gated analytics provider (added to `script-src` and `connect-src` only when an analytics host is configured). The CSP MUST NOT use a wildcard host and MUST NOT loosen `default-src` beyond `'self'` plus documented allowances. When no analytics host is configured, the CSP MUST remain the baseline (no analytics host present).

#### Scenario: HSTS is present

- **WHEN** a request is made to any route in production mode
- **THEN** the response includes `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`

#### Scenario: Clickjacking is blocked

- **WHEN** a request is made to any route
- **THEN** the response includes `X-Frame-Options: DENY`

#### Scenario: Referrer policy is strict-origin-when-cross-origin

- **WHEN** a request is made to any route
- **THEN** the response includes `Referrer-Policy: strict-origin-when-cross-origin`

#### Scenario: Baseline CSP is present

- **WHEN** a request is made to any route
- **THEN** the response includes a `Content-Security-Policy` header restricting `default-src` to `'self'` (with documented allowances for inline scripts required by Next.js hydration)

#### Scenario: Analytics host is allowlisted, not wildcarded

- **WHEN** an analytics host is configured and the CSP is emitted
- **THEN** the analytics host appears as an explicit entry in `script-src`/`connect-src`, no wildcard host is introduced, and `default-src` stays `'self'`

### Requirement: Tailwind and shadcn baseline are available

The system SHALL configure Tailwind CSS via `tailwind.config.ts` and `src/app/globals.css`, and SHALL initialize shadcn/ui by providing `components.json` (with `aliases.components` set to `@/shared/ui` and `aliases.utils` set to `@/shared/lib/utils`) and `src/shared/lib/utils.ts` exporting `cn(...inputs)`. No shadcn primitive components are required to be installed at this stage beyond those already present.

#### Scenario: Tailwind utility classes apply

- **WHEN** a Server or Client component uses a Tailwind utility class such as `text-3xl` or `bg-slate-50`
- **THEN** the rendered page applies the corresponding CSS

#### Scenario: cn() is importable from @/shared/lib/utils

- **WHEN** any source file imports `import { cn } from '@/shared/lib/utils'`
- **THEN** the import resolves, type-checks, and returns a string when called with class fragments

#### Scenario: components.json exists and is valid

- **WHEN** a developer runs `npx shadcn add <primitive>` (in a future change)
- **THEN** the shadcn CLI reads `components.json`, places the component under `src/shared/ui/<primitive>.tsx`, and the import path matches the configured aliases

### Requirement: Node version is pinned to 22 LTS

The system SHALL pin the runtime Node.js major version to 22 LTS via `.nvmrc` and via the `engines.node` field in `package.json`. The `CLAUDE.md` file MUST reflect this version.

#### Scenario: nvm picks the correct version

- **WHEN** a developer runs `nvm use` in the repository root
- **THEN** Node 22 (current LTS minor) becomes the active version

#### Scenario: package.json declares the engine

- **WHEN** any tool reads `package.json`
- **THEN** the `engines.node` field declares a range satisfied by Node 22 LTS (e.g., `>=22 <23`)

#### Scenario: CLAUDE.md states Node 22 LTS

- **WHEN** a contributor reads the Stack section of `CLAUDE.md`
- **THEN** the document states Node.js 22 LTS, not 20 LTS

### Requirement: Application root resolves to `src/app/`

The system SHALL place the App Router under `src/app/` (Next.js auto-detects the `src/` convention). The root `app/` directory MUST NOT exist at the repository root. The TypeScript path alias `@/*` MUST resolve to `./src/*` so that imports like `@/app/...`, `@/modules/...`, `@/shared/...`, and `@/__tests__/...` all work uniformly.

#### Scenario: Dev server discovers `src/app/`

- **WHEN** a developer runs `npm run dev`
- **THEN** Next.js detects `src/app/page.tsx` and serves it at `/` without requiring custom config

#### Scenario: Production build discovers `src/app/`

- **WHEN** a developer runs `npm run build`
- **THEN** the build succeeds and emits routes from `src/app/` into `.next/`

### Requirement: Root middleware lives at `src/middleware.ts`

The system SHALL place the Next.js root middleware at `src/middleware.ts` (matching the `src/` convention). Next.js auto-detects this location when `src/app/` is the App Router root.

#### Scenario: Middleware is invoked on matching requests

- **WHEN** any HTTP request matches the middleware's `matcher` (or its default scope)
- **THEN** the middleware in `src/middleware.ts` runs and the legacy `middleware.ts` at the repository root does not exist

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

### Requirement: App sidebar includes navigation to agenda

The system SHALL render an "Agenda" nav item in the main sidebar with the `Calendar` icon (Lucide). Clicking it navigates to `/app/agenda`. The item follows the sidebar nav DS pattern (idle: text secondary; hover: text primary, bg surface; active: text brand-700, bg brand-50, border-left 3px brand-500).

#### Scenario: Agenda nav item is visible

- **WHEN** psychologist is on any authenticated page
- **THEN** the sidebar shows "Agenda" with Calendar icon, positioned after "Pacientes"

#### Scenario: Agenda nav item is active on agenda pages

- **WHEN** psychologist is on /app/agenda
- **THEN** the "Agenda" nav item is highlighted with active styling

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

