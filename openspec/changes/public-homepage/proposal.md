## Why

The homepage (`/`) is the platform's primary conversion surface: a psychologist who discovers the product must understand in under 3 minutes what it does, see the real system (screenshots), trust its CFP/LGPD compliance, and click through to `/signup`. The `public-site-foundation` change ships the shell (layout, header, footer, theme, SEO, plans config); this change ships the **homepage body** — all 10 sections from PRD 14 §5.2–5.13 plus the reusable screenshot carousel — reproducing the Figma `Public · Homepage` screens.

## What Changes

- **Homepage body** rendered inside the `(public)` layout: 10 sections in order — (1) Hero, (2) Prova social, (3) Problema, (4) Solução (timeline), (5) Funcionalidades (7 cards), (6) Destaque IA (antes/depois), (7) Confiança (8 garantias CFP/LGPD), (8) Preços resumo, (9) FAQ accordion, (10) CTA final.
- **Reusable screenshot carousel** component (hero + reusable elsewhere): 4–6 screenshots, arrows (desktop) + swipe (mobile), position dots, captions, no auto-play, `next/image` WebP, lazy loading, no-JS static fallback.
- **Feature-card screenshot lightbox/modal** for the 7 feature cards.
- **Scroll-triggered fade-in** for the solution timeline, gated by `prefers-reduced-motion`.
- **FAQ accordion** using `<details>/<summary>` (exclusive: opening one closes others; all-open without JS).
- **Performance work** for the homepage as the LCP page: hero image preload, explicit image dims (CLS < 0.1), Lighthouse mobile ≥ 90.
- **Homepage SEO metadata** via the foundation's `buildPageMetadata()` helper.
- All copy is MVP-only (no PIX/Receita Saúde/reembolso as available features); regulatory text uses the exact resolution numbers/years.

## Capabilities

### New Capabilities

- `public-homepage`: The homepage route body and its 10 marketing sections, with MVP-accurate copy and regulatory text.
- `screenshot-carousel`: The reusable, accessible screenshot carousel (arrows/swipe/dots/captions, no auto-play, lazy WebP, no-JS fallback).
- `homepage-faq`: The exclusive `<details>`-based FAQ accordion with the required MVP questions.
- `homepage-performance`: The homepage performance budget (LCP/CLS/Lighthouse) and reduced-motion behavior.

### Modified Capabilities

_None._ This change consumes the `public-site-shell`, `public-navigation`, `public-seo`, and `subscription-plans-config` capabilities introduced by `public-site-foundation` without changing their requirements.

## Impact

- **Code**: `src/app/(public)/page.tsx` (homepage body replacing the foundation placeholder); new section components and the carousel/lightbox/FAQ under `src/modules/marketing/components/home/`; copy/content constants under `src/modules/marketing/lib/home-content.ts`; screenshot assets served from `public/screenshots/*.webp` (sourced from `docs/screenshots/`).
- **Dependencies**: relies on `public-site-foundation` (shell, plans config, SEO helper, theme). No new npm dependency required (carousel is hand-rolled for control + a11y + no-JS fallback; if a library is used it must support reduced-motion and SSR/no-JS — confirm via Context7).
- **Assets**: copy real screenshots from `docs/screenshots/` into `public/screenshots/` as optimized WebP (< 200 KB each, explicit dimensions). Filenames on disk: `hoje-pendencias.webp`, `painel.webp`, `agenda.webp`, `pacientes.webp`, `prontuario.webp`, `telepsicologia.webp`, `evolucao.webp`, `whatsapp.webp`.
- **Security/LGPD**: public page, no DB/RLS changes; screenshots use fictitious-but-plausible data only (no real patient data). No PII anywhere.
