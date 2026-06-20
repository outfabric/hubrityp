## Why

A psychologist buys with her own money and will not create an account without knowing the price up front (CDC requires clear price display; a page without visible price loses sign-ups). PRD 14 §5.14 requires a dedicated `/precos` page with full plan detail, a comparison table, and a billing FAQ. The `public-site-foundation` change provides the shell + the central plans config; this change ships the `/precos` page body, reproducing the Figma `Public · Pricing` screen (`128:2`).

## What Changes

- **`/precos` page** inside the `(public)` layout: title "Investimento no seu consultório, não na burocracia." + subtitle; 2 plan cards (full feature list, `Popular` badge on Avançado, CTA "Experimentar grátis — 14 dias" → `/signup?plano=[slug]`).
- **Expandable comparison table** (9 feature rows × 2 plans) where Avançado differs from Essencial only by WhatsApp + AI transcription; ✓ = `brand/700`, — = `border/strong`; Avançado column tinted `brand/50`.
- **Billing FAQ** (3–5 questions: cobrança, cancelamento, fim do teste/downgrade, nota fiscal).
- **Final CTA** (solid `brand/700`) reusing the homepage CTA pattern.
- All plan data sourced from `subscription-plans-config` (no hardcoded prices in JSX); empty-plans safety fallback per the edge case.
- Page SEO metadata via the foundation `buildPageMetadata()`.
- Monthly-only billing (no annual toggle, per RF-14.28/RN-14.05).

## Capabilities

### New Capabilities

- `public-pricing-page`: The `/precos` route body — plan cards, expandable comparison table, billing FAQ, final CTA — driven by the central plans config.

### Modified Capabilities

_None._ This change consumes `public-site-shell`, `public-navigation`, `public-seo`, and `subscription-plans-config` from `public-site-foundation` without changing their requirements; the FAQ behavior mirrors `homepage-faq` (shared component if available, otherwise the same `<details>`-based pattern).

## Impact

- **Code**: `src/app/(public)/precos/page.tsx`; pricing section components under `src/modules/marketing/components/pricing/` (plan cards, comparison table, billing FAQ); reuses the central plans config, the FAQ accordion pattern, and the CTA-final component from `public-homepage`/foundation.
- **Dependencies**: requires `public-site-foundation` (shell, plans config, SEO). Reuses the `homepage-faq` accordion component and `cta-final` component from `public-homepage` if merged first; otherwise re-implements the same shared pattern (no new npm dependency).
- **Security/LGPD**: public page, no DB/RLS changes, no PII. `?plano=[slug]` must be validated against the known plan slugs before being used (allowlist) to avoid open-parameter misuse downstream.
- **Compliance**: CDC — prices and full feature inclusion shown clearly; nota fiscal mention is conditioned on the payment provider (Asaas) and framed accurately.
