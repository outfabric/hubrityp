## MODIFIED Requirements

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
