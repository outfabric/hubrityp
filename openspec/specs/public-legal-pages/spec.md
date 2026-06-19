# public-legal-pages Specification

## Purpose

Defines the public legal pages of the marketing site — Política de Privacidade and Termos de Uso — as functional, indexable routes that serve as prerequisites for the cookie consent flow and the signup terms/privacy references. Created by syncing change `public-site-foundation`.

## Requirements

### Requirement: Política de Privacidade page

The system SHALL provide a public `/politica-de-privacidade` route rendering a long-form legal page in the 720px reading column, with at least 8 sections including a **base legal e direitos (LGPD)** section (anchored as `#lgpd`) and a **cookies** section. The page MUST set a unique `<title>`, `<meta description>`, and canonical (see `public-seo`). The page MUST NOT render a legal-review reference notice.

#### Scenario: Privacy page renders with LGPD anchor

- **WHEN** an anonymous client requests `/politica-de-privacidade`
- **THEN** the response is HTTP 200, renders the reading-column layout, includes a section with id `lgpd`, and includes a cookies section

#### Scenario: Cookie "Saiba mais" link resolves here

- **WHEN** a visitor activates the cookie banner "Saiba mais na Política de Privacidade" link
- **THEN** navigation lands on `/politica-de-privacidade` (the `#lgpd` anchor remains available for deep links)

#### Scenario: No legal-review notice is shown

- **WHEN** the privacy page renders
- **THEN** no "revisar com o jurídico" reference notice is present anywhere on the page

### Requirement: Termos de Uso page

The system SHALL provide a public `/termos-de-uso` route rendering a long-form legal page in the 720px reading column, with at least 8 sections covering eligibility (CRP ativo), planos, cancelamento, propriedade intelectual, responsabilidade, and lei aplicável/CDC. It MUST set unique SEO metadata. The page MUST NOT render a legal-review reference notice.

#### Scenario: Terms page renders

- **WHEN** an anonymous client requests `/termos-de-uso`
- **THEN** the response is HTTP 200, renders the reading-column layout with the eligibility (CRP ativo) and cancellation sections

#### Scenario: No legal-review notice is shown

- **WHEN** the terms page renders
- **THEN** no "revisar com o jurídico" reference notice is present anywhere on the page

### Requirement: Legal pages are prerequisites for consent and signup

Both legal pages SHALL be functional routes (HTTP 200, not placeholders) so the cookie banner "Saiba mais" link and the signup flow's terms/privacy references resolve to real content.

#### Scenario: Both legal routes are live

- **WHEN** `/politica-de-privacidade` and `/termos-de-uso` are requested anonymously
- **THEN** both return HTTP 200 with rendered content (no 404, no redirect to login)
