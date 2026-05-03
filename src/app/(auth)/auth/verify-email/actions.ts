'use server';

// Thin route shell for the Server Actions consumed by `<VerifyEmailPage/>`.
//
// The actual implementations live in `src/modules/auth/server/...`
// (re-exported via `@/modules/auth`). This file MUST stay tiny and carry the
// `'use server'` directive — that is what marks the module as a Server
// Action entry point for the Next.js compiler and lets the Client Component
// import these references as RPC stubs instead of dragging the
// `import 'server-only'` graph into the browser bundle.
//
// Every export of a `'use server'` file MUST be an async function (types
// are erased and stay allowed via `export type`), so we wrap the impls in
// thin async functions instead of bare `export ... from`.

import {
  resendVerificationEmail as resendVerificationEmailImpl,
  signOut as signOutImpl,
  type ResendVerificationResult,
} from '@/modules/auth';

export type { ResendVerificationResult } from '@/modules/auth';

// Resend the verification email for the currently-authenticated user. The
// impl already handles auth/forbidden/rate-limit checks and returns a typed
// `ResendVerificationResult`; we forward verbatim.
export async function resendVerificationEmail(): Promise<ResendVerificationResult> {
  return resendVerificationEmailImpl();
}

// Sign the user out and redirect to /login. Mirrors the (app) layout's
// logout shell exactly so the verify-email page logout has the same
// observable behaviour.
export async function signOut(): Promise<void> {
  return signOutImpl();
}
