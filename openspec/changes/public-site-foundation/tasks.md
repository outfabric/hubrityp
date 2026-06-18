> [!IMPORTANT]
> **MANDATORY — design fidelity (read before implementing any UI task in this change).**
> The final screens are designed in Figma and are the **visual source of truth**. You MUST open and **strictly follow** them — layout, tokens (color / spacing / radius / typography), spacing, states, and responsive behavior — for every UI surface here (header, footer, cookie banner, legal pages, 404, theme toggle). Do not improvise visuals or invent values not backed by DS tokens.
> - **File:** Hubrity Design System — `https://www.figma.com/design/HoLOEqq9PXlo6IwLkz3FQ9/Hubrity-Design-System` (file key `HoLOEqq9PXlo6IwLkz3FQ9`).
> - **Pages / nodes for this change:** header inside `Public · Homepage` (desktop `105:2`, mobile `133:2`); Footer (`126:7`); `Public · Library` → cookie banner (`132:2`); `Public · Legal & 404` → Privacidade (`142:2`), Termos (`143:2`), 404 (`144:2`).
> - **How:** use the **Figma MCP** (`get_design_context`, `get_screenshot`, `get_metadata`, `get_variable_defs`) to inspect each frame and pull exact tokens **before and during** implementation. Complement (do not replace) with `docs/design-system/public-pages-handoff.md` and `docs/design-system/rules.md`.
> - **Precedence:** on any conflict, the **Figma screens prevail on visual form**; this change's specs + PRD 14 prevail on business rules and content.

## 1. Marketing module scaffold + env

- [x] 1.1 Create `src/modules/marketing/` with `index.ts` barrel (public API) and internal `components/`, `lib/`, `server/` folders per the project module convention.
- [x] 1.2 Add env config: `NEXT_PUBLIC_SITE_URL` (absolute base, validated `z.string().url()`) and optional analytics vars (`NEXT_PUBLIC_ANALYTICS_HOST`, `NEXT_PUBLIC_ANALYTICS_SITE_ID`/domain — optional) to `src/shared/env/client-schema.ts` and `src/shared/env/client.ts`. Analytics is a no-op when unset.
- [x] 1.3 Add a `siteUrl()` / `absoluteUrl(path)` helper in `marketing/lib/site.ts` deriving absolute URLs from `clientEnv.NEXT_PUBLIC_SITE_URL`.
- [x] 1.4 Unit test `absoluteUrl()` (env-driven base, trailing-slash handling, path joining) — `src/__tests__/unit/modules/marketing/site.test.ts`.

## 2. Marketing typography tokens + Nunito wordmark

- [x] 2.1 Add `Display/xl|lg|md` and `Lead` tokens to `src/app/globals.css` (CSS custom properties) and expose Tailwind utilities in `tailwind.config.ts` (Inter, weights 400/600 only).
- [x] 2.2 Load `Nunito` via `next/font/google` (self-hosted) in `src/app/layout.tsx`, expose `--ds-font-wordmark`; scope it to the wordmark only.
- [x] 2.3 Document the marketing type scale + Nunito wordmark in `docs/design-system/rules.md`.
- [x] 2.4 Update the `Logo` component (or wordmark variant) to use the Nunito wordmark variable.
- [x] 2.5 Unit test: marketing type utilities resolve to token-backed values and weight is 400/600; wordmark uses the Nunito variable — `src/__tests__/unit/modules/marketing/typography.test.ts` (or extend the brand-logo unit test).

## 3. Dark-mode toggle (no-flash, OS-aware, persisted)

- [x] 3.1 Add a no-flash inline theme-resolution script to `src/app/layout.tsx` `<head>` (reads `theme` cookie → else `prefers-color-scheme` → light; sets `data-theme` before first paint).
- [x] 3.2 Implement a `ThemeProvider` + `useTheme` (client) and a `ThemeToggle` leaf in `marketing/components/` that persists the choice to the `theme` cookie (`SameSite=Lax`) and updates `data-theme`.
- [x] 3.3 Unit test theme resolution logic (stored choice > OS > light) and the toggle's `aria-pressed`/keyboard behavior — `src/__tests__/unit/modules/marketing/theme.test.ts`.
- [x] 3.4 Integration test: with a `theme=dark` cookie, SSR output applies `data-theme='dark'` with no light-flash (no-flash script present) — `src/__tests__/integration/marketing/theme-no-flash.int.test.ts`.

