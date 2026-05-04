'use server';

// Thin route shell for the `signUp` Server Action.
//
// The actual implementation lives in
// `src/modules/registration/server/sign-up.ts` (re-exported as `signUp` from
// `@/modules/registration`). This file MUST stay tiny and carry the
// `'use server'` directive — that is what marks the module as a Server
// Action entry point for the Next.js compiler. Every export of a
// `'use server'` file MUST be an async function (types are erased and stay
// allowed via `export type`), so we wrap the impl in a thin async function
// instead of bare `export ... from`. This mirrors the pattern in
// `src/app/(auth)/login/actions.ts`.

import { signUp as signUpImpl, type SignUpResult } from '@/modules/registration';

// Note: a `'use server'` file is treated by Next.js / Turbopack as a Server
// Actions entry point. Every export — including type-only ones — is wired
// up to the RPC stub layer, so a `export type { X }` re-export here breaks
// the build with "export X doesn't exist in target module". Consumers that
// need `SignUpResult` must import it directly from `@/modules/registration`
// instead of from this shell. The function signature below preserves the
// type information through `Promise<SignUpResult>`, which IS allowed
// because TypeScript erases it before the Server Actions transform runs.
export async function signUp(formData: FormData): Promise<SignUpResult> {
  return signUpImpl(formData);
}
