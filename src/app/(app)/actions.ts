'use server';

// Thin route shell for the `signOut` Server Action.
//
// The actual implementation lives in `src/modules/auth/server/logout.ts`
// (re-exported as `signOut` from `@/modules/auth`). This file MUST stay tiny
// and carry the `'use server'` directive — that is what marks the module as
// a Server Action entry point for the Next.js compiler. Every export of a
// `'use server'` file MUST be an async function, so we wrap the impl in a
// thin async function instead of bare `export ... from`.

import { signOut as signOutImpl } from '@/modules/auth';

export async function signOut(): Promise<void> {
  return signOutImpl();
}
