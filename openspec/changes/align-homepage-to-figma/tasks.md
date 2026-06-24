# Tasks — align-homepage-to-figma

Each section task pairs implementation (desktop + mobile parity to its Figma frame)
with its test, and ends with the **verifiable acceptance criterion**: bring up the
app (`docker compose up`) and, at the frame's real width (1440 desktop / 375
mobile), capture a runtime screenshot **via the playwright-cli skill**, confront it
with the Figma frame, and diff `getComputedStyle` of the changed elements against
the section's `get_variable_defs` values. Token source of truth: file
`HoLOEqq9PXlo6IwLkz3FQ9`.

All five decisions are RESOLVED (2026-06-23, see design.md "Resolved Decisions"):
copy realigned to Figma; mobile condensed variants implemented; Preços link kept on
both breakpoints; Solução closer hidden on mobile; FAQ mobile frame is `138:2`.

## 1. Prep (content model + token audit)

- [x] 1.1 Audit every `var(--ds-*)` and type token read from the 17 frames against `src/app/globals.css` / Tailwind theme; produce a token-map note. Any frame token with no matching DS token is FLAGGED (not hardcoded). (design D3)
- [x] 1.2 Extend `home-content.ts` types to carry optional `mobile` copy overrides only on fields Figma condenses (helper or `{ desktop; mobile? }` shape), keeping the module pure/typed. (design D2 — confirmed)
- [x] 1.3 Add curated Preços per-card summary bullets + taglines to `PRICING_SUMMARY` in `home-content.ts` (price/name/badge stay sourced from `plans.ts`). (design D4)

## 2. Hero (desktop 108:2 / mobile 133:14)

- [x] 2.1 Update `HERO` copy to the Figma strings (desktop headline/subheadline/microcopy) and, if Q1 approved, the condensed mobile variants. (design D1/D2)
- [x] 2.2 Restructure `hero.tsx` to a SINGLE CENTERED COLUMN (remove the current `lg:flex-row` two-column / `lg:text-left` layout): copy block centered at top, carousel BELOW it. Reposition `ScreenshotCarousel` from the right-hand visual column to a full-content-width centered block under the copy (desktop ≈1160px, mobile 343px), preserving the first-slide LCP `priority`. Slide content/order unchanged.
- [x] 2.3 Align the copy block tokens: badge pill (`Label/caption`, brand accent, `radius-full`); headline `Display/xl` desktop / `Display/md` mobile; subheadline `Lead` / `Body/lg`; CTAs side-by-side centered desktop (244×48 / 200×48) vs full-width stacked mobile (343×48); microcopy.
- [x] 2.4 Update unit coverage (`home-content.test.ts` + any hero render test) for the new copy, the desktop/mobile variant rendering (`aria-hidden` on the inactive variant), and the carousel-below-copy single-column layout (no two-column arrangement).
- [x] 2.5 Acceptance: runtime screenshot + token diff at 1440 (vs `108:2`) and 375 (vs `133:14`), explicitly confirming the carousel sits BELOW a centered copy block (not beside it); CTAs preserve UTMs → `/signup`; "Ver funcionalidades" → `#funcionalidades`.

## 3. Prova social (desktop 113:2 / mobile 135:2)

- [x] 3.1 Rework `SOCIAL_PROOF_STATS` into two figure+caption stat blocks ("até 5h/semana" / "40–60%" + captions); no fabricated testimonials. (design D1)
- [x] 3.2 Align `prova-social.tsx`: figures `Display/md` (`text-primary`), captions `Body/base` (`text-secondary`); side-by-side with 1px `border-strong` divider on `surface-muted` desktop, stacked no-divider mobile.
- [x] 3.3 Update unit coverage for the two stat blocks (figure + caption) and the no-testimonial invariant.
- [x] 3.4 Acceptance: runtime screenshot + token diff at 1440 (vs `113:2`) and 375 (vs `135:2`).

## 4. Problema (desktop 114:2 / mobile 135:9)

- [ ] 4.1 Update `PROBLEM` items to the Figma desktop strings + (Q1) condensed mobile strings; keep exactly 5 items + recognition closer. (design D1/D2)
- [ ] 4.2 Align `problema.tsx`: title `Display/lg`; 5 rows each an icon chip (40×40 desktop / 36×36 mobile) + one-line label; closer line.
- [ ] 4.3 Update unit coverage for the 5 items (desktop + mobile variants) and the closer.
- [ ] 4.4 Acceptance: runtime screenshot + token diff at 1440 (vs `114:2`) and 375 (vs `135:9`).

## 5. Solução (desktop 116:2 / mobile 135:42)

- [ ] 5.1 Update `SOLUTION_STEPS` titles/descriptions to the Figma copy; add desktop "PASSO 0N" markers and (Q1) the condensed mobile step copy + inline "N." numbering. (design D1/D2)
- [ ] 5.2 Align `solucao-timeline.tsx`: horizontal 6-column flow desktop (markers `Label/caption-upper` ls6, icon chip `brand-700`/`brand-50` `radius-lg`, title, one-line) + title `Display/lg` & `Lead` subtitle; vertical stacked mobile with inline numbering; preserve scroll fade-in.
- [ ] 5.3 Hide the "De ponta a ponta — sem sair do sistema." closer on mobile (`hidden md:block`); keep on desktop. (confirmed)
- [ ] 5.4 Update unit coverage for 6 steps, markers/numbering per breakpoint, and the closer-visibility rule.
- [ ] 5.5 Acceptance: runtime screenshot + token diff at 1440 (vs `116:2`) and 375 (vs `135:42`).

