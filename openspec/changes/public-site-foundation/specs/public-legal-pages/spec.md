## ADDED Requirements

### Requirement: Política de Privacidade page

The system SHALL provide a public `/politica-de-privacidade` route rendering a long-form legal page in the 720px reading column, with at least 8 sections including a **base legal e direitos (LGPD)** section (anchored as `#lgpd`) and a **cookies** section. The top of the page MUST show an `info/50` notice stating the text is reference content pending legal review ("texto de referência — revisar com o jurídico antes de publicar"). The page MUST set a unique `<title>`, `<meta description>`, and canonical (see `public-seo`).

#### Scenario: Privacy page renders with LGPD anchor

- **WHEN** an anonymous client requests `/politica-de-privacidade`
- **THEN** the response is HTTP 200, renders the reading-column layout, includes a section with id `lgpd`, includes a cookies section, and shows the legal-review notice

#### Scenario: Footer/cookie LGPD links resolve here

- **WHEN** a visitor activates the footer "LGPD" link or the cookie banner "Saiba mais" link
- **THEN** navigation lands on `/politica-de-privacidade` (LGPD link scrolling to `#lgpd`)

### Requirement: Termos de Uso page

The system SHALL provide a public `/termos-de-uso` route rendering a long-form legal page in the 720px reading column, with at least 8 sections covering eligibility (CRP ativo), planos, cancelamento, propriedade intelectual, responsabilidade, and lei aplicável/CDC, plus the same `info/50` legal-review notice. It MUST set unique SEO metadata.

#### Scenario: Terms page renders

- **WHEN** an anonymous client requests `/termos-de-uso`
- **THEN** the response is HTTP 200, renders the reading-column layout with the eligibility (CRP ativo) and cancellation sections, and shows the legal-review notice

### Requirement: Legal pages are prerequisites for consent and signup

Both legal pages SHALL be functional routes (HTTP 200, not placeholders) so the cookie banner "Saiba mais" link and the signup flow's terms/privacy references resolve to real content.

#### Scenario: Both legal routes are live

- **WHEN** `/politica-de-privacidade` and `/termos-de-uso` are requested anonymously
- **THEN** both return HTTP 200 with rendered content (no 404, no redirect to login)
