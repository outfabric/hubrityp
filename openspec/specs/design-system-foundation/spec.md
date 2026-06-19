# design-system-foundation Specification

## Purpose

Define the visual and styling substrate of the platform: design tokens declared as CSS custom properties, the Tailwind theme that maps to those tokens, the Inter font loaded via `next/font`, the dark-mode wiring driven by `data-theme`, the required shadcn/ui primitives themed against the tokens, and the global accessibility baselines (focus ring, reduced-motion). Created by archiving change `auth-account-creation`.

## Requirements

### Requirement: Design tokens are declared as CSS custom properties

The system SHALL declare every design token (colors, typography family vars, spacing scale, radius scale, shadow scale, animation durations, easing) from `docs/design-system/rules.md` as CSS custom properties in `src/app/globals.css`. Tokens MUST be scoped under `:root` (light theme defaults) and `[data-theme='dark']` (dark theme overrides). Application code MUST consume these tokens through Tailwind utilities or `var(--token)` references and MUST NOT hardcode color, radius, shadow, or duration values.

#### Scenario: Light tokens are present at the document root

- **WHEN** the application renders in a browser without `data-theme='dark'` set
- **THEN** the computed value of `var(--color-background)` resolves to the light surface tone defined by the design system, and every token enumerated in `docs/design-system/rules.md` (`--color-*`, `--space-*`, `--radius-*`, `--shadow-*`, `--duration-*`, `--ease-out`, `--font-sans`, `--font-mono`) is defined under `:root`

#### Scenario: Dark tokens are present under `data-theme='dark'`

- **WHEN** the application renders with `data-theme='dark'` set on `<html>`
- **THEN** the dark overrides defined by the design system apply (e.g., `--color-background` becomes the dark surface tone) without any class-list churn beyond the `data-theme` attribute

#### Scenario: Hardcoded color is rejected by lint

- **WHEN** a contributor introduces a Tailwind class such as `bg-[#ff0000]`, `text-stone-900`, or a CSS rule with a literal hex/rgb color in any source file under `src/`
- **THEN** the project lint pipeline (ESLint + Stylelint or equivalent) reports an error and the pre-commit hook blocks the commit

### Requirement: Tailwind theme is derived from CSS tokens

The system SHALL configure `tailwind.config.ts` so that `theme.extend.colors`, `borderRadius`, `boxShadow`, `transitionDuration`, and `fontFamily` map to the CSS custom properties declared in `globals.css` (using `var(--token)`). Tailwind's `darkMode` option MUST be configured as `['class', "[data-theme='dark']"]` so that the `data-theme` attribute drives dark variants.

#### Scenario: Brand utility resolves through CSS var

- **WHEN** a component uses the class `bg-brand-500`
- **THEN** the rendered style is `background-color: var(--color-brand-500)` and the visual color matches `#6b8a66` in light mode and `#8aab85` in dark mode

#### Scenario: Dark variant activates via `data-theme`

- **WHEN** a component uses the class `dark:bg-surface` and the `<html data-theme='dark'>` attribute is set
- **THEN** the dark variant takes effect (Tailwind compiles `[data-theme='dark']` as the dark selector)

### Requirement: Inter is the application font, loaded via `next/font`

The system SHALL load Inter via `next/font/google` (self-hosted) in `src/app/layout.tsx` and expose it as the CSS variable `--font-sans`. The root `<body>` MUST apply the font through Tailwind class chain so every descendant inherits Inter as the default sans-serif. Decorative or system fallbacks listed in the design tokens MUST be preserved as the fallback chain.

#### Scenario: Body has Inter applied via CSS variable

- **WHEN** the application boots
- **THEN** `<body>` has the class chain that applies `font-family: var(--font-sans)` and the resolved computed style on any text node is the Inter font face served by Next.js (not a CDN URL)

#### Scenario: No external font request

- **WHEN** the page loads in a browser with network inspection enabled
- **THEN** there is no network request to `fonts.googleapis.com` or `fonts.gstatic.com`; Inter assets are served from the same origin as the app

### Requirement: Dark mode substrate is wired without a UI toggle

The system SHALL ensure the `data-theme` attribute on `<html>` controls the active theme, driven SOLELY by the OS `prefers-color-scheme` — there is NO user-facing theme toggle anywhere in the public or app UI. A blocking inline script in the document head MUST resolve and apply the theme from `prefers-color-scheme` before first paint to avoid a flash of the wrong theme (FOUC). Setting `data-theme` MUST flip the entire UI to the corresponding token set without class churn.

#### Scenario: Setting `data-theme='dark'` flips every token

- **GIVEN** the application is rendered in light mode
- **WHEN** `document.documentElement.dataset.theme = 'dark'`
- **THEN** every component re-renders against the dark token set within one frame, with no console error and no FOUC longer than 50ms

#### Scenario: Removing `data-theme` returns to light

- **WHEN** the script executes `delete document.documentElement.dataset.theme`
- **THEN** the UI returns to the light token set

#### Scenario: First visit follows OS preference

- **WHEN** a visitor with OS set to dark loads any page
- **THEN** the no-flash inline script resolves `data-theme='dark'` before first paint, with no light flash

#### Scenario: No theme toggle is present in the chrome

