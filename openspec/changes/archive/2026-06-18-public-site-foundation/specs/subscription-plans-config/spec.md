## ADDED Requirements

### Requirement: Central, validated plans configuration

The system SHALL define the subscription plans (names, monthly prices in BRL, slugs, "most popular" flag, and per-feature inclusion) in a single central configuration module under `src/modules/marketing/`, never inline in JSX. The configuration MUST be validated by a Zod schema at module load, and consuming types MUST be derived via `z.infer` (with branded types for plan slug and price). Both the homepage pricing summary (`public-homepage`) and `/precos` (`public-pricing-page`) consume this single source.

The MVP plans are exactly: **Essencial** (slug `essencial`, R$ 60/mês) and **Avançado** (slug `avancado`, R$ 90/mês, "Mais popular"). The Avançado plan differs from Essencial **only** by two features: WhatsApp automation reminders and AI transcription. Billing is monthly only (no annual toggle).

#### Scenario: Configuration validates at load

- **WHEN** the plans module is imported
- **THEN** the Zod schema parses successfully and exposes exactly two plans (`essencial` at 6000 cents / R$ 60, `avancado` at 9000 cents / R$ 90 marked most-popular)

#### Scenario: Avançado differs only by WhatsApp + IA

- **WHEN** the feature matrix is computed from the config
- **THEN** every feature included in Essencial is also included in Avançado, and the only features exclusive to Avançado are "Lembretes automáticos via WhatsApp" and "Transcrição e nota com IA"

#### Scenario: Prices are not hardcoded in components

- **WHEN** the homepage pricing summary or the pricing page renders prices
- **THEN** the displayed values come from the central config, and changing a price in config changes both surfaces

### Requirement: MVP-only feature communication guard

The plans configuration and any public copy derived from it SHALL only present features that exist in the MVP as available. Post-MVP features (PIX/billing, Receita Saúde, reimbursement receipts) MUST NOT appear as available plan features; if mentioned at all they MUST be marked "em breve"/roadmap and never in the comparison matrix.

#### Scenario: No post-MVP feature is marked available

- **WHEN** the feature matrix is rendered
- **THEN** no row represents PIX/cobrança, Receita Saúde, or recibos de reembolso as an included feature

### Requirement: Empty-plans safety fallback

If, due to a deploy/config error, the plans configuration resolves to zero valid plans, public pricing surfaces SHALL hide empty plan cards and render a "Entre em contato para saber mais" message with the support email instead of broken/empty cards.

#### Scenario: Zero plans degrades gracefully

- **WHEN** the validated plans list is empty
- **THEN** pricing surfaces render the contact fallback (support email) and do not render empty plan cards
