## Why

The MVP is feature-complete but has **no public presence**: a psychologist who discovers the product lands directly on `/login`, with zero value communication, and closes the tab. PRD 14 requires public marketing pages (homepage, pricing, legal) to convert visitors into trial sign-ups. This change builds the **shared foundation** every public page depends on — route group + layout, public route gating, navigation (header/footer), dark-mode toggle, marketing typography, LGPD cookie consent + analytics gating, legal pages, the 404 page, SEO infrastructure, and a central plans configuration. The homepage (`public-homepage`) and pricing page (`public-pricing-page`) changes build on top of this.

## What Changes

- **New `(public)` route group** with a shared marketing layout (header + footer + `<main>` landmark + skip link). The current placeholder root `/` page is replaced by this layout (the homepage body itself ships in `public-homepage`).
- **Explicit public route classification in `src/middleware.ts`** (`classifyPath()`): `/`, `/precos`, `/politica-de-privacidade`, `/termos-de-uso`, and the catch-all 404 are classified `public` and pass for every session state. **Authenticated visitors are NOT redirected** away from marketing pages (edge case: header swaps CTAs for "Acessar plataforma").
- **Sticky public header**: logo, nav anchors ("Funcionalidades", "Preços"), "Entrar" + "Começar grátis" CTAs; solid opaque background on scroll (no backdrop-blur); mobile hamburger; authenticated-visitor variant.
- **Public footer** (dark surface): brand + tagline, Produto / Legal / Contato columns, copyright. Reusable in the authenticated app.
- **Dark-mode toggle**: replaces the current "no UI toggle" substrate with a persisted, `prefers-color-scheme`-aware theme toggle (no-flash SSR), driving `data-theme` — consumed by all public and app surfaces. **BREAKING** for the `design-system-foundation` requirement "Dark mode substrate is wired without a UI toggle".
- **Marketing typography tokens** (`Display/xl|lg|md`, `Lead`) added to `globals.css`/Tailwind, plus the **Nunito** wordmark font (via `next/font`) — both are DS extensions required to reproduce the Figma hero.
- **Cookie consent banner (LGPD)**: first-visit banner, `Aceitar`/`Recusar`, "Saiba mais" → privacy page; persists `cookie_consent`; **analytics loads only after consent** (consent-gated, cookieless-friendly loader).
- **Legal pages**: `/politica-de-privacidade` and `/termos-de-uso` (reading column, 8 sections each, "revisar com jurídico" notice) — prerequisites for the cookie banner and signup.
- **Public 404** (`not-found.tsx`) consistent with the DS, with "Voltar para a homepage" + "Criar conta grátis" CTAs.
- **SEO infrastructure**: per-page metadata helper (title/description/canonical/Open Graph), `app/sitemap.ts`, `app/robots.ts`, default OG image, and CSP allowance for the consent-gated analytics host.
- **Central plans configuration**: `subscription-plans-config` constants (names, prices, feature composition) with Zod validation and branded types — consumed by both the homepage pricing summary and `/precos`.

## Capabilities

### New Capabilities

- `public-site-shell`: The `(public)` route group, shared marketing layout, ARIA landmarks, skip link, content-width conventions, and the public 404 page.
- `public-navigation`: The sticky public header (scrolled/mobile/authenticated-visitor states) and the public footer.
- `cookie-consent`: First-visit LGPD consent banner, `cookie_consent` persistence, and consent-gated analytics loading.
- `public-legal-pages`: Política de Privacidade and Termos de Uso pages.
- `public-seo`: Per-page metadata, Open Graph, canonical, `sitemap.xml`, and `robots.txt`.
- `subscription-plans-config`: Central, validated configuration of plan names, prices, and feature composition.

### Modified Capabilities

- `middleware-gating`: Add explicit `public` classification for the marketing/legal/404 routes and assert authenticated visitors pass through marketing pages without redirect.
- `design-system-foundation`: Replace the "no UI toggle" dark-mode requirement with a persisted, `prefers-color-scheme`-aware toggle; add marketing typography tokens and the Nunito wordmark font.
- `app-shell`: Extend the security-headers requirement so the CSP permits the consent-gated analytics host; extend the root-layout metadata requirement with site-wide Open Graph / metadataBase defaults and the theme-toggle no-flash script.

## Impact

- **Code**: `src/middleware.ts`; `src/app/page.tsx` (replaced), `src/app/layout.tsx`, `src/app/globals.css`, `tailwind.config.ts`; new `src/app/(public)/**` (layout, legal pages, `not-found.tsx`), `src/app/sitemap.ts`, `src/app/robots.ts`; new module `src/modules/marketing/**` (header, footer, cookie-consent, theme-toggle, plans config, SEO helpers) exposed via a barrel.
- **Dependencies**: `next/font/google` Nunito (no new npm dep); analytics provider is configured via env (no hard dependency added in this change — the loader is provider-agnostic and disabled when unset).
- **Env**: new `NEXT_PUBLIC_ANALYTICS_*` client vars (validated in `src/shared/env/client-schema.ts`) — optional; analytics is a no-op when unset.
- **Security/LGPD**: all routes are public-by-design; the threat surface is "must NOT leak the authenticated app or PII". CSP changes are additive and host-allowlisted. Analytics is consent-gated and cookieless-by-default; any analytics provider that exports data outside `sa-east-1` requires a documented legal basis (tracked as an open question).
- **No database changes, no RLS changes** — there are no new tables in this change.
