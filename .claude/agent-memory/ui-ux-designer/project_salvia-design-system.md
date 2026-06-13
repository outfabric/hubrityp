---
name: salvia-design-system
description: The Sálvia design system — token source of truth, philosophy, and hard constraints for the Hubrity psychologist SaaS UI
metadata:
  type: project
---

The product's design system is called **Sálvia** (verde-sálvia / sage green). Canonical token source of truth lives in two mirrored files: `src/app/globals.css` (`@theme inline` + `:root`/`[data-theme='dark']` `--ds-*` runtime vars) and `docs/design-system/rules.md` (1:1 spec). `tailwind.config.ts` is documentation-only (Tailwind v4 reads tokens from CSS).

**Token architecture (two-tier):** runtime `--ds-*` vars flip with dark mode via `data-theme='dark'` on `<html>`; Tailwind theme tokens (`--color-*`, `--radius-*`, etc.) alias the `--ds-*` vars. Brand 50–900, semantic success/warning/danger/info (50/500/700), neutral bg/surface/border/text scales. Spacing base-4 (`--ds-space-1..24`). Radius sm/md/lg/xl/2xl/full. Shadows xs/sm/md/lg/focus (neutral, never colored). Durations 150/200/300ms, ease-out `cubic-bezier(0.16,1,0.3,1)`.

**Philosophy:** Calmo antes de bonito; funcional antes de decorativo; consistência radical; acessível por padrão (WCAG 2.1 AA min).

**Hard prohibitions:** no gradients, no colored shadows, no glassmorphism/blur/glow/neon, >3 functional colors per screen, no emojis in product UI, no animations >300ms or bouncing, no font weights 700+ in long text, no nested cards, no underline on buttons/nav. Only font weights 400 + 600. Brand color reserved for primary button / active nav / active-state indicator / focus ring / logo / avatar fallback.

**Type:** Inter (sans) + JetBrains Mono. Scale h1 28/600, h2 22/600, h3 18/600, h4 16/500, body-lg 17/400, body 15/400, body-sm 13/400, caption 12/500, caption-upper 12/500+uppercase+0.06em tracking.

**Why:** clinical SaaS for Brazilian psychologists — interface must recede so patient/clinician focus stays central.
**How to apply:** when building or reviewing any UI (Figma or code), pull values from these tokens, never hardcode; honor the prohibitions; design light + dark in parallel. Icons: Lucide only, stroke 1.5. Microcopy glossary is fixed (see [[salvia-microcopy-glossary]] if created).
