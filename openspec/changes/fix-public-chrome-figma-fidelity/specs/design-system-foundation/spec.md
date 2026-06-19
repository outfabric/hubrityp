## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Logo brand mark supports a dark-surface tone

The Logo primitive SHALL provide a dark-surface tone that renders the brand symbol in its canonical tricolor fills (sage left stake, slate-blue right stake, teal center link — per the Brand Identity file `4O3POARuvEYI1BCrxbOFg2`) while rendering the "hubrity" wordmark light (`#FAFAF9`). This tone SHALL be distinct from the existing `color`, `white`, and `mono` tones, which MUST remain unchanged.

#### Scenario: Dark-surface tone keeps the symbol colored

- **WHEN** the logo renders with the dark-surface tone on a dark background
- **THEN** the symbol retains its tricolor fills and the wordmark renders light, meeting WCAG 2.1 AA contrast against the dark surface

#### Scenario: Existing tones are unaffected

- **WHEN** the logo renders with the `color`, `white`, or `mono` tone
- **THEN** each produces its prior output unchanged
