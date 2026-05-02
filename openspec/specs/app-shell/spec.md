# app-shell Specification

## Purpose
TBD - created by archiving change bootstrap-foundation. Update Purpose after archive.
## Requirements
### Requirement: Application boots and serves the placeholder page

The system SHALL provide a Next.js 16+ App Router application that boots locally via `npm run dev` and renders a placeholder page at `/`. The application MUST also build successfully via `npm run build` and serve the built output via `npm run start`.

#### Scenario: Dev server boots and serves placeholder

- **WHEN** a developer runs `npm run dev` and navigates to `http://localhost:3000`
- **THEN** the response is HTTP 200, the HTML contains the text "HubrityP", and there are no React or Next.js error overlays

#### Scenario: Production build succeeds

- **WHEN** a developer runs `npm run build` against a clean repository
- **THEN** the command exits 0, produces a `.next/` directory, and reports no compilation errors

#### Scenario: Production server serves the same placeholder

- **WHEN** a developer runs `npm run build && npm run start` and navigates to `http://localhost:3000`
- **THEN** the response is HTTP 200 and contains "HubrityP"

### Requirement: Root layout sets locale and base metadata

The system SHALL declare `app/layout.tsx` as the root layout with `<html lang="pt-BR">`, a global font configured via `next/font`, and a base `metadata` export setting at minimum the application title.

#### Scenario: Locale is pt-BR

- **WHEN** any page is rendered
- **THEN** the `<html>` element has `lang="pt-BR"`

#### Scenario: Font is loaded via next/font, not CSS

- **WHEN** the rendered HTML is inspected
- **THEN** the page does not include any `@import url(...)` for fonts and the font is delivered via `next/font` self-hosting

### Requirement: Security response headers are set on every route

The system SHALL configure the following security headers via `next.config.ts` `headers()` and apply them to every route under `/`:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- A baseline `Content-Security-Policy` directive

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

### Requirement: Tailwind and shadcn baseline are available

The system SHALL configure Tailwind CSS via `tailwind.config.ts` and `app/globals.css`, and SHALL initialize shadcn/ui by providing `components.json` and `lib/utils.ts` exporting `cn(...inputs)`. No shadcn primitive components are required to be installed at this stage.

#### Scenario: Tailwind utility classes apply

- **WHEN** a Server or Client component uses a Tailwind utility class such as `text-3xl` or `bg-slate-50`
- **THEN** the rendered page applies the corresponding CSS

#### Scenario: cn() is importable from @/lib/utils

- **WHEN** any source file imports `import { cn } from '@/lib/utils'`
- **THEN** the import resolves, type-checks, and returns a string when called with class fragments

#### Scenario: components.json exists and is valid

- **WHEN** a developer runs `npx shadcn add button` (in a future change)
- **THEN** the shadcn CLI reads `components.json`, places the component under `components/ui/button.tsx`, and the import path matches the configured aliases

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

