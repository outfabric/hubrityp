---
name: public-site-foundation-patterns
description: Public marketing site module (marketing) — classifyPath public routes, analytics LGPD gate, UTM allowlist, no-flash theme, cookie consent patterns
metadata:
  type: project
---

# Public site foundation patterns (added 2026-06-18)

**Fact:** The `(public)` route group (`src/app/(public)/`) hosts the marketing site. Routes: `/`, `/politica-de-privacidade`, `/termos-de-uso`, and `/precos` (middleware-ready, page not yet shipped). The `(public)` Next.js folder name is organizational only — gating is 100% in `classifyPath()`.

**Why:** Existing classifier only treated `/dashboard*` as `'app'`; public marketing routes needed explicit `'public'` classification to prevent accidental gating if the classifier ever defaults to deny.

**How to apply:** Any new public marketing page must be added to `PUBLIC_MARKETING_PREFIXES` in `src/middleware.ts` AND must have a negative-auth integration test in `public-routes-gating.int.test.ts`.

---

## Key patterns

### Middleware classification
`PUBLIC_MARKETING_PREFIXES` uses exact-or-prefix+separator semantics (`pathname === prefix || pathname.startsWith(prefix + '/')`). Exact match for `/` (homepage) is separate to avoid `/` matching everything.

### Public header auth check
`PublicHeader` (server wrapper) calls `supabase.auth.getUser()` (not `getSession()`) and passes ONLY a `boolean` `isAuthenticated` to `PublicHeaderClient`. No PII crosses the server→client boundary. Covered by `public-header.int.test.ts` with explicit PII-leak assertions.

### Analytics consent gate (LGPD RNF-14.06)
`AnalyticsLoader` reads `document.cookie` on mount; renders nothing until both `NEXT_PUBLIC_ANALYTICS_HOST` is set AND consent is `accepted`. No script, no network request before consent. Integration test in `analytics-consent.int.test.ts` covers all three cases. CSP in `next.config.ts` adds analytics origin to `script-src` and `connect-src` only when host is configured (exact origin, no wildcard).

### UTM forwarding
`withUtm()` / `withUtmFromLocation()` in `lib/utm.ts`: explicit allowlist `FORWARDED_PARAMS` (5 utm keys + gclid/fbclid). Values are opaque strings passed verbatim — never decoded, never logged. Target is always a fixed internal path (not user input). Not an open-redirect sink.

### No-flash dark theme
`buildNoFlashThemeScript()` in `lib/theme.ts` returns a fixed string with no interpolated data — safe to inject via `dangerouslySetInnerHTML`. Server reads `theme` cookie and renders `data-theme` on `<html>` for returning visitors; blocking inline script handles first-visit/OS-preference case. No-flash proven by `theme-no-flash.int.test.ts`.

### Cookie serialization
- Consent cookie: `Secure; SameSite=Lax` (compliance signal, HTTPS-only).
- Theme cookie: No `Secure` (non-sensitive UI state, works over HTTP in local dev — intentional, documented).

### `(public)/not-found.tsx` vs `app/not-found.tsx`
Both exist: the former is invoked by `notFound()` calls within the `(public)` segment tree; the latter catches all top-level unknown URLs. Duplication is intentional (Next.js routing constraint, documented inline).

### `LegalReviewNotice`
Legal pages (`/politica-de-privacidade`, `/termos-de-uso`) ship with placeholder content and a `LegalReviewNotice` banner. **Known gap:** they do not set `robots: { index: false }` yet — they will be indexed before legal review is complete unless that metadata is added.

### `/precos` page gap
`middleware.ts` and `sitemap.ts` both reference `/precos` but no `src/app/(public)/precos/page.tsx` exists in the foundation change. Crawlers following the sitemap receive a 404. Needs a placeholder page or removal from sitemap.
