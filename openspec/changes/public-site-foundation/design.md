## Context

PRD 14 introduces the platform's first public surface. Today `src/app/page.tsx` is a placeholder logo and there is **no** public marketing layout, no theme toggle, no cookie consent, and no SEO infrastructure. The middleware (`src/middleware.ts`) already defaults unknown paths to the `public` class (pass), but CLAUDE.md requires explicit classification + tests for every new route.

The visual source of truth is the Figma Design System (`Public · *` pages) and the technical handoff `docs/design-system/public-pages-handoff.md`. The DS (Sálvia) forbids gradients, colored shadows, glassmorphism/blur/glow, >3 functional colors per screen, font weights ≥700, and emojis in UI. This change builds the shared foundation; the homepage and pricing bodies are separate changes that depend on it.

Constraints: LGPD (cookie consent before analytics, data residency in `sa-east-1`), WCAG 2.1 AA, Lighthouse mobile ≥90 / LCP <2.5s / CLS <0.1, dark mode parity with the app.

## Goals / Non-Goals

**Goals:**
- A reusable `(public)` shell (layout, header, footer, 404) that the homepage and pricing pages drop into.
- Explicit, tested public route gating that cannot regress into accidental auth gating, and that never leaks the authenticated app or PII.
- A persisted, OS-aware, no-flash dark-mode toggle reused across public + app surfaces.
- Marketing typography + Nunito wordmark as DS-compliant extensions.
- LGPD-compliant cookie consent that gates analytics; functional legal pages.
- SEO infra: per-page metadata, OG, canonical, sitemap, robots — all env-driven absolute URLs.
- A single validated plans config consumed by both pricing surfaces.

**Non-Goals:**
- The homepage section bodies and the screenshot carousel (→ `public-homepage`).
- The `/precos` page body, comparison table, billing FAQ (→ `public-pricing-page`).
- Choosing/contracting a specific analytics vendor or writing final legal copy (legal review is a stakeholder task; analytics is provider-agnostic + optional here).
- Blog, "Sobre", segmented landing pages, referral (explicitly out of PRD scope).

## Decisions

### D1 — Module location: `src/modules/marketing/`
All public-site domain code (header, footer, cookie-consent, theme-toggle, plans config, SEO helpers) lives in a new `marketing` module with a barrel (`@/modules/marketing`). Rationale: matches the project's domain-first convention (CLAUDE.md folder rules); keeps `src/app/(public)/**` thin (composition only). The footer is exported so the authenticated app can reuse it. Alternative considered: scattering components under `src/shared/ui` — rejected because these are domain compositions, not primitives, and `shared/` must not depend on app concerns.

### D2 — Route group `(public)` is organizational; gating stays in middleware
We add `/`, `/precos`, `/politica-de-privacidade`, `/termos-de-uso` to `classifyPath()` as explicit `public` returns, plus keep the default-public fallthrough for the 404. Rationale: the `(app)` route-group trap (private pages shipped public) is the exact regression class CLAUDE.md calls out; here the risk is inverted (a refactor to default-deny would gate marketing pages), so explicit classification + negative/positive tests lock the contract both ways.

### D3 — Authenticated-visitor handling without redirect or PII
The header variant is decided server-side via `supabase.auth.getUser()` (RLS-scoped, cookie-bearing), exposing only a boolean. We deliberately do NOT `getSession()` (unsafe for authz). The marketing page does not redirect authenticated users (PRD edge case — they may share the link). Only the boolean reaches the client; no id/email/CRP is rendered. This is the key security property for an otherwise public surface.

### D4 — Dark-mode toggle: cookie-persisted + no-flash inline script
Theme preference is stored in a first-party cookie (`theme`, `SameSite=Lax`) so the **server** can read it and the no-flash inline script in `<head>` can apply `data-theme` before first paint (cookie is readable both server- and client-side; avoids the localStorage-only FOUC). Resolution order: explicit stored choice → `prefers-color-scheme` → light. We hand-roll a minimal provider rather than adding `next-themes` to avoid a dependency and keep full control of the cookie/SSR path. Alternative: `next-themes` (localStorage) — rejected due to FOUC on SSR and no server visibility.

