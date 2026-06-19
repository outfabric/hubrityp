---
name: public-site-foundation-qa
description: QA of the (public) marketing route group — anonymous, no auth/migrations needed; cookie-consent + dark-mode + legal pages + branded 404; recurring mobile-header overflow + sub-44px targets, dev-only no-flash theming console warnings, and nav links that forward-reference not-yet-built /precos & #funcionalidades
metadata:
  type: project
---

The `public-site-foundation` change (branch `feature/public-site-foundation`, worktree `/home/ubuntu/repos/hubrityp-public-site-foundation`) builds the shared chrome for anonymous marketing pages. Everything here is ANONYMOUS — no db:migrate, no seeded user, no auth cookie needed (unlike [[authenticated-browser-qa-setup]]). Just `docker compose up` + open the URLs.

**Route structure (gotcha):** `/` is served by `src/app/(public)/page.tsx` (route group stripped from URL), wrapped by `src/app/(public)/layout.tsx` which renders SkipLink + PublicHeader + `<main id="conteudo">` + PublicFooter + `<CookieConsent/>` + `<AnalyticsLoader/>`. There are two `not-found.tsx` (root + `(public)`). The marketing components live in `src/modules/marketing/` (public-header-client.tsx, cookie-consent.tsx, lib/cookie-consent.ts, etc.).

**Cookie-consent banner is a client leaf** — it mounts AFTER hydration, so a snapshot taken immediately on load shows NO banner (false negative). Wait ~1s then re-check `document.body.innerText.includes('Usamos cookies')`. Cookie name `cookie_consent` ∈ {accepted, rejected}; banner hides whenever the cookie is non-null. Written with `Secure` — Chromium honors Secure on `http://localhost` so persistence WORKS locally; but a real HTTP-only host would drop it (HTTPS-only by design).

**No-flash dark mode (dev-only console noise — LOW, not a bug):** `src/app/layout.tsx` renders `data-theme` on `<html>` only when the `theme` cookie exists, plus an inline `<head>` `<script>` (buildNoFlashThemeScript). This deliberately produces TWO React dev warnings on EVERY page: (a) hydration mismatch on `data-theme` (first visit, no cookie), (b) "Encountered a script tag while rendering React component". Both are stripped in production; theming works correctly. `suppressHydrationWarning` is NOT applied (the conventional silence for (a)). Do not over-escalate these.

**RECURRING MÉDIO — mobile header overflow + sub-44px targets (<768px):** the header mobile action group (`div.flex.gap-2.md:hidden` = theme toggle 40px + "Começar grátis" 135px + hamburger 40px) overflows the 375px viewport by 8px (23px at 360px) → horizontal scrollbar on every public page. Same three bar controls are 40px tall, below the spec's "All interactive targets MUST be ≥ 44×44px". In-menu items (open panel) ARE 44px; only the persistent bar controls are short. Desktop (768/1280/1920) is clean. Find overflow culprits with: `document.querySelectorAll('*')` → `getBoundingClientRect().right > innerWidth`.

**INFO — forward-referenced nav links:** header/footer link "Preços" → `/precos` (HTTP 404, route not built) and "Funcionalidades" → `/#funcionalidades` (no such anchor on placeholder homepage). NOT a defect of THIS change — proposal.md explicitly defers the homepage body to `public-homepage` and the pricing page to `public-pricing-page` (follow-up changes). Link destinations match the `public-navigation` spec. Confirm merge sequence so these don't go publicly clickable-to-404 prematurely.

**Verified-good a11y baseline:** every public page has exactly one h1 / banner / main / contentinfo, clean h1→h2 heading hierarchy, logo as accessible inline SVG (`role=img aria-label="Hubrity"`), skip link first-focusable + visible-on-focus → `#conteudo`, hamburger with `aria-expanded`/`aria-controls` + Escape-close + focus return + `<noscript>` fallback. Header scroll state via `data-scrolled` attr + `window.scrollY>0`, solid `bg-surface` (NO backdrop-filter/blur — DS forbids glassmorphism).

Dev `Tab` lands first on the Next.js dev-tools portal (NEXTJS-PORTAL) — dev-only, absorbs keyboard focus; assert real tab order via DOM query not live Tab.

**QA-2 (fix re-verify):** overflow MÉDIO fully fixed — 0px at 320/360/375 on all public pages (gap-1 + min-w-0 + shrink/shrink-0 on cluster). BUT the 44px touch-target part only PARTIALLY landed: hamburger `size-11 shrink-0` holds 44×44; theme toggle `<ThemeToggle className="size-11" />` (public-header-client.tsx:203) is MISSING `shrink-0`, so flex-shrinks to 41.6px wide @375 → 25px @320 (height stays 44). `size-11` sets width AND height but flex-shrink overrides width unless pinned. Verdict: issues-found, re-routed. Lesson: when checking a "force ≥44px" fix, measure WIDTH separately from height across multiple narrow widths — a control can be 44px tall but shrink horizontally inside a `min-w-0` flex cluster.
