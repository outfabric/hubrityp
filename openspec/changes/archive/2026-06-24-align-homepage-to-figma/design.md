## Context

The public homepage (`/`, in the `(public)` group) is a static, public, RSC-first
marketing page. Its sections live in `src/modules/marketing/components/home/*`,
its copy in `src/modules/marketing/lib/home-content.ts` (typed, single source of
truth, asserted by `home-content.test.ts`), and prices in
`src/modules/marketing/lib/plans.ts` (Zod-validated, integer cents). The footer
lives in `src/modules/marketing/components/public-footer.tsx`.

The DS tokens used by the Figma frames already exist in code: every
`var(--ds-*)` read from Figma is defined in `src/app/globals.css` (light + dark
blocks) and re-exposed to Tailwind as `--color-*` / `--radius-*` / spacing theme
vars. So this is NOT a token-authoring task — it is an alignment task.

Extraction of the 16 canonical frames (8 desktop + 8 mobile, file
`HoLOEqq9PXlo6IwLkz3FQ9`) surfaced **two kinds of drift**, both in scope:

1. **Token/structure drift** — eyebrows missing ("PLANOS", "PERGUNTAS
   FREQUENTES", "CONFORMIDADE & SEGURANÇA"), type-scale and spacing deviations,
   Preços cards lacking per-card feature bullets + per-card CTA, footer surface
   tones.
2. **Copy drift** — the *desktop* strings in `home-content.ts` already differ
   from the Figma frames (e.g. hero headline "Muitas ferramentas viram um único
   sistema clínico." in code vs "De 10 ferramentas espalhadas a um só sistema
   clínico." in Figma; prova-social full sentences vs stat-led "até 5h/semana" +
   "40–60%"; reworded trust guarantees and FAQ answer). Figma is the source of
   truth for the public site, so the copy is realigned to the frames.

The content module is **single-copy**; Figma deliberately uses **condensed copy on
mobile** for several sections, which the current data model cannot express.

## Goals / Non-Goals

**Goals:**

- Bring the 8 in-scope sections (Hero, Prova social, Problema, Solução, Confiança,
  Preços, FAQ, Footer) to token/structure/copy parity with their Figma frames at
  1440 and 375.
- Keep all copy in `home-content.ts` / prices in `plans.ts` (no inline magic
  strings); preserve the exact regulatory codes and the MVP denylist invariants.
- Make each section's parity **verifiable per task** (runtime screenshot vs frame
  + computed-CSS token diff).

**Non-Goals:**

- No change to Funcionalidades, Destaque IA, CTA final, or the Hero
  screenshot-carousel content (no reference frame → out of scope, left intact).
- No new DS tokens, no backend/auth/RLS/Server-Action change, no route-gating
  change (`/` stays public). No versioned `toHaveScreenshot` snapshot lock.
- No tablet layout work (no reference frame; intermediate widths stay fluid).

## Decisions

### D1 — Copy is realigned to Figma (desktop strings updated)

Because Figma governs the public site, the desktop copy in `home-content.ts` is
updated to the verbatim Figma strings for the in-scope sections, and
`home-content.test.ts` is updated in the same change. The regulatory-code
assertions (001/2009, 06/2019, 09/2024, 13/2022, AES-256, TLS 1.3, 13.787/2018,
CRP ativo) and the MVP-denylist test MUST continue to pass.
*Alternative considered:* treat the change as CSS-only and leave copy as-is —
rejected, because it would leave the shipped page disagreeing with the source of
truth on the most visible element (the headline).

### D2 — Mobile condensed copy via optional overrides + responsive spans

Extend the typed content with **optional `mobile` overrides** only on the fields
that actually differ (hero headline/subheadline/microcopy; problema items;
solução title + step copy; confiança items 6 & 8; preços taglines + bullets +
microcopy). Render both variants and toggle with Tailwind (`hidden md:block` /
`md:hidden`), marking the hidden one `aria-hidden` to avoid duplicate
screen-reader text. This is SSR-safe (no JS, no hydration breakpoint guess) and
keeps the maintenance surface bounded to the fields Figma actually condenses.
*Alternative considered:* one canonical copy that reflows (cheaper, but not
faithful to Figma); or a JS `useMediaQuery` swap (hydration cost + CLS). Both
rejected. **CONFIRMED (2026-06-23): implement the condensed mobile variants.**

### D3 — Token mapping is 1:1, audited not invented

