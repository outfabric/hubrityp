'use server';

// Thin route shell for the `requestPasswordReset` Server Action.
//
// The actual implementation lives in
// `src/modules/password-recovery/server/request-password-reset.ts`
// (re-exported as `requestPasswordReset` from `@/modules/password-recovery`).
// This file MUST stay tiny and carry the `'use server'` directive — that is
// what marks the module as a Server Action entry point for the Next.js
// compiler.

import { requestPasswordReset as requestPasswordResetImpl } from '@/modules/password-recovery';

export type { RequestPasswordResetResult } from '@/modules/password-recovery';

export async function requestPasswordReset(formData: FormData) {
  return requestPasswordResetImpl(formData);
}
