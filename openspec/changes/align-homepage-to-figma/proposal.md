## Why

The public homepage (`/`) was built before the current Figma frames in the
"Hubrity Design System" file were finalized, and has since drifted from them.
Per our standing rule, the **live Figma is the only source of truth** for the
public site (the old handoff doc is obsolete). The redesigned frames — Hero,
Prova social, Problema, Solução, Confiança, Preços, FAQ, Footer, at desktop
1440 and mobile 375 — are the contract the rendered page must match, token for
token. This change closes the gap between what ships and what was designed.

## What Changes

- Align the **8 homepage sections** to their canonical Figma subframes, at both
  breakpoints (desktop 1440, mobile 375 — no tablet), correcting spacing,
  typography, color, radius, ordering, and component structure to the exact
  design-system tokens read from Figma.
  - Desktop subframes: Hero `108:2`, Prova social `113:2`, Problema `114:2`,
    Solução `116:2`, Confiança `123:2`, Preços `124:2`, FAQ `125:2`, Footer
    `126:7`.
  - Mobile subframes: Hero `133:14`, Prova social `135:2`, Problema `135:9`,
    Solução `135:42`, Confiança `137:2`, Preços `137:47`, Footer `138:36`.
- Each section's spec requirement is updated to reference the **exact tokens and
  structure extracted from Figma** (via the Figma MCP: `get_variable_defs`,
  `get_metadata`, `get_screenshot`), replacing approximate or drifted values.
- Every implementation task carries a **verifiable acceptance criterion**:
  runtime screenshot (captured locally via the playwright-cli skill) confronted
  against the ideal Figma frame, plus a **token-by-token** comparison against the
  values extracted from Figma, at the section's real width.
- Discrepancies surfaced during extraction that are NOT pure visual drift — AA
  contrast issues, placeholder/asset gaps, or copy with LGPD implications — are
  flagged in the specs/design rather than silently "fixed", so they can be
  decided explicitly.
- **Decided (2026-06-23): the 4 sections without a reference frame —
  Funcionalidades, Destaque IA, CTA final, and the Hero screenshot-carousel —
  are kept as-is and are OUT OF SCOPE** for this change. The redesign is assumed
  to have left them unchanged, not removed them. No section is deleted here.
- **Decided (2026-06-23): no versioned visual-regression snapshots**
  (`toHaveScreenshot`). Verification is the per-task manual confrontation
  (runtime screenshot via playwright-cli × Figma frame) plus the token-by-token
  diff — not an automated pixel snapshot lock.
- **No** changes to data, auth gating, RLS, Server Actions, or any backend
  surface: the homepage is a public, static marketing page. This is a
  presentation-layer alignment only.

## Capabilities

### New Capabilities
<!-- None — this change re-aligns existing capabilities to their Figma source; it introduces no new capability. -->

### Modified Capabilities

- `public-homepage`: the Hero, Prova social, Problema, Solução timeline,
  Confiança, and Preços-resumo section requirements are updated to match the
  exact Figma tokens, layout, and structure of their subframes at 1440 and 375.
- `homepage-faq`: the FAQ section's visual structure (spacing, open/closed
  states, typography) is aligned to its Figma subframe at both breakpoints.
- `public-navigation`: the public footer requirement is aligned to its Figma
  subframe (dark-surface layout, columns, tokens) at both breakpoints.

## Impact

- **Affected code** (presentation only):
  - `src/modules/marketing/components/home/*` — `hero.tsx`, `prova-social.tsx`,
    `problema.tsx`, `solucao-timeline.tsx`, `confianca.tsx`, `precos-resumo.tsx`,
    `faq.tsx` / `faq-accordion.tsx`.
  - `src/modules/marketing/components/public-footer.tsx`.
  - `src/app/(public)/page.tsx` and `(public)/layout.tsx` if section ordering or
    composition shifts.
  - Possibly `src/modules/marketing/lib/home-content.ts` for copy/content tokens.
  - Design-system primitives under `src/shared/ui/` only if a token is missing
    (flagged, not silently invented).
- **Route gating**: unchanged — `/` stays public; no `middleware.ts` change. The
  negative-auth posture of the public site is unaffected.
- **Tests**: existing homepage unit/integration coverage updated for any changed
  copy/structure; the per-task Figma confrontation + token diff is the
  acceptance gate. No `toHaveScreenshot` regression lock is added (decided
  above).
- **Dependencies / data residency**: none added; no PII, no data leaving Brazil.
