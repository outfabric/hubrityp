'use server';

// Thin route shell for the public `resendPublicConfirmation` Server Action.
//
// The actual implementation lives in
// `src/modules/registration/server/resend-public.ts` (re-exported as
// `resendPublicConfirmation` from `@/modules/registration`). This file MUST
// stay tiny and carry the `'use server'` directive — that is what marks the
// export as a Server Action entry point for the Next.js compiler. Every export
// of a `'use server'` file MUST be an async function (types are erased and stay
// allowed via the `Promise<...>` return annotation), so we wrap the impl in a
// thin async function instead of a bare `export ... from`. This mirrors the
// pattern in `src/app/(auth)/signup/actions.ts`.
//
// This action is PUBLIC by design — it is reachable without a session from the
// `/verifique-email` page. It is enumeration-safe: it takes the target email
// only from the verified `hp_pending_email` cookie (never from input) and
// always returns the same generic `{ ok: true }` regardless of the Supabase
// outcome. See the implementation for the full security rationale.

import {
  resendPublicConfirmation as resendPublicConfirmationImpl,
  type ResendPublicResult,
} from '@/modules/registration';

export async function resendPublicConfirmation(): Promise<ResendPublicResult> {
  return resendPublicConfirmationImpl();
}
