import { type AccountStatus } from '@/modules/account-lifecycle';

import { safeRedirect } from './safe-redirect';

/**
 * Compute the post-login redirect target from the user's account status and
 * an optional caller-provided `redirectTo`.
 *
 * Status → destination:
 *   • `active`                 → `requestedRedirect` (if same-origin) else `/dashboard`
 *   • `pending_verification`   → `/auth/verify-email` (always — bloqueante)
 *   • `pending_crp_validation` → `/auth/crp-review`   (always — bloqueante)
 *   • `suspended`              → `/login?reason=suspended`
 *   • `cancelled`              → `/login?reason=cancelled`
 *
 * For the bloqueante statuses (`pending_verification`, `pending_crp_validation`)
 * the requested redirect is intentionally ignored: the user cannot use the
 * app until the lifecycle gate clears, so handing them their original
 * destination would just bounce them back through the middleware.
 *
 * The function is pure — no I/O — so it can be unit-tested exhaustively. The
 * `safeRedirect` helper guards against open-redirect attacks for the `active`
 * branch by rejecting any value that isn't a same-origin absolute path.
 */
const ACTIVE_DEFAULT = '/dashboard';

export function postLoginRedirect(status: AccountStatus, requestedRedirect: string | null): string {
  switch (status) {
    case 'active':
      return safeRedirect(requestedRedirect, ACTIVE_DEFAULT);
    case 'pending_verification':
      return '/auth/verify-email';
    case 'pending_crp_validation':
      return '/auth/crp-review';
    case 'suspended':
      return '/login?reason=suspended';
    case 'cancelled':
      return '/login?reason=cancelled';
  }
}
