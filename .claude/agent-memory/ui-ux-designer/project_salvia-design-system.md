---
name: salvia-design-system
description: The Sálvia design system — Figma file is the canonical source of truth (code mirrors it), plus philosophy and hard constraints for the Hubrity psychologist SaaS UI
metadata:
  type: project
---

The product's design system is called **Sálvia** (verde-sálvia / sage green). The **canonical source of truth is the Figma Design System file**: https://www.figma.com/design/HoLOEqq9PXlo6IwLkz3FQ9/Hubrity-Design-System?node-id=13-7 — always read it (via Figma MCP) before designing or refining any screen/component. The codebase mirrors it in two files: `src/app/globals.css` (`@theme inline` + `:root`/`[data-theme='dark']` `--ds-*` runtime vars) and `docs/design-system/rules.md` (1:1 spec). `tailwind.config.ts` is documentation-only (Tailwind v4 reads tokens from CSS). When Figma and the code/docs disagree, Figma wins — reconcile the mirrors to match it.

**Token architecture (two-tier):** runtime `--ds-*` vars flip with dark mode via `data-theme='dark'` on `<html>`; Tailwind theme tokens (`--color-*`, `--radius-*`, etc.) alias the `--ds-*` vars. Brand 50–900, semantic success/warning/danger/info (50/500/700), neutral bg/surface/border/text scales. Spacing base-4 (`--ds-space-1..24`). Radius sm/md/lg/xl/2xl/full. Shadows xs/sm/md/lg/focus (neutral, never colored). Durations 150/200/300ms, ease-out `cubic-bezier(0.16,1,0.3,1)`.

**Philosophy:** Calmo antes de bonito; funcional antes de decorativo; consistência radical; acessível por padrão (WCAG 2.1 AA min).

**Hard prohibitions:** no gradients, no colored shadows, no glassmorphism/blur/glow/neon, >3 functional colors per screen, no emojis in product UI, no animations >300ms or bouncing, no font weights 700+ in long text, no nested cards, no underline on buttons/nav. Only font weights 400 + 600. Brand color reserved for primary button / active nav / active-state indicator / focus ring / logo / avatar fallback.

**Type:** Inter (sans) + JetBrains Mono. Scale h1 28/600, h2 22/600, h3 18/600, h4 16/500, body-lg 17/400, body 15/400, body-sm 13/400, caption 12/500, caption-upper 12/500+uppercase+0.06em tracking.

**Figma file state (verified 2026-06-15):** the DS file is fully built at the FOUNDATION level — collections `Color` (modes Light/Dark, semantic aliases `color/bg|border|text|brand|success|warning|danger|info/*` over a `Primitives` collection of sage/neutral/green/amber/red/sky), `Spacing` (`space/1..24`), `Radius` (`radius/sm..full`); text styles `Heading/h1-h4`, `Body/lg|base|sm`, `Label/caption|caption-upper`, `Code/base` (+ marketing additions `Display/xl|lg|md`, `Lead`); effect styles `Shadow/Light|Dark/{xs..lg}`, `Focus/*/ring`. **No reusable Figma COMPONENTS (Button/Card/etc.) exist yet** — build screens by composing auto-layout primitives with fills/spacing/radius bound to these tokens and text/effect styles applied. The public marketing pages (PRD 14: homepage desktop+mobile, /precos, legal, 404, cookie banner) were built on dedicated `Public · *` pages in this file; spec is `docs/design-system/public-pages-handoff.md`. (There is also an unrelated `DS APP viagens` library visible in search — a travel app — do NOT use its tokens/components.)

**Why:** clinical SaaS for Brazilian psychologists — interface must recede so patient/clinician focus stays central.
**How to apply:** when building or reviewing any UI (Figma or code), pull values from these tokens, never hardcode; honor the prohibitions; design light + dark in parallel. Icons: Lucide only, stroke 1.5. Microcopy glossary is fixed (see [[salvia-microcopy-glossary]] if created).
