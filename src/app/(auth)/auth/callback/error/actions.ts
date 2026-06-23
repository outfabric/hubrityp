'use server';

// Thin route shell for the resend Server Action used from the
// `/auth/callback/error` page so the embedded `<ResendVerificationButton/>`
// Client leaf can call it across the `'use server'` boundary.
//
// This surface is session-less by nature: a user reaching the error page from
// an expired/invalid confirmation link does not hold a session. With Supabase
// email confirmation enabled, the old authenticated `resendVerificationEmail`
// (which required a `pending_verification` session that can never exist) has
// been removed. Resend is now handled exclusively by the public, enumeration-
// safe `resendPublicConfirmation` action, which takes the target email only
// from the verified `hp_pending_email` cookie and always returns the same
// generic `{ ok: true }`. Mirrors the wrapper pattern in
// `src/app/(auth)/verifique-email/actions.ts`.

import {
  resendPublicConfirmation as resendPublicConfirmationImpl,
  type ResendPublicResult,
} from '@/modules/registration';

export async function resendVerificationEmail(): Promise<ResendPublicResult> {
  return resendPublicConfirmationImpl();
}
