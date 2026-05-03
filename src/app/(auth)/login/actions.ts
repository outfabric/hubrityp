'use server';

// Thin route shell for the `signIn` Server Action.
//
// The actual implementation lives in `src/modules/auth/server/login.ts`
// (re-exported as `signIn` from `@/modules/auth`). This file MUST stay tiny
// and carry the `'use server'` directive — that is what marks the module as
// a Server Action entry point for the Next.js compiler. Every export of a
// `'use server'` file MUST be an async function (types are erased and stay
// allowed via `export type`), so we wrap the impl in a thin async function
// instead of bare `export ... from`.

import { signIn as signInImpl } from '@/modules/auth';

export type { SignInResult } from '@/modules/auth';

export async function signIn(formData: FormData) {
  return signInImpl(formData);
}
