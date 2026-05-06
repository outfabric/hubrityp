'use server';

// Thin route shell for the `resetPassword` Server Action.
//
// The actual implementation lives in
// `src/modules/password-recovery/server/reset-password.ts`
// (re-exported as `resetPassword` from `@/modules/password-recovery`).
// This file MUST stay tiny and carry the `'use server'` directive — that is
// what marks the module as a Server Action entry point for the Next.js
// compiler.

import { resetPassword as resetPasswordImpl } from '@/modules/password-recovery';

export type { ResetPasswordResult } from '@/modules/password-recovery';

export async function resetPassword(formData: FormData) {
  return resetPasswordImpl(formData);
}
