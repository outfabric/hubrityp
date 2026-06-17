## MODIFIED Requirements

### Requirement: Dark mode substrate is wired without a UI toggle

The system SHALL ensure the `data-theme` attribute on `<html>` controls the active theme, AND SHALL ship a user-facing dark-mode toggle. On first visit (no stored preference) the active theme MUST follow the OS `prefers-color-scheme`; once the user toggles, the explicit choice MUST be persisted (cookie/localStorage) and take precedence over the OS preference on subsequent visits. A blocking inline script in the document head MUST resolve and apply the theme before first paint to avoid a flash of the wrong theme (FOUC). Setting `data-theme` MUST flip the entire UI to the corresponding token set without class churn.

#### Scenario: Setting `data-theme='dark'` flips every token

- **GIVEN** the application is rendered in light mode
- **WHEN** `document.documentElement.dataset.theme = 'dark'`
- **THEN** every component re-renders against the dark token set within one frame, with no console error and no FOUC longer than 50ms

#### Scenario: Removing `data-theme` returns to light

- **WHEN** the script executes `delete document.documentElement.dataset.theme`
- **THEN** the UI returns to the light token set

#### Scenario: First visit follows OS preference

- **WHEN** a visitor with no stored theme preference and OS set to dark loads any page
- **THEN** the no-flash inline script resolves `data-theme='dark'` before first paint, with no light flash

#### Scenario: Explicit toggle persists and wins over OS

- **WHEN** the user activates the theme toggle to choose light while the OS prefers dark, then revisits
- **THEN** the stored preference is applied (light) on the next visit, overriding the OS preference, and the toggle reflects the active theme via `aria-pressed`

#### Scenario: Toggle is keyboard-accessible

- **WHEN** a keyboard user focuses the theme toggle and presses Enter/Space
- **THEN** the theme switches and focus remains on the toggle with a visible focus ring

## ADDED Requirements

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