## 4. Public route group, layout, landmarks, 404

- [x] 4.1 Create `src/app/(public)/layout.tsx` (Server Component): header + single `<main id="conteudo">` + footer; skip link as first focusable element; reusable container (1200px / 720px reading variant, responsive padding) via `marketing/components`.
- [x] 4.2 Move the placeholder `src/app/page.tsx` into `(public)` (interim minimal `<main>` placeholder; homepage body ships in `public-homepage`).
- [x] 4.3 Create `src/app/(public)/not-found.tsx` (404: large `brand/600` "404", message, "Voltar para a homepage" → `/`, "Criar conta grátis" → `/signup`).
- [x] 4.4 Unit test the container width/padding variants and skip-link target — `src/__tests__/unit/modules/marketing/container.test.ts`.
- [x] 4.5 Integration test: `(public)` layout renders exactly one banner/main/contentinfo landmark in order; authenticated render leaks no PII (no email/id/CRP in HTML) — `src/__tests__/integration/marketing/public-layout.int.test.ts`.

## 5. Middleware public route gating

- [x] 5.1 Extend `classifyPath()` in `src/middleware.ts` to explicitly classify `/` (exact), `/precos`, `/politica-de-privacidade`, `/termos-de-uso` as `public`; keep 404 default-public. Use exact/prefix-with-separator semantics (no substring false matches).
- [x] 5.2 Integration (negative/positive auth) test: anonymous, pending, active, active+rpr, suspended/cancelled all `pass` on each public route; active user is NOT redirected from `/`; near-miss `/precos-internos` not falsely matched — `src/__tests__/integration/middleware/public-routes-gating.int.test.ts`.

## 6. Public header

- [x] 6.1 Implement the sticky header (`marketing/components/public-header.tsx`): logo → `/`, "Funcionalidades" (`/#funcionalidades` / anchor), "Preços" → `/precos`, "Entrar" → `/login`, "Começar grátis" → `/signup`; heights 72/60.
- [x] 6.2 Implement the scrolled solid-opaque state (`bg/surface` + `border/subtle` + `Shadow/Light/xs`, NO backdrop-blur) as a client behavior.
- [x] 6.3 Implement the mobile hamburger (ARIA `aria-expanded`/`aria-controls`, Escape-to-close, focus trap, ≥44px targets, persistent "Começar grátis", `<noscript>` inline-links fallback).
- [x] 6.4 Implement the authenticated-visitor variant (server boolean via `supabase.auth.getUser()`; "Acessar plataforma" → `/dashboard`; no PII rendered; no redirect).
- [x] 6.5 Unit test header link destinations, scrolled-state class (no `backdrop-filter`), hamburger ARIA + Escape, and anon-vs-auth CTA swap — `src/__tests__/unit/modules/marketing/public-header.test.tsx`.
- [x] 6.6 Integration test: authenticated request → "Acessar plataforma" and no `/dashboard` redirect; anonymous → "Entrar"/"Começar grátis"; served HTML carries no PII — `src/__tests__/integration/marketing/public-header.int.test.ts`.

## 7. Public footer

- [x] 7.1 Implement the footer (`marketing/components/public-footer.tsx`, dark surface): brand + tagline, Produto/Legal/Contato columns, copyright; legal links → `/politica-de-privacidade`, `/termos-de-uso`, `#lgpd`; `mailto:` support email. Export for app reuse.
- [x] 7.2 Unit test footer link destinations + single `contentinfo` landmark + column headings — `src/__tests__/unit/modules/marketing/public-footer.test.tsx`.

## 8. Cookie consent + analytics gating

- [x] 8.1 Implement the consent banner leaf (`marketing/components/cookie-consent.tsx`): shows only when no `cookie_consent` cookie; "Aceitar"/"Recusar"/"Saiba mais" → `/politica-de-privacidade`; persists `cookie_consent` (`SameSite=Lax; Secure; Max-Age=12mo; Path=/`); dismiss without reload.
- [x] 8.2 Implement the consent-gated analytics loader leaf: injects the provider script only when `cookie_consent=accepted` AND analytics host configured; no-op otherwise; deferred (non-blocking).
- [x] 8.3 Implement UTM preservation for `/signup` CTAs (opaque values, no PII logging).
- [x] 8.4 Unit test: banner visibility by cookie state; consent writes correct cookie attributes; analytics loader no-ops without consent/host; UTM forwarding — `src/__tests__/unit/modules/marketing/cookie-consent.test.tsx`.
- [x] 8.5 Integration test: no analytics script/network before consent; after `accepted` + host configured, script loads from the allowlisted host — `src/__tests__/integration/marketing/analytics-consent.int.test.ts`.

