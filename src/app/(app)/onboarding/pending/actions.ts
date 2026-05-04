'use server';

// Thin route shell for the `resendVerificationEmail` Server Action used
// from `/onboarding/pending`. The embedded
// `<ResendVerificationButton/>` Client leaf calls this wrapper across the
// `'use server'` boundary; the wrapper delegates to the implementation
// re-exported by `@/modules/registration`. Mirrors the pattern in
// `src/app/(auth)/login/actions.ts` and `src/app/(app)/actions.ts`.

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
