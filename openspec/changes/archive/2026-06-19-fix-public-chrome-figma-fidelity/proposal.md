## Why

The public chrome shipped by `public-site-foundation` (header, footer, cookie
banner, legal pages, 404) was built from a **text handoff doc**
(`docs/design-system/public-pages-handoff.md`) and token names, not from the
live Design System Figma frames. The Figma evolved after the handoff was
written and the handoff also encoded intentional deviations, so the shipped
chrome drifted from the design (extra theme toggle in the header, wrong footer
layout/copy/logo treatment, an extra "LGPD" link, a legal-review notice that is
not in the design). The handoff is now declared **obsolete**: the live Figma is
the single visual source of truth, and the chrome must be brought back into
fidelity with it.

## What Changes

- **Header** (`128:3`): **remove the theme toggle** (desktop + mobile). Dark mode
  follows the OS `prefers-color-scheme` only; there is no in-UI theme control.
  **BREAKING** for `design-system-foundation` (which currently mandates a
  persisted, `prefers-color-scheme`-aware toggle).
- **Footer** (`131:32`): brand-left + three link columns clustered right (not an
  even 4-column grid); column headings in uppercase tertiary caption style;
  brand lockup renders the **tricolor symbol + light wordmark** on the dark
  surface (not an all-white lockup); **remove the "LGPD"** link from the Legal
  column; correct the tagline, contact email, and copyright line to the Figma
  copy.
- **Logo primitive** (`src/shared/ui/logo.tsx`): add the dark-surface treatment
  (colored symbol + light wordmark) the footer needs — the current `color |
  white | mono` tones cannot express it. Brand geometry/colors come from the
  Brand Identity file (`4O3POARuvEYI1BCrxbOFg2`).
- **Cookie banner** (`132:2`), **Privacidade** (`142:2`), **Termos** (`143:2`),
  **404** (`144:2`): align each to its Figma frame; in particular re-evaluate the
  `legal-review-notice` (absent from the Figma legal frames) and the legal-page
  copy.
- **Delete the handoff doc**: remove `docs/design-system/public-pages-handoff.md`
  (obsolete) so the next contributor does not repeat the drift; the live Figma is
  the source of truth.
- **No new routes, no DB/RLS changes, no auth-flow changes** — this is a
  visual-fidelity change over already-public surfaces.

## Capabilities

### New Capabilities

<!-- None — this change brings existing capabilities into design fidelity; it
     introduces no new capability. -->

### Modified Capabilities

- `public-navigation`: header drops the theme toggle; footer link set (no "LGPD"
  link), column layout, heading style, brand-lockup tone on dark, and footer copy
  (tagline / contact / copyright) are restated to match the Figma frame.
- `design-system-foundation`: replace the "persisted, `prefers-color-scheme`-aware
  **toggle**" requirement with "dark mode is driven by `prefers-color-scheme`
  only, with no in-UI toggle"; add the Logo dark-surface tone (colored symbol +
  light wordmark).
- `public-legal-pages`: re-evaluate the legal-review notice (not in the design)
  and align the privacy/terms copy and layout to the Figma frames.
- `cookie-consent`: the consent banner's visual structure matches the Figma
  frame (title, body, "Saiba mais" link, `Aceitar`/`Recusar` actions). Consent
  behavior and analytics gating are unchanged.
- `public-site-shell`: the 404 page matches the Figma frame (heading, message,
  `Voltar para a homepage` + `Criar conta grátis` CTAs).

## Impact

- **Code**: `src/modules/marketing/**` (header, footer, theme provider/toggle
  removal, cookie banner, legal-review notice), `src/shared/ui/logo.tsx`,
  `src/app/(public)/**` (layout, legal pages, `not-found.tsx`),
  `src/app/globals.css` / root layout (no-flash script reverts to
  `prefers-color-scheme` only if the toggle is removed).
- **Design sources** (Figma MCP, pulled by the implementing agent — no external
  references are provided): DS "Sálvia" `HoLOEqq9PXlo6IwLkz3FQ9` (header `128:3`,
  footer `131:32`, cookie `132:2`, privacy `142:2`, terms `143:2`, 404 `144:2`);
  Brand "Marca/Escuta" `4O3POARuvEYI1BCrxbOFg2` (symbol `16:7`, lockup-h `17:2`,
  lockup-v `17:8`).
- **Docs**: `docs/design-system/public-pages-handoff.md` deleted (obsolete).
- **Tests**: integration tests asserting footer links/landmarks need updating
  (e.g. Legal column drops from 3 to 2 links; no theme-toggle control in the
  header). The `(public)` negative-auth gating tests remain valid and must keep
  passing.
- **Accessibility**: any Figma value that fails WCAG 2.1 AA contrast is flagged
  during implementation rather than silently reverted — replicate the design but
  do not regress accessibility on light or dark surfaces.
- **No database, RLS, or route-classification changes.**
