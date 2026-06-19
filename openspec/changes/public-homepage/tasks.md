> [!IMPORTANT]
> **MANDATORY — design fidelity (read before implementing any UI task in this change).**
> The homepage screens are designed in Figma and are the **visual source of truth**. You MUST open and **strictly follow** them — layout, tokens (color / spacing / radius / typography), spacing, states, and responsive behavior — for every section and component (hero, carousel, timeline, feature cards, lightbox, FAQ, CTAs). Do not improvise visuals or invent values not backed by DS tokens.
> - **File:** Hubrity Design System — `https://www.figma.com/design/HoLOEqq9PXlo6IwLkz3FQ9/Hubrity-Design-System` (file key `HoLOEqq9PXlo6IwLkz3FQ9`).
> - **Pages / nodes for this change:** `Public · Homepage` — desktop `105:2`, mobile `133:2` (carousel within the hero `110:x`).
> - **How:** use the **Figma MCP** (`get_design_context`, `get_screenshot`, `get_metadata`, `get_variable_defs`) to inspect each section frame and pull exact tokens **before and during** implementation.
> - **Precedence:** on any conflict, the **Figma screens prevail on visual form**; this change's specs prevail on business rules and content (MVP-only, exact regulatory codes).

## 1. Content constants + assets

- [x] 1.1 Create `src/modules/marketing/lib/home-content.ts` with typed copy for all 10 sections: hero (badge/headline/subhead/CTAs/microcopy), prova social (2 stats), problema (5 items + closer), solução (6 steps), 7 feature cards, destaque IA (title/subtitle/labels/4 trust items/CTA), 8 regulatory guarantees (exact codes), preços-resumo strings, 5 FAQ entries, CTA-final strings.
- [x] 1.2 Copy real screenshots from `docs/screenshots/` into `public/screenshots/` as optimized WebP (< 200 KB each, explicit dims): `hoje-pendencias`/`painel`, `agenda`, `pacientes`, `whatsapp`, `prontuario`, `telepsicologia`, `evolucao`. Add descriptive pt-BR alt text mapping.
- [x] 1.3 Unit test: `home-content.ts` contains exactly 5 mirror items, 6 solution steps, 7 feature cards, 8 guarantees with literal codes ("001/2009", "06/2019", "09/2024", "13/2022", "AES-256", "TLS 1.3", "13.787/2018", "CRP ativo"), 5 FAQ items; no post-MVP feature string present — `src/__tests__/unit/modules/marketing/home-content.test.ts`.

## 2. Screenshot carousel

- [x] 2.1 Implement `marketing/components/home/screenshot-carousel.tsx` (client leaf): product-window frame, arrows (≥44px) + dots (active `brand/600` pill) + captions, swipe, keyboard (Arrow keys), ARIA region/group + current-slide, NO auto-play; SSR renders first slide for no-JS static fallback.
- [x] 2.2 Wire `next/image` WebP with explicit dims + lazy loading for off-screen slides.
- [x] 2.3 Unit test: arrows/dots/keyboard change slides + caption, no auto-advance timer, ARIA present, focus retained, first-slide static fallback markup — `src/__tests__/unit/modules/marketing/screenshot-carousel.test.tsx`.

## 3. Hero section

- [x] 3.1 Implement `marketing/components/home/hero.tsx`: badge, `Display/xl` headline, `Lead` subhead, primary/secondary CTAs (UTM-preserving), microcopy, embedded carousel with the 5 ordered hero screenshots; hero image preloaded (LCP).
- [x] 3.2 Unit test: hero renders badge/headline/subhead naming MVP features + CFP/LGPD, CTAs target `/signup` (UTM preserved) and `#funcionalidades`, microcopy present — `src/__tests__/unit/modules/marketing/hero.test.tsx`.

## 4. Prova social + Problema sections

- [x] 4.1 Implement `prova-social.tsx` (2 market stats, `bg/surface-muted`, no fabricated testimonials).
- [x] 4.2 Implement `problema.tsx` ("Você ainda faz isso?", 5 mirror items, recognition closer).
- [x] 4.3 Unit test both sections (stat content + no testimonial; 5 items + closer) — `src/__tests__/unit/modules/marketing/prova-problema.test.tsx`.

## 5. Solução timeline + reduced-motion fade-in

