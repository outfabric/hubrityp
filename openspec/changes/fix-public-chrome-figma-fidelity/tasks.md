# Tasks — fix-public-chrome-figma-fidelity

> Source of truth is the **live Figma** (pull each frame via the Figma MCP — no
> external references are provided). DS "Sálvia" `HoLOEqq9PXlo6IwLkz3FQ9`: header
> `128:3`, footer `131:32`, cookie `132:2`, privacy `142:2`, terms `143:2`, 404
> `144:2`. Brand "Marca/Escuta" `4O3POARuvEYI1BCrxbOFg2`: symbol `16:7`, lockup-h
> `17:2`. Every value taken from Figma is checked for WCAG 2.1 AA contrast; flag
> (do not silently revert) any value that fails.

## 1. Logo dark-surface tone (DS primitive)

- [ ] 1.1 Add a dark-surface tone to `src/shared/ui/logo.tsx` (e.g. `tone="inverse"`) that keeps the symbol's tricolor fills (sage / slate-blue / teal, per brand `16:7`/`17:2`) and renders the "hubrity" wordmark light (`#FAFAF9`); leave `color`/`white`/`mono` untouched.
- [ ] 1.2 Unit test `src/__tests__/unit/shared/ui/logo.test.tsx`: the new tone renders a tricolor symbol + light wordmark, and `color`/`white`/`mono` keep their prior output.

## 2. Footer fidelity (frame `131:32`)

- [ ] 2.1 Rework `src/modules/marketing/components/public-footer.tsx`: brand block left + Produto/Legal/Contato columns clustered right; column headings in uppercase tertiary caption style; render the brand lockup with the new dark-surface tone (not `tone="white"`).
- [ ] 2.2 Apply the Figma copy: tagline "O sistema único para o consultório de psicólogos autônomos no Brasil."; copyright "© 2026 Hubrity. Feito para psicólogos autônomos brasileiros." (drop "Dados armazenados no Brasil."); remove the standalone "LGPD" link from the Legal column (keep only Privacidade + Termos).
- [ ] 2.3 Set the contact email to `hubrity.platform@gmail.com` in `public-footer.tsx` (`SUPPORT_EMAIL`) and in `src/modules/marketing/lib/plans.ts` (`PRICING_SUPPORT_EMAIL`).
- [ ] 2.4 Update tests `src/__tests__/unit/modules/marketing/public-footer.test.tsx` and `src/__tests__/integration/marketing/public-layout.int.test.ts`: Legal column has exactly 2 links (no LGPD), new tagline/copyright/email, contentinfo landmark intact.

## 3. Header fidelity (frame `128:3`)

- [ ] 3.1 Remove `<ThemeToggle/>` from `src/modules/marketing/components/public-header-client.tsx` (desktop cluster + mobile cluster); keep the ≥44px touch targets and mobile layout balanced without it.
- [ ] 3.2 Delete `src/modules/marketing/components/theme-toggle.tsx`; reduce/remove `theme-provider.tsx` so dark mode is driven only by `prefers-color-scheme` (no persisted/`localStorage` choice); drop the now-unused exports from `src/modules/marketing/index.ts` and unwrap `ThemeProvider` in `src/app/(public)/layout.tsx` if it no longer carries state.
- [ ] 3.3 Update the no-flash inline script in the root layout / `globals.css` to resolve the theme from `prefers-color-scheme` only (remove any stored-preference branch).
- [ ] 3.4 Regroup the desktop header so the logo stays at the left edge and the nav links ("Funcionalidades", "Preços") sit in the SAME right-aligned cluster as the "Entrar"/"Começar grátis" buttons (stop using `justify-between` to center-spread the nav); match the Figma spacing/alignment of `128:3`.
- [ ] 3.5 Change "Entrar" from `variant="ghost"` to the DS **secondary** (bordered) button variant in both the desktop bar and the mobile menu; verify the exact border/fill against frame `128:3` (DS `secondary` vs `outline`).
- [ ] 3.6 Delete `src/__tests__/unit/modules/marketing/theme-toggle.test.tsx`; update `public-header.test.tsx` and `src/__tests__/integration/marketing/public-header.int.test.ts` to assert: no theme-toggle control; nav links grouped with the CTAs in the right cluster; "Entrar" rendered as the secondary bordered button.

## 4. Cookie banner fidelity (frame `132:2`)

- [ ] 4.1 Update `src/modules/marketing/components/cookie-consent.tsx`: add the title "Cookies por aqui"; set body to "Usamos cookies para melhorar sua experiência e medir o desempenho do site. Você escolhe."; render "Saiba mais na Política de Privacidade" as a link above an `Aceitar` (primary) / `Recusar` (secondary) button row. Keep the consent cookie + analytics-gating behavior unchanged.
- [ ] 4.2 Update `src/__tests__/unit/modules/marketing/cookie-consent.test.tsx` for the title, new body, and link text; keep the show/hide-by-cookie assertions.

## 5. Legal pages — remove the review notice (frames `142:2` / `143:2`)

- [ ] 5.1 Remove `<LegalReviewNotice/>` from `src/app/(public)/politica-de-privacidade/page.tsx` and `src/app/(public)/termos-de-uso/page.tsx`; drop the `LegalReviewNotice` export from `src/modules/marketing/index.ts`; delete `src/modules/marketing/components/legal-review-notice.tsx`; clean the "REFERENCE text (see LegalReviewNotice)" doc-comments.
- [ ] 5.2 If the privacy/terms DPO-contact section surfaces a support email, align it to `hubrity.platform@gmail.com`.
- [ ] 5.3 Update any test asserting the legal-review notice (e.g. `src/__tests__/e2e/seeded/public/public-shell.spec.ts` and marketing integration tests) to assert it is absent.

## 6. 404 fidelity (frame `144:2`)

- [ ] 6.1 Update `src/app/(public)/not-found.tsx`: h1 "Não encontramos esta página."; body "O endereço pode ter mudado ou não existe mais. Vamos te levar de volta ao começo."; CTA order secondary "Voltar para a homepage" → `/` then primary "Criar conta grátis" → `/signup`; keep the "404" numeral in `brand/600` and a single `<h1>`.
- [ ] 6.2 Update the 404 assertions in `src/__tests__/e2e/seeded/public/public-shell.spec.ts` (headline + CTA copy/order).


