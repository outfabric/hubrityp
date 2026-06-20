## ADDED Requirements

### Requirement: Pricing page structure

The system SHALL provide a public `/precos` route inside the `(public)` layout with: a title "Investimento no seu consultório, não na burocracia." and a subtitle; 2 plan cards side by side; an expandable comparison table below the cards; a billing FAQ section; and a final CTA. The page MUST have exactly one `<h1>` and set unique SEO metadata (title/description/canonical/OG) via the foundation helper.

#### Scenario: Pricing page renders its structure

- **WHEN** an anonymous client requests `/precos`
- **THEN** the response is HTTP 200 with the title, 2 plan cards, the comparison table, the billing FAQ, and a final CTA, and exactly one `<h1>`

#### Scenario: Pricing page is publicly reachable

- **WHEN** an anonymous client requests `/precos`
- **THEN** the middleware does not redirect to `/login` and the page renders directly

### Requirement: Plan cards driven by central config

The 2 plan cards SHALL be rendered from `subscription-plans-config` (never hardcoded): Essencial (R$ 60/mês) and Avançado (R$ 90/mês, "Popular" badge). Each card shows the plan name, monthly price, a full checkmarked feature list, and a CTA "Experimentar grátis — 14 dias" linking to `/signup?plano=[slug]` with the plan's slug. Billing is monthly only (no annual toggle).

#### Scenario: Cards reflect config values and slugs

- **WHEN** the plan cards render
- **THEN** Essencial shows R$ 60 with CTA → `/signup?plano=essencial`, and Avançado shows R$ 90 with the "Popular" badge and CTA → `/signup?plano=avancado`, all values from the central config

#### Scenario: Plan slug is allowlisted

- **WHEN** building the `/signup?plano=` link
- **THEN** the slug is one of the known plan slugs from config (allowlist), never free-form input

#### Scenario: No annual toggle is present

- **WHEN** the pricing page renders
- **THEN** there is no monthly/annual toggle; only monthly prices are shown

### Requirement: Expandable comparison table

The system SHALL render an expandable comparison table of the 9 PRD feature rows across the 2 plans, where ✓ renders as a `brand/700` check and — renders as a `border/strong` dash, and the Avançado column is tinted `brand/50`. Per the config invariant, Avançado MUST differ from Essencial only in two rows: "Lembretes automáticos via WhatsApp" and "Transcrição e nota com IA". On mobile the table collapses into stacked per-plan blocks.

#### Scenario: Comparison table reflects the Essencial⊂Avançado invariant

- **WHEN** the comparison table renders
- **THEN** every Essencial ✓ row is also ✓ for Avançado, and the only Avançado-exclusive ✓ rows are WhatsApp reminders and AI transcription

#### Scenario: Table is expandable and mobile-stacked

- **WHEN** the user expands the comparison table on desktop
- **THEN** all 9 rows are shown with ✓/— per plan
- **WHEN** rendered on a 375px viewport
- **THEN** the table collapses into stacked per-plan blocks without horizontal overflow

### Requirement: Billing FAQ

The system SHALL render a billing FAQ section with 3–5 questions covering: cobrança (monthly), cancelamento, fim do teste/downgrade (downgrade automático para Essencial sem perda de dados), and nota fiscal ("Todas as cobranças geram nota fiscal automaticamente." — framed as dependent on the payment provider). The FAQ uses the same accessible `<details>`-based accordion pattern as the homepage (exclusive open; all-open without JS).

#### Scenario: Billing FAQ covers the required topics

- **WHEN** the billing FAQ renders
- **THEN** it shows 3–5 `<details>` items including cancelamento, fim do teste/downgrade, and nota fiscal

#### Scenario: Billing FAQ degrades without JS

- **WHEN** JavaScript is disabled
- **THEN** all billing FAQ items render expanded so all answers are readable

### Requirement: Final CTA and MVP-only/empty-plans safety

The pricing page SHALL render a final CTA on a solid `brand/700` surface repeating the signup action. It MUST present only MVP features as available (post-MVP features like PIX/Receita Saúde/reembolso may appear only as explicit "em breve"/roadmap, never as included plan features). If the validated plans config resolves to zero plans, the page MUST hide empty cards and render a "Entre em contato para saber mais" message with the support email.

#### Scenario: Final CTA renders on solid brand surface

- **WHEN** the final CTA renders
- **THEN** the surface is solid `brand/700` (no gradient) and the CTA navigates to `/signup` (preserving any UTM parameters)

#### Scenario: No post-MVP feature is listed as included

- **WHEN** the plan cards and comparison table render
- **THEN** no included feature row represents PIX/cobrança, Receita Saúde, or recibos de reembolso

#### Scenario: Empty plans degrade to contact fallback

- **WHEN** the validated plans config is empty (deploy/config error)
- **THEN** the page hides empty plan cards and shows the "Entre em contato para saber mais" message with the support email
