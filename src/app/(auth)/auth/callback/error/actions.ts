'use server';

// Thin route shell for the `resendVerificationEmail` Server Action — used
// from the `/auth/callback/error` page so the embedded
// `<ResendVerificationButton/>` Client leaf can call it across the
// `'use server'` boundary. Best-effort on this surface: a user arriving
// here from an expired link may not have a session, in which case the
// action returns `{ ok: false, error: 'invalid_status' }` and the button
// renders a generic pt-BR fallback. Mirrors the wrapper pattern in
// `src/app/(auth)/login/actions.ts`.

import {
  resendVerificationEmail as resendVerificationEmailImpl,
  type ResendVerificationResult,
} from '@/modules/registration';

// Note: a `'use server'` file is treated by Next.js / Turbopack as a Server
// Actions entry point. Every export — including type-only ones — is wired
// up to the RPC stub layer, so a `export type { X }` re-export here breaks
// the build with "export X doesn't exist in target module". Consumers that
// need `ResendVerificationResult` must import it directly from
// `@/modules/registration`. The function signature preserves the type
// information through `Promise<ResendVerificationResult>`, which IS
// allowed because TypeScript erases it before the Server Actions transform
// runs.
export async function resendVerificationEmail(): Promise<ResendVerificationResult> {
  return resendVerificationEmailImpl();
}
