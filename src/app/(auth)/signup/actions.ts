'use server';

// Thin route shell for the `signUp` Server Action.
//
// The actual implementation lives in `src/modules/auth/server/signup.ts`
// (re-exported as `signUp` from `@/modules/auth`). This file MUST stay tiny
// and carry the `'use server'` directive — that is what marks the module as
// a Server Action entry point for the Next.js compiler. Every export of a
// `'use server'` file MUST be an async function (types are erased and stay
// allowed via `export type`), so we wrap the impl in a thin async function
// instead of bare `export ... from`.

import { signUp as signUpImpl, type SignupInput } from '@/modules/auth';

export type { SignUpResult } from '@/modules/auth';

// Accepts both `FormData` (the form-post path used by the Next.js Server
// Action runtime) and the typed `SignupInput`-shaped object (used by tests
// and the React Hook Form submit handler in `<SignupForm/>`). The impl's
// `parseInput` already discriminates on the value, so we simply forward.
export async function signUp(input: FormData | SignupInput) {
  return signUpImpl(input);
}