## 9. Legal pages

- [x] 9.1 Implement `src/app/(public)/politica-de-privacidade/page.tsx` (720px reading column, ≥8 sections incl. `#lgpd` and cookies, `info/50` legal-review notice, unique SEO metadata).
- [x] 9.2 Implement `src/app/(public)/termos-de-uso/page.tsx` (≥8 sections: elegibilidade CRP, planos, cancelamento, IP, responsabilidade, lei aplicável/CDC, legal-review notice, unique SEO metadata).
- [x] 9.3 Integration test: both routes return 200 anonymously (no login redirect), render reading-column + required sections/anchors + legal-review notice — `src/__tests__/integration/marketing/legal-pages.int.test.ts`.

## 10. SEO infrastructure

- [x] 10.1 Implement `buildPageMetadata()` in `marketing/lib/seo.ts` (unique title/description, canonical, OG + Twitter, absolute URLs via `metadataBase`).
- [x] 10.2 Set root `metadata` in `src/app/layout.tsx`: `metadataBase` from `NEXT_PUBLIC_SITE_URL`, default OG (site name, `pt_BR`, `website`, default image). Ship the default OG image (≥1200×630) under `public/`.
- [x] 10.3 Implement `src/app/sitemap.ts` (public indexable routes, absolute URLs) and `src/app/robots.ts` (allow public, disallow `/dashboard`, `/agenda`, `/pacientes`, `/caixa-de-entrada`, `/configuracoes`, `/onboarding`, `/sessao`, `/api`; `Sitemap:` line).
- [x] 10.4 Extend `next.config.ts` CSP: add the analytics host to `script-src`/`connect-src` only when configured (no wildcard; baseline unchanged when unset).
- [x] 10.5 Unit test `buildPageMetadata()` (distinct titles/canonicals per page; absolute OG urls) — `src/__tests__/unit/modules/marketing/seo.test.ts`.
- [x] 10.6 Integration test: `/sitemap.xml` lists public routes only; `/robots.txt` disallows authenticated prefixes + has `Sitemap:`; CSP includes analytics host only when configured — `src/__tests__/integration/marketing/seo-sitemap-robots.int.test.ts`.

## 11. Subscription plans configuration

- [x] 11.1 Implement `marketing/lib/plans.ts`: Zod-validated plans (`essencial` R$60/6000c, `avancado` R$90/9000c "Mais popular"), branded `PlanSlug`, integer cents, feature matrix; types via `z.infer`; exported from the module barrel.
- [x] 11.2 Add the empty-plans fallback helper (contact + support email) consumed by pricing surfaces.
- [x] 11.3 Unit test: config validates; exactly 2 plans; Essencial⊂Avançado with only WhatsApp + IA exclusive to Avançado; no post-MVP feature marked available; empty-plans fallback — `src/__tests__/unit/modules/marketing/plans.test.ts`.

## 12. E2E (foundation flows)

- [x] 12.1 E2E (seeded): anonymous visit to `/` returns 200 (not redirected to login); header shows "Entrar"/"Começar grátis"; footer legal links navigate to `/politica-de-privacidade` and `/termos-de-uso` (both 200); 404 page renders for an unknown path with both CTAs — `src/__tests__/e2e/seeded/public/public-shell.spec.ts`.
- [x] 12.2 E2E (seeded): cookie banner appears on first visit, "Aceitar" dismisses it and sets `cookie_consent`, and it does not reappear after navigation; no analytics request before consent — same/sibling spec.
- [x] 12.3 E2E (seeded): authenticated user sees "Acessar plataforma" on `/` and is not redirected (reuse a seeded active user) — same/sibling spec.

## 13. Design-fidelity QA

- [x] 13.1 Compare each implemented UI surface against its Figma frame via the Figma MCP (`get_screenshot`/`get_design_context`): header (`105:2`/`133:2`), footer (`126:7`), cookie banner (`132:2`), legal pages (`142:2`/`143:2`), 404 (`144:2`). Verify tokens, spacing, radius, typography, states, dark mode, and responsive behavior match the screens; record any intentional deviation and its reason.
