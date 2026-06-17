## Context

This change renders the homepage body inside the `(public)` shell delivered by `public-site-foundation` (header, footer, theme, SEO helper, plans config). The visual source of truth is the Figma `Public · Homepage` (desktop `105:2`, mobile `133:2`) and `docs/design-system/public-pages-handoff.md` §5. The homepage is the conversion + LCP page, so performance and accessibility are first-class.

Real screenshots already exist in `docs/screenshots/` (`.webp` + `.png`). The DS (Sálvia) forbids gradients, colored shadows, glassmorphism/blur/glow, > 3 functional colors per screen, weights ≥ 700, and emojis in UI; contrast for the Destaque IA / CTA-final sections comes from solid brand surfaces (`brand/50`, `brand/700`).

## Goals / Non-Goals

**Goals:**
- Reproduce the 10 Figma sections faithfully with MVP-accurate, DS-compliant copy and visuals.
- A reusable, accessible, no-auto-play screenshot carousel with no-JS fallback.
- An exclusive `<details>`-based FAQ that also works without JS.
- Hit the performance budget (Lighthouse ≥ 90, LCP < 2.5s, CLS < 0.1) and respect reduced-motion.

**Non-Goals:**
- The shell, header, footer, theme, SEO infra, plans config (→ `public-site-foundation`).
- The `/precos` page (→ `public-pricing-page`).
- Producing new screenshots or final video/demo assets.

## Decisions

### D1 — Sections as composable Server Components; interactivity at leaves
Each of the 10 sections is its own Server Component under `marketing/components/home/`, composed by `app/(public)/page.tsx`. Only genuinely interactive pieces (`carousel`, feature-card `lightbox`, `faq` toggle behavior, scroll fade-in observer) are `'use client'` leaves. Rationale: RSC-first per CLAUDE.md; keeps JS payload minimal for the LCP page.

### D2 — Copy/content in a constants module
All headlines, lists, the 7 feature cards, the 8 regulatory guarantees, and the 5 FAQ entries live in `marketing/lib/home-content.ts` (typed). Rationale: avoids magic strings in JSX, eases review against the PRD's exact regulatory wording, and enables future A/B/i18n. Regulatory strings are asserted by tests against the exact codes.

### D3 — Hand-rolled carousel
Implement a small custom carousel rather than pulling a library, because the requirements are unusual: no auto-play, mandatory no-JS static-first fallback, full keyboard + ARIA, swipe, and reduced-motion. A generic library would fight the no-JS and reduced-motion constraints. The carousel is a client leaf; SSR renders the first slide so no-JS shows a usable static image. (If a library is later preferred, confirm SSR/no-JS/reduced-motion support via Context7 first.)

### D4 — FAQ via native `<details>/<summary>`
Use native disclosure elements so the no-JS state (all open) is free and accessibility is built-in. A tiny client enhancement enforces the "exclusive" behavior (closing siblings on open) and the active-border style; without JS, exclusivity is dropped but all answers remain readable — acceptable per the edge case.

### D5 — Scroll fade-in via IntersectionObserver, reduced-motion-guarded
The solution timeline fades in on scroll using IntersectionObserver. The initial state is full-opacity in CSS, and the "hidden-until-seen" class is only added when JS runs AND `prefers-reduced-motion` is not set — guaranteeing content is never permanently hidden if JS fails or motion is reduced.

### D6 — Screenshot pipeline
Copy the real screenshots from `docs/screenshots/` into `public/screenshots/` as optimized WebP (< 200 KB, explicit dims). Map handoff names to real files: hero dashboard → `hoje-pendencias.webp`/`painel.webp`; cards → `agenda.webp`, `pacientes.webp`, `whatsapp.webp`, `prontuario.webp`, `telepsicologia.webp`, `evolucao.webp`. Each `next/image` declares width/height for CLS. The hero image is preloaded as the LCP element. Alt text is descriptive and Portuguese.

### D7 — Pricing summary consumes central config
The Preços-resumo section reads from `subscription-plans-config` (foundation) — never hardcodes prices — and links to `/precos`.

## Risks / Trade-offs

- **[LCP/CLS regression]** → Preload hero, explicit image dims, minimal client JS, lazy below-fold images; verify with a Lighthouse/perf check in CI or manual QA.
- **[Carousel a11y gaps]** → Full keyboard + ARIA + focus management in unit tests; no-JS static fallback test.
- **[Regulatory text drift]** → Exact strings in `home-content.ts` asserted by unit tests (codes/years).
- **[Reduced-motion content hidden]** → CSS default is visible; hidden class added only when safe; test asserts visible content with reduced-motion.
- **[Real patient data in screenshots]** → Assets reviewed to be fabricated; documented in the carousel spec and verified during QA.
- **[DS prohibition violations]** → Unit/visual checks assert no gradient/blur/weight ≥ 700; QA against Figma.

## Open Questions

- Hero screenshot choice: `painel.webp` vs `hoje-pendencias.webp` for the "Dashboard operacional" slide — pick the one matching the Figma hero frame.
- Whether the feature-card lightbox should support arrow-navigation across all 7 screenshots or open a single image (default: single image with close; revisit per Figma).
