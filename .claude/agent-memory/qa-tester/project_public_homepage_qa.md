---
name: public-homepage-qa
description: Public marketing homepage (/) structure, sections, interactive components, testids/anchors, and the long-CTA mobile-overflow trap
metadata:
  type: project
---

The public homepage lives at `/` (route `src/app/(public)/page.tsx`), composing 10 sections from `src/modules/marketing/components/home/*`. All copy is centralized in `src/modules/marketing/lib/home-content.ts` (single source of truth, MVP-denylist-guarded: no PIX/cobrança/Receita Saúde/reembolso).

**Section order & a11y handles** (each section is `<section aria-labelledby="...-title">` or `aria-label`): hero-headline → "Dados de mercado" (prova-social) → problema-title → solucao-title → funcionalidades-title (also `id="funcionalidades"` for the hero anchor) → destaque-ia-title → confianca-title → precos-resumo-title → faq-title → cta-final-title. Exactly one `<h1>` (in hero). Headings are clean h1→h2→h3, no skipped levels.

**Interactive leaves to re-test on any change:**
- `screenshot-carousel.tsx` — hand-rolled, NO auto-play (no timer), `role=region`+`aria-roledescription=carousel`; slides expose `data-active`, dots are `role=tab` with `data-active`. Arrow keys work when focus is inside. No-JS static-first fallback.
- `screenshot-lightbox.tsx` — `role=dialog aria-modal=true`, opens via thumbnail click AND Enter, dismiss via Escape + "Fechar" button + backdrop; focus → close button on open, restored to trigger on close.
- `faq.tsx` — native `<details>`; no-JS = all open; after hydration exclusive accordion (opening one closes the previous).
- `solucao-timeline.tsx` — scroll fade-in gated behind JS-set `data-fade-visible=false`; reduced-motion path early-returns so default opacity stays 1 (verify by cloning a step without the attr → opacity 1).

**DS rules enforced & asserted:** no linear/radial gradients, no `backdrop-filter: blur`, no `font-weight >= 700` on homepage sections. Destaque-IA surface = solid brand/50 `rgb(242,245,241)`; CTA-final = solid brand/700 `rgb(71,93,69)` inverse text. Verify via getComputedStyle, not class names.

**CTA/UTM:** `SignupCta` renders DS Button `asChild` over a `next/Link` to `/signup`; UTMs from current URL are folded into the href client-side after hydration (SSR href stays bare `/signup`).

**TRAP — long CTA label + DS Button = mobile horizontal overflow.** The DS Button (`src/shared/ui/button.tsx`) has base `whitespace-nowrap`; `size="lg"` adds `px-8`. A long label (e.g. destaque-IA "Comece grátis e experimente na primeira sessão") becomes ~437px wide and cannot wrap → horizontal scroll at ≤375px (worse at 320px), button clipped off-screen. Gone at 768px+. **Always sweep 320/375px for horizontal overflow** after any homepage/CTA copy change: `scrollWidth > innerWidth` + find elements whose `getBoundingClientRect().right > innerWidth`.

**Dev-console noise to ignore on this page:** CSP "invalid source `supabase_kong_hubrityp:8000`" warnings, `eval() not supported` (React dev + CSP), and the `<html data-theme>` hydration-mismatch (intentional no-flash theme script, see `marketing/lib/theme.ts`). None are homepage bugs.

Related: [[playwright-cli-invocation]], [[design-token-space3-undefined]].
