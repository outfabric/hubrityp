---
name: Module barrel server-only leakage pattern
description: Module barrels (index.ts) that co-export Server Action implementations (server-only, next/headers) and Client Components cause a critical build error in Next.js App Router
type: project
---

This project uses module barrels (index.ts) to expose each module's public API. A dangerous pattern identified on 2026-05-06:

The `oauth/index.ts` and `password-recovery/index.ts` barrels re-export both Server Action implementations (`linkOAuthIdentityImpl`, `requestPasswordResetImpl`) and Client Components (`GoogleButton`, `ForgotPasswordForm`). When a Client Component imports only the component from the barrel, the browser bundler pulls the entire tree — including the `import 'server-only'` + `import { headers } from 'next/headers'` chain — causing a build error.

**Confirmed problematic chain:**
- `login-form.tsx` ('use client') → `@/modules/oauth` (barrel) → `./server/link-oauth-identity.ts` (server-only) → `log-auth-event.ts` → `next/headers` = BUILD ERROR
- `forgot-password/page.tsx` → `@/modules/password-recovery` (barrel) → `./server/request-password-reset.ts` (server-only) → `log-auth-event.ts` → `next/headers` = BUILD ERROR

**Why it is surprising**: the `auth/index.ts` barrel has an explicit comment warning that Client Components must not import `signIn` directly (and `login-form.tsx` correctly imports from `@/app/(auth)/login/actions`). But the same discipline was not applied to the `oauth/index.ts` barrel for `GoogleButton`.

**Fix**: Split server implementations and client components into separate exports inside the barrels, or have Client Components import directly from the internal subpaths instead of the barrel.

**Why:** Recurring pattern when new modules are created without checking whether the barrel mixes server/client exports.
**How to apply:** In every QA session, check immediately for build errors before attempting any UI scenario. Inspect the barrels of new modules if build errors appear.