Each Figma `var(--ds-X)` maps to the existing `--color-X` / spacing / radius
Tailwind token. Type tokens (Display/xl … Label/caption-upper) map to the DS text
utilities. Before implementing a section, confirm each referenced token exists; if
a frame references a value with **no** matching DS token, STOP and flag it (do not
hardcode an off-token hex/px). The footer uses the **dark** DS context (its
`text-tertiary` resolves to `#a8a29e`, `background` to `#1c1917`), so it is
wrapped in the dark token scope rather than given one-off dark hexes.

### D4 — Preços card content split: config vs curated copy

Price, plan name, and badge come from `plans.ts` (central config, already
present). The per-card **summary bullets** in Figma ("Agenda, pacientes e
prontuário", "Telepsicologia integrada", …) are curated marketing summaries, NOT
the verbatim 9-key `FEATURE_LABELS`; they live as new curated fields in
`home-content.ts` (`PRICING_SUMMARY`), keeping prices authoritative in config
while the homepage blurb stays editorial.

### D5 — Solução closer hidden on mobile (Figma fidelity)

The desktop closing line "De ponta a ponta — sem sair do sistema." is absent from
the mobile frame; render it `hidden md:block`. **CONFIRMED (2026-06-23): hide on
mobile.**

### D6 — Verification protocol per task (no snapshot lock)

Each section task is "done" only when, at the frame's real width (1440 desktop /
375 mobile), (a) I bring up the app (`docker compose up`) and capture a runtime
screenshot **myself via the playwright-cli skill**, confront it with the Figma
frame, and (b) read `getComputedStyle` on the changed elements and diff against
the section's `get_variable_defs` values. AA contrast, placeholder/asset gaps, and
any LGPD-implicated copy are flagged separately, not silently changed.

## Risks / Trade-offs

- **[Marketing copy change has conversion impact]** → the headline and stat copy
  change is a content decision, not just styling; stakeholder sign-off was
  obtained 2026-06-23 (see Resolved Decisions #1).
- **[Dual-copy duplicates text in the DOM]** → `aria-hidden` on the inactive
  variant prevents double announcement; the byte cost is negligible for a static
  page.
- **[Existing tests assert the old copy]** → `home-content.test.ts` plus any
  unit/integration/e2e referencing the old strings must be updated in the same
  change; the regression sweep (e2e + integration full) is the safety net.
- **[Token name drift between Figma and code]** → audit each token before coding
  (D3); a missing token is a flag, not an invention.
- **[Mobile FAQ has no reference frame]** → treated as fluid reflow of the desktop
  spec; if a mobile FAQ frame is later supplied, revisit.

## Migration Plan

Static presentation change, no data/flag/migration. Implement section by section
(Hero → Prova social → Problema → Solução → Confiança → Preços → FAQ → Footer),
each with its desktop+mobile parity and per-task verification. Rollback is a plain
revert of the change (no state to unwind).

## Resolved Decisions (2026-06-23)

All five open questions were answered before implementation:

1. **Copy sign-off — APPROVED.** Realign the homepage marketing copy (hero
   headline, prova-social stats, trust guarantees, FAQ answer, etc.) to the Figma
   strings now, preserving the regulatory codes and the MVP denylist (D1).
2. **Mobile condensed copy — IMPLEMENT VARIANTS** via optional `mobile` overrides
   + responsive spans (D2).
3. **Preços "Ver planos completos" link — KEEP ON BOTH BREAKPOINTS** (the mobile
   frame omission is treated as incidental; the conversion path to `/precos` is
   preserved on mobile).
4. **Solução closer on mobile — HIDE** ("De ponta a ponta — sem sair do sistema."
   is `hidden md:block`) (D5).
5. **FAQ mobile frame — EXISTS (`138:2`).** It was extracted: the mobile FAQ has
   NO eyebrow (the "PERGUNTAS FREQUENTES" eyebrow is desktop-only), condensed
   question copy ("Funciona para presencial também?", "A IA inventa conteúdo?",
   "Quanto custa depois do teste?"), a condensed Q1 answer ("Servidores no Brasil
   (São Paulo), AES-256 e TLS 1.3. Você é a controladora; nós, operadores,
   conforme a LGPD."), and a smaller question scale (Body/base 15 / Heading-h4 vs
   Body/lg 17 on desktop). FAQ therefore also uses the D2 mobile-variant pattern.
