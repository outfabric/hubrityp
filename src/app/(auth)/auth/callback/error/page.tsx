import { AuthCallbackError } from '@/modules/registration';

import { resendVerificationEmail } from './actions';

// Error UI for `/auth/callback`. Rendered when the route handler at
// `app/(auth)/auth/callback/route.ts` redirects here because the
// verification code was missing, expired, or tampered with. We wrap the
// `<AuthCallbackError/>` Server Component (from the registration module)
// and pass it the resend Server Action via the local `./actions.ts` shell
// — the shell's `'use server'` directive is what makes the action callable
// from the embedded client `<ResendVerificationButton/>` leaf.
//
// The resend action is best-effort on this surface: a user reaching the
// error page from an expired link may not have a session, and the action
// returns `{ ok: false, error: 'invalid_status' }` in that case. The
// button surfaces a generic pt-BR message rather than crashing.
//
// `searchParams` carries `?reason=missing|invalid|unknown` from the route
// handler. We don't render the reason today (the copy is identical for all
// three cases per spec), but we accept and ignore the param so a future
// copy refinement can branch on it without changing the URL contract.
export default function AuthCallbackErrorPage() {
  return <AuthCallbackError resendAction={resendVerificationEmail} />;
}