## 6. Confiança (desktop 123:2 / mobile 137:2)

- [ ] 6.1 Update `TRUST` to the Figma guarantee strings (exact codes preserved) + (Q1) mobile-condensed items 6 & 8; add the "CONFORMIDADE & SEGURANÇA" eyebrow. (design D1/D2)
- [ ] 6.2 Align `confianca.tsx`: eyebrow `Label/caption-upper` `brand-700`; title `Display/md`; 8-guarantee panel (`surface`, `radius-2xl`, `border`, `Shadow/Light/xs`) 2-col desktop / 1-col mobile; checks `brand-700`; closer line.
- [ ] 6.3 Update `home-content.test.ts` keeping the regulatory-code assertions (001/2009, 06/2019, 09/2024, 13/2022, AES-256, TLS 1.3, 13.787/2018, CRP ativo) and MVP denylist green.
- [ ] 6.4 Acceptance: runtime screenshot + token diff at 1440 (vs `123:2`) and 375 (vs `137:2`); assert all 8 literal codes present.

## 7. Preços resumo (desktop 124:2 / mobile 137:47)

- [ ] 7.1 Align `precos-resumo.tsx`: "PLANOS" eyebrow + title `Display/lg`; 2 cards (`surface`, `radius-2xl`, `border`) with name (`Heading/h3`), price + "/mês" from `plans.ts`, tagline, curated bullet list (`brand-600` checks), per-card "Começar grátis" CTA; "Mais popular" badge on Avançado; side-by-side desktop / stacked mobile.
- [ ] 7.2 Render the "Ver planos completos → /precos" link on BOTH breakpoints (confirmed — conversion path kept on mobile despite the frame omission).
- [ ] 7.3 Update unit coverage: 2 cards reflect central config (R$60/R$90, badge), curated bullets render, per-card CTA present, no annual toggle.
- [ ] 7.4 Acceptance: runtime screenshot + token diff at 1440 (vs `124:2`) and 375 (vs `137:47`).

## 8. FAQ (desktop 125:2 / mobile 138:2)

- [ ] 8.1 Add the desktop-only "PERGUNTAS FREQUENTES" eyebrow + title "Ainda em dúvida? Comece por aqui."; align the desktop Q1 answer to the verbatim `125:2` string and add the condensed mobile question/answer variants from `138:2` (Q1 answer "Servidores no Brasil (São Paulo), AES-256 e TLS 1.3. Você é a controladora; nós, operadores, conforme a LGPD."; "Funciona para presencial também?"; "A IA inventa conteúdo?"; "Quanto custa depois do teste?"); keep the 5 required questions. (design D1/D2)
- [ ] 8.2 Align `faq.tsx`/`faq-accordion.tsx`: eyebrow `Label/caption-upper` (desktop only, `hidden md:block`); title `Display/md`; items `surface`/`radius-xl`/`border`, question `Body/lg` desktop / `Body/base`–`Heading-h4` mobile, open item `brand-200` border; preserve exclusive accordion + no-JS open fallback.
- [ ] 8.3 Update unit coverage for the title, desktop-only eyebrow, the 5 questions (desktop + condensed mobile variants), exclusive accordion, and the token states per breakpoint.
- [ ] 8.4 Acceptance: runtime screenshot + token diff at 1440 (vs `125:2`) and 375 (vs `138:2`).

## 9. Footer (desktop 126:7 / mobile 138:36)

- [ ] 9.1 Align `public-footer.tsx`: dark context (`background #1c1917`); brand lockup (tricolor symbol + light "hubrity"); tagline `Body/sm` `text-secondary`; 3 columns (Produto/Legal/Contato) headings `Label/caption-upper` `text-tertiary #a8a29e`; `mailto:` contato; copyright; brand-left/columns-right desktop, fully stacked mobile; divider `border #3a3633`.
- [ ] 9.2 Fix the brand-lockup horizontal alignment (footer-local, NOT the shared `Logo` primitive): the `<Logo>` `<svg>` currently stretches to the `max-w-xs` column width and centers the mark (renders 320px box for a ~120px mark → logo shifted ~100px right of the tagline). Constrain the lockup box to its intrinsic width (e.g. `self-start w-fit` / `max-w-max`) so it is flush-left with the tagline. Do NOT change `src/shared/ui/logo.tsx` (header + app shell are unaffected).
- [ ] 9.3 Update unit/integration coverage: legal links resolve, Legal column has exactly 2 links (no LGPD link), `contentinfo` landmark, dark-surface tones per breakpoint, and the lockup is flush-left (its box width is not stretched to the column width).
- [ ] 9.4 Acceptance: runtime screenshot + token diff at 1440 (vs `126:7`) and 375 (vs `138:36`), explicitly confirming the lockup's left edge aligns with the tagline (logo not right-shifted).