- **WHEN** the public header, footer, and mobile menu render
- **THEN** no theme-toggle control exists in the DOM — dark mode is governed only by `prefers-color-scheme`

### Requirement: Required shadcn/ui primitives are installed and themed

The system SHALL install or extend the following shadcn/ui primitives under `src/shared/ui/`, each themed to the design system tokens (no hardcoded colors): `button` (already present, verify), `input` (already present, verify), `label`, `form`, `checkbox`, `select`, `card`, `alert`. Primitives MUST consume Tailwind utilities backed by the CSS tokens. A primitive that needs a brand color MUST reference `bg-brand-500` (or its dark equivalent), never a literal hex.

#### Scenario: Each required primitive exists at its canonical path

- **WHEN** the change merges
- **THEN** each of `src/shared/ui/button.tsx`, `input.tsx`, `label.tsx`, `form.tsx`, `checkbox.tsx`, `select.tsx`, `card.tsx`, `alert.tsx` exists and exports the corresponding shadcn primitive

#### Scenario: Primitives use token-backed classes only

- **WHEN** a contributor reads any primitive under `src/shared/ui/`
- **THEN** every color, radius, shadow, and duration is expressed via Tailwind utilities backed by the CSS tokens; no `#…`, `rgb(…)`, or arbitrary-value Tailwind class (`bg-[#…]`) appears in the file

#### Scenario: Existing primitives keep their public API

- **WHEN** a contributor compares the post-change `Button` and `Input` components to the pre-change versions
- **THEN** their exported props and `displayName` are unchanged so callers in `app/(auth)/login/login-form.tsx` and elsewhere keep compiling without modification

### Requirement: Accessible focus and reduced-motion baselines are global

The system SHALL render a visible focus ring on every interactive element using `box-shadow: var(--shadow-focus)` and SHALL respect `prefers-reduced-motion: reduce` by collapsing all animation and transition durations to ≤1ms.

#### Scenario: Tab focus shows the brand focus ring

- **WHEN** a keyboard user presses Tab on any interactive element (button, input, link)
- **THEN** the focus ring resolves to `box-shadow: var(--shadow-focus)` and is visible (≥3px outline against the surface)

#### Scenario: Reduced motion preference disables animations

- **WHEN** the operating system reports `prefers-reduced-motion: reduce`
- **THEN** the global stylesheet collapses every `animation-duration` and `transition-duration` to 0.01ms via the documented `@media (prefers-reduced-motion: reduce)` block

### Requirement: Marketing typography tokens

The system SHALL add a "marketing" type scale to the design tokens (`globals.css` CSS custom properties + Tailwind theme), using only Inter at weights 400/600 (no 700+): `Display/xl` (52px/56px, 600, tracking -0.5%), `Display/lg` (40px/46px, 600, -0.4%), `Display/md` (32px/40px, 600, -0.2%), and `Lead` (20px/30px, 400, 0). These tokens MUST be documented in `docs/design-system/rules.md` as the marketing scale.

#### Scenario: Marketing type tokens are available as utilities

- **WHEN** a public component applies the `Display/xl`, `Display/lg`, `Display/md`, or `Lead` token (via Tailwind utility or CSS var)
- **THEN** the corresponding size/line-height/weight/tracking is applied, sourced from the token (no hardcoded px)

#### Scenario: Marketing scale respects DS weight rule

- **WHEN** any marketing type token renders
- **THEN** its font-weight is 400 or 600 (never ≥ 700) and the family is Inter

### Requirement: Nunito wordmark font for the logo

The system SHALL load the **Nunito** font via `next/font/google` (self-hosted, no runtime request to Google), scoped exclusively to the brand wordmark ("hubrity"), exposed as a CSS variable (e.g. `--ds-font-wordmark`). Body and UI text MUST remain Inter; Nunito MUST NOT be applied to general UI.

#### Scenario: Wordmark uses Nunito, UI uses Inter

- **WHEN** the public header logo wordmark renders
- **THEN** the wordmark uses the Nunito-backed font variable while surrounding UI text uses Inter

#### Scenario: Font is self-hosted

- **WHEN** the rendered HTML is inspected
- **THEN** no `@import`/`<link>` to `fonts.googleapis.com`/`fonts.gstatic.com` is present and Nunito is delivered via `next/font` self-hosting (consistent with the CSP `font-src 'self' data:`)

### Requirement: Logo brand mark supports a dark-surface tone

The Logo primitive SHALL provide a dark-surface tone that renders the brand symbol in its canonical tricolor fills (sage left stake, slate-blue right stake, teal center link — per the Brand Identity file `4O3POARuvEYI1BCrxbOFg2`) while rendering the "hubrity" wordmark light (`#FAFAF9`). This tone SHALL be distinct from the existing `color`, `white`, and `mono` tones, which MUST remain unchanged.

#### Scenario: Dark-surface tone keeps the symbol colored

- **WHEN** the logo renders with the dark-surface tone on a dark background
- **THEN** the symbol retains its tricolor fills and the wordmark renders light, meeting WCAG 2.1 AA contrast against the dark surface

#### Scenario: Existing tones are unaffected

- **WHEN** the logo renders with the `color`, `white`, or `mono` tone
- **THEN** each produces its prior output unchanged
