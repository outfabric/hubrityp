# public-seo Specification

## Purpose

Defines the SEO substrate of the public marketing site: a reusable per-page metadata helper, a default Open Graph image, sitemap/robots generation, and an environment-driven site base URL for all absolute URLs. Created by syncing change `public-site-foundation`.

## Requirements

### Requirement: Per-page SEO metadata helper

The system SHALL provide a reusable metadata helper (in the marketing module) that produces a Next.js `Metadata` object with a unique `<title>`, unique `<meta name="description">`, a canonical URL (`alternates.canonical`), and Open Graph tags (`og:title`, `og:description`, `og:image`, `og:type`, `og:url`) for each public page. Twitter card tags SHOULD mirror the Open Graph tags. The canonical and `og:url` MUST be absolute, derived from `metadataBase`.

#### Scenario: Homepage metadata is unique and complete

- **WHEN** the homepage `generateMetadata`/`metadata` export is resolved
- **THEN** it yields a non-empty unique title and description, a canonical pointing to the absolute site root, and `og:title`/`og:description`/`og:image` values

#### Scenario: Each public page has a distinct title and canonical

- **WHEN** metadata for `/`, `/precos`, `/politica-de-privacidade`, and `/termos-de-uso` is resolved
- **THEN** each page has a distinct `<title>` and a distinct canonical URL matching its own path

### Requirement: Default Open Graph image asset

The system SHALL ship a default Open Graph image (≥ 1200×630) served from a stable public path, referenced as the fallback `og:image`. Pages MAY override it with a page-specific image.

#### Scenario: OG image is referenced and resolvable

- **WHEN** any public page metadata is resolved
- **THEN** `og:image` is set to an absolute URL that resolves to an image asset of at least 1200×630

### Requirement: Sitemap and robots

The system SHALL generate `sitemap.xml` via `app/sitemap.ts` listing the public, indexable routes (`/`, `/precos`, `/politica-de-privacidade`, `/termos-de-uso`) with absolute URLs, and SHALL generate `robots.txt` via `app/robots.ts` that allows crawling of public routes, disallows authenticated prefixes (`/dashboard`, `/agenda`, `/pacientes`, `/caixa-de-entrada`, `/configuracoes`, `/onboarding`, `/sessao`, `/api`), and references the sitemap URL.

#### Scenario: Sitemap lists public routes only

- **WHEN** `/sitemap.xml` is requested
- **THEN** it returns valid XML containing absolute URLs for `/`, `/precos`, `/politica-de-privacidade`, and `/termos-de-uso`, and no authenticated route

#### Scenario: Robots disallows the authenticated app

- **WHEN** `/robots.txt` is requested
- **THEN** it allows `/` and the public routes, disallows `/dashboard`, `/agenda`, `/pacientes`, `/caixa-de-entrada`, `/configuracoes`, `/onboarding`, `/sessao`, and `/api`, and includes a `Sitemap:` line with the absolute sitemap URL

### Requirement: Site base URL is environment-driven

`metadataBase` and all absolute URLs (canonical, og:url, sitemap, robots) SHALL be derived from a single configured site URL (env-driven, validated), never hardcoded, so preview/staging/production each produce correct absolute URLs.

#### Scenario: Absolute URLs use the configured base

- **WHEN** the configured site URL changes between environments
- **THEN** canonical, `og:url`, sitemap entries, and the robots `Sitemap:` line all reflect the configured base host
