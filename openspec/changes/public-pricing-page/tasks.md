> [!IMPORTANT]
> **MANDATORY — design fidelity (read before implementing any UI task in this change).**
> The pricing screen is designed in Figma and is the **visual source of truth**. The ´fullstack-developer´ MUST open and **strictly follow** it — layout, tokens (color / spacing / radius / typography), spacing, states, and responsive behavior — for the plan cards, comparison table, billing FAQ, and final CTA. Do not improvise visuals or invent values not backed by DS tokens.
> - **File:** Hubrity Design System — `https://www.figma.com/design/HoLOEqq9PXlo6IwLkz3FQ9/Hubrity-Design-System` (file key `HoLOEqq9PXlo6IwLkz3FQ9`).
> - **Pages / nodes for this change:** `Public · Pricing` — desktop `128:2` (mobile follows the homepage stacking pattern).
> - **How:** The ´fullstack-developer´ MUST use the **Figma MCP** (`get_design_context`, `get_screenshot`, `get_metadata`, `get_variable_defs` etc) to inspect the frame and pull exact tokens **before and during** implementation.
> - **Precedence:** on any conflict, the **Figma screen prevails on visual form**; this change's specs prevail on business rules and content (monthly-only, plan composition, MVP-only).

## 1. Pricing content + comparison matrix

- [x] 1.1 Extend `subscription-plans-config` (or add `marketing/lib/pricing-content.ts`) with the 9 comparison rows (verbatim RF-14.27 labels) and full per-plan feature lists, derived from the central config so cards + table + homepage summary share one source.
- [x] 1.2 Add pricing-page copy (title, subtitle, billing FAQ 3–5 entries incl. cancelamento, fim do teste/downgrade, nota fiscal) to the content module.
- [x] 1.3 Unit test: comparison matrix has 9 rows; Essencial⊂Avançado with only WhatsApp + IA exclusive to Avançado; no post-MVP feature row; `?plano=` slugs limited to known slugs — `src/__tests__/unit/modules/marketing/pricing-content.test.ts`.

## 2. Plan cards

- [x] 2.1 Implement `marketing/components/pricing/plan-cards.tsx`: 2 cards from config (name, R$ price, full feature checklist, "Popular" badge on Avançado), CTA "Experimentar grátis — 14 dias" → `/signup?plano=[slug]` (UTM preserved, slug allowlisted). Monthly only (no toggle).
- [x] 2.2 Implement the empty-plans fallback (hide cards, show "Entre em contato para saber mais" + support email) using the foundation helper.
- [x] 2.3 Unit test: card prices/slugs from config; Avançado has "Popular"; CTA targets `/signup?plano=essencial|avancado`; no annual toggle; empty config → contact fallback — `src/__tests__/unit/modules/marketing/plan-cards.test.tsx`.

## 3. Comparison table

- [x] 3.1 Implement `marketing/components/pricing/comparison-table.tsx`: data-driven `<table>` (9 rows × 2 plans), `<th scope>` headers, ✓ = `brand/700` check with SR label "incluído" / — = `border/strong` dash with SR label "não incluído", Avançado column `brand/50` tint; expandable; mobile = stacked per-plan blocks.
- [x] 3.2 Unit test: 9 rows; Essencial⊂Avançado invariant in the rendered table; accessible ✓/— labels present; expandable behavior — `src/__tests__/unit/modules/marketing/comparison-table.test.tsx`.

## 4. Billing FAQ + final CTA

- [x] 4.1 Implement the billing FAQ reusing the homepage `<details>` accordion component (exclusive open; all-open without JS) with the 3–5 billing questions; nota fiscal framed as provider-dependent/forward-looking (not an available feature).
- [x] 4.2 Reuse the `cta-final` component (solid `brand/700`, inverse text, `/signup` UTM-preserving).
- [x] 4.3 Unit test: billing FAQ shows required topics; exclusive toggle; all-open without JS; nota fiscal not presented as an included plan feature — `src/__tests__/unit/modules/marketing/billing-faq.test.tsx`.

## 5. Page assembly + metadata

- [ ] 5.1 Implement `src/app/(public)/precos/page.tsx`: compose title/subtitle + plan cards + comparison table + billing FAQ + final CTA; single `<h1>`; set unique SEO metadata via `buildPageMetadata()`.
- [ ] 5.2 Integration test: `/precos` returns 200 anonymously (no login redirect); renders cards/table/FAQ/CTA; prices match central config; metadata set; `?plano=` links use known slugs — `src/__tests__/integration/marketing/pricing-page.int.test.ts`.

## 6. Middleware gating note

- [ ] 6.1 Confirm `/precos` is classified `public` in `classifyPath()` (added by `public-site-foundation`); add a focused negative/positive-auth assertion if not already covered — extend `src/__tests__/integration/middleware/public-routes-gating.int.test.ts`.

## 7. E2E (pricing critical flows)

- [ ] 7.1 E2E (seeded): load `/precos` → 2 plan cards with R$ 60 / R$ 90 and "Popular" on Avançado; "Experimentar grátis" on Avançado navigates to `/signup?plano=avancado` — `src/__tests__/e2e/seeded/public/pricing.spec.ts`.
- [ ] 7.2 E2E (seeded): expand the comparison table → WhatsApp + IA rows are ✓ only for Avançado; billing FAQ opens/closes exclusively.
- [ ] 7.3 E2E (seeded): homepage "Ver planos completos →" navigates to `/precos` (cross-page link integrity).

