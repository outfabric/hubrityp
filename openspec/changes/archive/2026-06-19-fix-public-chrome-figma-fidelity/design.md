## Context

`public-site-foundation` (archived 2026-06-18) shipped the public chrome from a
text handoff (`docs/design-system/public-pages-handoff.md`) plus token names,
not from the live Figma. The handoff is now **obsolete**; the live Figma is the
single visual source of truth. The implementing agent pulls every frame itself
via the Figma MCP — no external references are provided.

**Source-of-truth files (Figma MCP):**

- DS "Sálvia" `HoLOEqq9PXlo6IwLkz3FQ9` — header `128:3`, footer `131:32`, cookie
  banner `132:2`, privacy `142:2`, terms `143:2`, 404 `144:2`. (Page listing only
  returns the active page; reach a frame by node id, `get_screenshot` /
  `get_metadata`. `get_variable_defs` needs a manual selection — fall back to the
  `--ds-*` tokens in `globals.css` for exact values.)
- Brand "Marca/Escuta" `4O3POARuvEYI1BCrxbOFg2` — symbol `16:7` (tricolor: sage
  left / slate-blue right / teal link), lockup-h `17:2`, lockup-v `17:8`.

**Confirmed divergences (audited code vs live Figma):**

| # | Surface | Figma (truth) | Code today | Kind |
|---|---|---|---|---|
| H1 | Header `128:3` | no theme toggle | `<ThemeToggle/>` desktop + mobile | extra element |
| H2 | Header `128:3` | nav links grouped with the CTAs in one right-aligned cluster | `justify-between` spreads the nav toward the center | layout |
| H3 | Header `128:3` | "Entrar" is a bordered **secondary** button (`Button/secondary`) | `variant="ghost"` (borderless text) — also diverges from the existing spec, which already says "secondary" | style |
| F1 | Footer `131:32` | brand-left + 3 cols clustered right | even `md:grid-cols-4` | layout |
| F2 | Footer headings | "PRODUTO" uppercase tertiary caption | "Produto" semibold primary | style |
| F3 | Footer logo | tricolor symbol + light wordmark | all-white lockup (`tone="white"`) | color |
| F4 | Footer Legal | only Privacidade + Termos | adds "LGPD" link | extra element |
| F5 | Footer tagline | "O sistema único para o consultório de psicólogos autônomos no Brasil." | "Plataforma para psicólogos autônomos brasileiros" | copy |
| F6 | Footer contact | `hubrity.platform@gmail.com` | `suporte@hubrity.com.br` | copy/data |
| F7 | Footer copyright | "© 2026 Hubrity. Feito para psicólogos autônomos brasileiros." | adds "Dados armazenados no Brasil." | copy |
| C1 | Cookie `132:2` | title "Cookies por aqui" | no title | missing element |
| C2 | Cookie `132:2` | body ends "...do site. Você escolhe." + "Saiba mais na Política de Privacidade" | body without "Você escolhe."; link "Saiba mais" | copy |
| C3 | Cookie `132:2` | "Saiba mais" link above two equal buttons | Aceitar/Recusar/Saiba mais in one row | layout |
| N1 | 404 `144:2` | h1 "Não encontramos esta página."; body "O endereço pode ter mudado..."; secondary CTA left, primary right | h1 "Página não encontrada"; different body; primary first | copy + order |
| L1 | Legal `142:2`/`143:2` | no review notice | `LegalReviewNotice` info banner at top | extra element |

**Not a divergence (verified, do not change):** footer background is neutral
dark ink in both Figma and code; header logo/nav/CTA structure matches; "404"
numeral uses `brand/600` in both.

## Goals / Non-Goals

**Goals:**

- Bring header, footer, cookie banner, legal pages, and 404 into pixel/copy
  fidelity with their live Figma frames.
- Remove the in-UI theme toggle; dark mode follows `prefers-color-scheme`.
- Add a Logo primitive tone for dark surfaces (tricolor symbol + light wordmark).
- Retire the handoff doc so the drift does not recur.
- Keep every accessibility (WCAG 2.1 AA) and LGPD/auth-gating guarantee intact.

**Non-Goals:**

- The homepage body and `/precos` page (separate in-progress changes
  `public-homepage` / `public-pricing-page`). This change only touches chrome +
  legal + 404 already shipped by the foundation.
- Any route, middleware classification, Server Action, DB, or RLS change.
- Rewriting the legal copy itself (only the review-notice decision is in scope).

## Decisions

- **D1 — Remove the theme toggle entirely (H1).** The Figma header has no theme
  control; dark mode is driven by the OS `prefers-color-scheme`. Remove
  `<ThemeToggle/>` from the header (desktop + mobile), delete `theme-toggle.tsx`,
  and reduce `theme-provider.tsx` to the no-flash `prefers-color-scheme`
  application (drop the persisted/`localStorage` toggle path). _Alternatives:_
  move the toggle to the footer (rejected — not in the design and adds chrome the
  DS did not ask for); keep it (rejected — diverges from the source of truth).
  This reverts the `design-system-foundation` requirement the foundation changed.

- **D1b — Header nav grouping + "Entrar" button style (H2, H3).** Group the nav
  links ("Funcionalidades", "Preços") with the CTAs in a single right-aligned
  cluster (logo left, everything else right), instead of letting `justify-between`
  push the nav to the center. Render "Entrar" with the DS **secondary** (bordered)
  button variant — matching both the Figma `Button/secondary` layer and the
  existing `public-navigation` spec wording ("a secondary 'Entrar' button"); the
  current `variant="ghost"` is wrong on both counts. Apply the secondary variant
  to the mobile menu's "Entrar" too, for consistency. Verify the exact
  border/fill against the frame (DS `secondary` vs `outline`).

