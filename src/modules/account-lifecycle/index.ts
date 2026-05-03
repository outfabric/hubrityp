// Public API of the `account-lifecycle` module.
//
// Per the `reorganize-folder-structure` design decision, every module exposes
// its surface through a single `index.ts` barrel — consumers MUST import from
// `@/modules/account-lifecycle`, never from internal paths like
// `@/modules/account-lifecycle/lib/...`.
//
// `applyTransition` and `getAccountStatus` are server-only implementations
// re-exported here for **server-side consumers** (other modules' Server
// Actions, the middleware, integration tests). The Client Components added
// in section 6 (verify-email-page, crp-review-page) MUST consume their
// resend / contact-related Server Actions through the route shells under
// `src/app/(auth)/auth/...` — importing from this barrel into a Client
// Component would drag the `'server-only'` chain (Drizzle client, logger,
// Supabase server client) into the browser bundle and the RSC boundary
// checker would reject the build.
//
// This `index.ts` MUST NOT carry a top-level `'use server'` directive.
// Marking the module as `'use server'` would force every named export to be
// RPC-able and would couple even the pure helpers (`transitionStatus`,
// `documentVersions`) to the Server Action runtime, defeating the
// shell ↔ module split.

export {
  type AccountStatus,
  type TransitionEvent,
  type TransitionResult,
  transitionStatus,
} from './lib/state-machine';

export { type DocumentKind, documentVersions, getDocumentVersion } from './lib/document-versions';

export {
  type AccountStatusResult,
  type JwtAccountMirror,
  getAccountStatus,
} from './server/get-account-status';

export { applyTransition } from './server/transition';

// Bloqueante UI components for the lifecycle gates. These are pure UI —
// neither imports a Server Action directly. Their Server Action props are
// wired by the route shells under `src/app/(auth)/auth/...`. Re-exporting
// them here keeps the module barrel as the single import surface for the
// public account-lifecycle API.
//
// `<VerifyEmailPage/>` is a Client Component (interactive resend); the
// barrel does not carry `'use client'`, so the directive on the file
// itself governs which graph it lives in. `<CrpReviewPage/>` is a Server
// Component because it has no client-side interactivity beyond the logout
// form. Both are safe to import from server-side call sites (the route
// shells), and both stay free of `'server-only'` so they can transitively
// reach the browser bundle when used as Client Components consume them.
export { CrpReviewPage, type CrpReviewPageProps } from './components/crp-review-page';
export {
  VerifyEmailPage,
  type VerifyEmailPageProps,
  type VerifyEmailResendResult,
} from './components/verify-email-page';
