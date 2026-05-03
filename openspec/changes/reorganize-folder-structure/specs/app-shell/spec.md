## MODIFIED Requirements

### Requirement: Root layout sets locale and base metadata

The system SHALL declare `src/app/layout.tsx` as the root layout with `<html lang="pt-BR">`, a global font configured via `next/font`, and a base `metadata` export setting at minimum the application title.

#### Scenario: Locale is pt-BR

- **WHEN** any page is rendered
- **THEN** the `<html>` element has `lang="pt-BR"`

#### Scenario: Font is loaded via next/font, not CSS

- **WHEN** the rendered HTML is inspected
- **THEN** the page does not include any `@import url(...)` for fonts and the font is delivered via `next/font` self-hosting

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

## ADDED Requirements

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