- **D2 — Footer layout/heading/logo follow Figma (F1, F2, F3).** Two-block
  layout: brand+tagline left, a right-aligned cluster of Produto / Legal /
  Contato. Column headings use the DS caption style (uppercase, tertiary text).
  The brand lockup uses the new dark-surface tone (D9), not `tone="white"`.

- **D3 — Remove the footer "LGPD" link (F4).** The Figma Legal column lists only
  Privacidade and Termos. The LGPD content still lives in the privacy page (the
  `#lgpd` anchor remains), so no information is lost — only the redundant footer
  shortcut is dropped. Low LGPD risk: transparency is preserved on the privacy
  page itself.

- **D4 — Footer tagline + copyright copy follow Figma (F5, F7).** Use the exact
  Figma strings. The removed "Dados armazenados no Brasil." sentence is a
  marketing claim, not a legal disclosure — the data-residency commitment remains
  stated in the privacy policy (sa-east-1). No compliance text is lost.

- **D5 — Contact email follows Figma: `hubrity.platform@gmail.com` (F6).**
  _Resolved with the user 2026-06-19._ Replace `suporte@hubrity.com.br` with the
  Figma address in every occurrence: `SUPPORT_EMAIL` (`public-footer.tsx`),
  `PRICING_SUPPORT_EMAIL` (`plans.ts`), and the privacy/terms DPO-contact section
  if it surfaces an address. Update the two tests that assert the old address.
  _Trade-off accepted by the user:_ a `@gmail` production/DPO contact is less
  formal than on-domain, but the design is the source of truth here.

- **D6 — Cookie banner gets the title, full body, and two-button layout (C1, C2,
  C3).** Add the "Cookies por aqui" title; restore "Você escolhe." to the body;
  the link reads "Saiba mais na Política de Privacidade" and sits above the
  `Aceitar` / `Recusar` button row. Consent behavior, the `cookie_consent`
  cookie, and analytics gating are unchanged — visual-only.

- **D7 — 404 copy + CTA order follow Figma (N1).** h1 "Não encontramos esta
  página.", the Figma body string, and CTA order secondary ("Voltar para a
  homepage") then primary ("Criar conta grátis") to match the visual left→right.
  Keep one `<h1>` per page.

- **D8 — Remove the legal-review notice now (L1).** _Resolved with the user
  2026-06-19._ Delete `LegalReviewNotice` from both legal pages, remove its
  barrel export and the component file, and drop the "REFERENCE text" doc-comment
  references. Update tests asserting the notice. _Trade-off accepted by the user:_
  the legal copy is still a placeholder draft, so without the notice the page
  reads as if vetted — accepted in favor of Figma fidelity. (If the legal copy is
  not signed off before launch, that is tracked outside this change.)

- **D9 — Add a dark-surface Logo tone (F3).** The primitive only has
  `color | white | mono`. Add a tone (e.g. `inverse`) that keeps the symbol's
  tricolor fills and renders the wordmark light (`#FAFAF9`). Brand colors come
  from `4O3POARuvEYI1BCrxbOFg2`. This is the cleanest fix and benefits every
  future dark-surface logo use. _Alternative:_ compose `variant="symbol"` (color)
  + `variant="wordmark-text"` (light) at the footer call site (rejected — leaks
  lockup spacing logic into the consumer and is not reusable).

- **D10 — Delete the handoff doc.** Remove `public-pages-handoff.md` entirely
  (it is obsolete and drove the drift); the live Figma + this design are the
  source of truth going forward.

- **AA gate (cross-cutting).** Every color/size taken from Figma is checked for
  WCAG 2.1 AA contrast on both light and dark surfaces. If a Figma value fails,
  flag it in the task rather than silently keeping the old value — replicate the
  design but never regress accessibility.

## Risks / Trade-offs

- **Removing the theme toggle removes the only manual dark-mode control** → users
  on a light-OS who preferred the dark site lose it. Mitigation: this matches the
  design intent; `prefers-color-scheme` covers the majority case; the toggle can
  be re-introduced later as a deliberate DS addition if product wants it.
- **Deleting `theme-toggle.tsx` / trimming `theme-provider.tsx` may break imports
  and tests** → Mitigation: grep all references; update the `marketing` barrel
  and any unit/integration tests asserting the toggle before deleting.
- **Footer/cookie/404 integration tests assert old copy and link counts** →
  Mitigation: update assertions in the same change (Legal column 3→2 links, no
  toggle control, new cookie title/copy). The `(public)` negative-auth gating
  tests must keep passing untouched.
- **Figma copy may be a placeholder** (the `@gmail` contact; the legal copy with
  the review notice removed) → the user explicitly accepted both (D5, D8) as
  follow-the-design decisions on 2026-06-19. If the legal text is not signed off
  before launch, that is a launch-readiness item tracked outside this change.
- **New Logo `inverse` tone could mis-render in light/`mono` contexts** →
  Mitigation: unit-test each tone's rendered fills; the new tone is additive and
  does not touch existing tones.

## Migration Plan

Pure front-end, no data migration. Deploy is a standard release; rollback is a
revert (no schema/state change). Suggested sequence: D9 (Logo tone) → footer →
header (toggle removal + provider trim) → cookie → 404 → legal notice → retire
handoff → update tests. No feature flag needed (visual-only, public surfaces).

## Open Questions

None — F6 (email → follow Figma `hubrity.platform@gmail.com`) and L1 (remove the
legal-review notice now) were resolved with the user on 2026-06-19; see decisions
D5 and D8.
