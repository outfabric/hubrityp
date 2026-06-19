# cookie-consent Specification

## Purpose

Defines the LGPD-compliant cookie consent banner shown on the public marketing site, the persistence of the visitor's consent choice, the consent-gated loading of analytics, and the preservation of UTM parameters on CTA navigation. Created by syncing change `public-site-foundation`.

## Requirements

### Requirement: First-visit LGPD cookie consent banner

The system SHALL render a cookie consent banner on a visitor's first public visit (when no `cookie_consent` cookie is present), styled as a bottom card (`radius/2xl`, `Shadow/Light/lg`, max ~460px). It MUST contain: the title "Cookies por aqui"; the body text "Usamos cookies para melhorar sua experiência e medir o desempenho do site. Você escolhe."; a "Saiba mais na Política de Privacidade" link to `/politica-de-privacidade` positioned above the action buttons; an "Aceitar" primary button; and a "Recusar" secondary button.

#### Scenario: Banner shows on first visit

- **WHEN** a visitor with no `cookie_consent` cookie loads any public page
- **THEN** the banner renders with the "Cookies por aqui" title, the body text ending in "Você escolhe.", the "Saiba mais na Política de Privacidade" link to `/politica-de-privacidade`, and the "Aceitar"/"Recusar" buttons

#### Scenario: Banner is hidden once a choice exists

- **WHEN** a visitor already has a `cookie_consent` cookie (any value)
- **THEN** the banner does not render

### Requirement: Consent choice persists and dismisses the banner

Choosing "Aceitar" SHALL persist `cookie_consent=accepted` and choosing "Recusar" SHALL persist `cookie_consent=rejected`, in a first-party cookie with `SameSite=Lax`, `Secure`, a 12-month max-age, and `Path=/`. After either choice the banner disappears and does not reappear on subsequent navigations.

#### Scenario: Accept persists and dismisses

- **WHEN** the visitor clicks "Aceitar"
- **THEN** a `cookie_consent=accepted` cookie is set (`SameSite=Lax; Secure`) and the banner is removed without a full page reload

#### Scenario: Reject persists essential-only

- **WHEN** the visitor clicks "Recusar"
- **THEN** a `cookie_consent=rejected` cookie is set and no analytics cookies/scripts are loaded

### Requirement: Analytics loads only after consent

Analytics SHALL NOT load before the visitor has accepted, and SHALL load only when both (a) an analytics host is configured via env and (b) `cookie_consent=accepted`. When the configured analytics is cookieless (e.g. Plausible without cookies), it MAY load without per-cookie consent only if explicitly configured to do so; by default it is gated on `accepted`. The analytics loader MUST be a client leaf and MUST NOT block first paint.

#### Scenario: No consent → no analytics

- **WHEN** a visitor has not accepted (no cookie, or `rejected`)
- **THEN** no analytics script tag is injected and no analytics network request is made

#### Scenario: Consent → analytics loads from the allowlisted host

- **WHEN** `cookie_consent=accepted` and an analytics host is configured
- **THEN** the analytics script is loaded from the configured (CSP-allowlisted) host after consent, deferred so it does not block first paint

#### Scenario: Analytics disabled when unconfigured

- **WHEN** no analytics host env var is set
- **THEN** the analytics loader is a no-op regardless of consent state

### Requirement: UTM parameters are preserved on CTA navigation

When a visitor arrives with UTM query parameters, public CTAs that navigate to `/signup` SHALL preserve the UTM parameters on the destination URL (e.g. `/signup?utm_source=...`). UTM values MUST be treated as opaque strings and MUST NOT be logged with any PII.

#### Scenario: UTMs forwarded to signup

- **WHEN** a visitor loads `/?utm_source=google&utm_campaign=x` and clicks a "Começar grátis" CTA
- **THEN** the navigation target is `/signup` with the same `utm_source` and `utm_campaign` query parameters preserved