### D5 — Cookie consent + analytics gating
`cookie_consent` cookie (`accepted`/`rejected`, `SameSite=Lax; Secure`, 12-month). The banner is a client leaf reading the cookie; analytics is a separate client leaf that injects the provider script only when `cookie_consent=accepted` AND an analytics host env var is set. Provider is abstracted behind `NEXT_PUBLIC_ANALYTICS_*` env (validated in `client-schema.ts`); when unset the loader is a no-op. Default target is a cookieless provider (e.g. Plausible) to minimize LGPD exposure, but loading is still gated on consent by default. CSP gains the analytics host in `script-src`/`connect-src` only when configured.

### D6 — SEO: native Next.js metadata + `app/sitemap.ts` + `app/robots.ts`
Use the App Router metadata API (`metadata`/`generateMetadata`), `metadataBase` from an env-driven site URL, a shared `buildPageMetadata()` helper for title/description/canonical/OG. `sitemap.xml` and `robots.txt` via the file conventions. Default OG image shipped under `public/`. Rationale: framework-native, no extra deps, correct absolute URLs per environment. (Confirm exact Next.js 16 signatures via Context7 at implementation time.)

### D7 — Plans config as validated constants with branded types
`plans.ts` exports a Zod-validated array; types via `z.infer`; branded `PlanSlug` and integer cents for price. Prices stored as integer cents (6000/9000) to avoid float issues and ease future currency formatting via `Intl.NumberFormat('pt-BR')`. The Essencial⊂Avançado invariant (Avançado adds only WhatsApp + IA) is asserted by a unit test against the config, not assumed.

### D8 — Marketing typography + Nunito as token-level DS extension
Add `Display/xl|lg|md` and `Lead` to `globals.css` + Tailwind theme and to `rules.md`. Nunito loaded via `next/font/google`, self-hosted, scoped to the wordmark via a dedicated CSS var. Keeps the "Inter for UI, weights 400/600 only" rule intact.

## Risks / Trade-offs

- **[Accidental auth gating / PII leak on public pages]** → Explicit `public` classification + positive-access tests for every session state; header uses `getUser()` boolean-only; an integration test asserts served HTML for an authenticated request contains no email/id/CRP.
- **[Theme FOUC on SSR]** → Cookie-based preference + blocking inline head script applied before paint; test asserts no light flash when a dark cookie is present.
- **[Analytics loading before consent (LGPD breach)]** → Loader gated on `cookie_consent=accepted` + host configured; unit/integration test asserts no script/network before consent. Data leaving `sa-east-1` requires documented legal basis (Open Question).
- **[CSP regression breaking the app]** → Analytics host is additive + host-allowlisted, applied only when configured; baseline CSP unchanged when unset; header tests assert both states.
- **[Plans config drift from copy]** → Single source + invariant unit test; MVP-only guard test ensures no post-MVP feature is shown as available.
- **[Legal text shipped unreviewed]** → `info/50` "revisar com jurídico" banner on both legal pages; content is reference-only.
- **[Performance budget (LCP/CLS)]** → `next/image` with explicit dims, hero preload deferred to `public-homepage`; foundation keeps the shell light; reduced-motion respected.

## Migration Plan

1. Additive only — no DB/RLS changes. New module + `(public)` group + middleware classifications + token/font additions + env vars (optional analytics).
2. Move the placeholder `src/app/page.tsx` content under the `(public)` layout; the homepage body arrives in `public-homepage` (interim: shell renders a minimal placeholder `<main>` so `/` stays 200).
3. Deploy order: this change first (foundation), then `public-homepage` and `public-pricing-page` (both depend on the shell + plans config).
4. Rollback: revert is safe — removing the module/routes restores the prior placeholder; no data migration involved. New env vars are optional (analytics no-op when unset).

## Open Questions

- **Product name**: handoff assumes "Hubrity" (not "Sálvia"). Confirmed by existing `brand-logo` spec → proceeding with Hubrity.
- **Analytics vendor + data residency**: which provider, and does it export data outside Brazil? Needs a documented LGPD legal basis before enabling in production. Until decided, ship the provider-agnostic, consent-gated, env-disabled loader.
- **Primary button token**: handoff recommends standardizing the public primary button on `brand/600` (AA). Confirm whether to also change the in-app primary token or scope `brand/600` to public context.
- **Final legal copy**: privacy/terms text is reference-only pending legal review.