- [x] 5.1 Implement `solucao-timeline.tsx`: 6 connected steps (horizontal desktop / vertical mobile), Lucide icon in `brand/50` chip, one-line text, closer.
- [x] 5.2 Implement the IntersectionObserver scroll fade-in as a client enhancement — default CSS visible; hidden-until-seen only when JS runs AND not `prefers-reduced-motion`.
- [x] 5.3 Unit test: 6 ordered steps + closer; content visible by default; fade-in disabled under reduced-motion; never stuck at opacity 0 — `src/__tests__/unit/modules/marketing/solucao-timeline.test.tsx`.

## 6. Funcionalidades grid + lightbox

- [x] 6.1 Implement `funcionalidades.tsx` (`#funcionalidades`): 7 cards (3×2 + Dashboard full/double-width), icon + `Heading/h3` title + benefit description + clickable screenshot thumbnail; copy from content module.
- [x] 6.2 Implement the accessible screenshot lightbox/modal leaf (Escape + close button, focus trap + restore).
- [x] 6.3 Unit test: 7 cards with correct titles + thumbnails; section id `funcionalidades`; lightbox opens/closes via keyboard and restores focus — `src/__tests__/unit/modules/marketing/funcionalidades.test.tsx`.

## 7. Destaque IA section

- [x] 7.1 Implement `destaque-ia.tsx`: solid `brand/50` surface, quantified title, subtitle, antes/depois pair (empty editor vs AI-filled evolução with the two labels), 4 trust items, CTA → `/signup`.
- [x] 7.2 Unit test: solid surface (no gradient/blur), antes/depois labels, 4 trust items, CTA target — `src/__tests__/unit/modules/marketing/destaque-ia.test.tsx`.

## 8. Confiança section

- [x] 8.1 Implement `confianca.tsx`: title, 8 checkmark guarantees (exact codes, `brand/700` checks), closer.
- [x] 8.2 Unit test: exactly 8 guarantees with all required literal codes/years — `src/__tests__/unit/modules/marketing/confianca.test.tsx`.

## 9. Preços resumo + CTA final

- [x] 9.1 Implement `precos-resumo.tsx`: 2 plan cards from `subscription-plans-config` (Essencial/Avançado "Mais popular", monthly only), microcopy, "Ver planos completos →" → `/precos`.
- [x] 9.2 Implement `cta-final.tsx`: solid `brand/700` + inverse text, title, CTA → `/signup` (UTM preserved), microcopy. No gradient.
- [x] 9.3 Unit test: prices come from central config (change config → change render); CTA-final solid surface + `/signup` target — `src/__tests__/unit/modules/marketing/precos-cta.test.tsx`.

## 10. FAQ accordion

- [x] 10.1 Implement `faq.tsx` using native `<details>/<summary>` with the 5 required MVP questions/answers; client enhancement for exclusive behavior + active `brand/200` border; all-open without JS.
- [x] 10.2 Unit test: 5–8 items incl. the 5 required; exclusive toggle closes previous; all expanded without JS; keyboard toggle — `src/__tests__/unit/modules/marketing/faq.test.tsx`.

## 11. Homepage assembly + metadata

- [ ] 11.1 Implement `src/app/(public)/page.tsx`: compose the 10 sections in order; single `<h1>`; set homepage SEO metadata via the foundation `buildPageMetadata()` (unique title/description/canonical/OG); preload hero image.
- [ ] 11.2 Integration test: homepage renders all 10 sections in order with exactly one `<h1>`; pricing values match central config; regulatory codes present; metadata (title/description/canonical/og) set — `src/__tests__/integration/marketing/homepage.int.test.ts`.

## 12. E2E (homepage critical flows)

- [ ] 12.1 E2E (seeded): load `/` → hero renders; "Começar grátis — 14 dias" navigates to `/signup`; "Ver funcionalidades" scrolls to `#funcionalidades`; "Entrar" → `/login` — `src/__tests__/e2e/seeded/public/homepage.spec.ts`.
- [ ] 12.2 E2E (seeded): carousel arrows/dots change slide without auto-advancing; feature-card thumbnail opens lightbox and Escape closes it.
- [ ] 12.3 E2E (seeded): FAQ — opening one item closes the previously open one; reduced-motion emulation disables scroll animation (content visible).
- [ ] 12.4 E2E (seeded): UTM params on `/?utm_source=...` are preserved on the hero "Começar grátis" navigation to `/signup`.


