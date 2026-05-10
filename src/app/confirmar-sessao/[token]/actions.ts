'use server';

// Thin route shell for public session confirmation/decline Server Actions.
//
// The actual implementations live in:
//   - `src/modules/agenda/server/public-confirm-session.ts`
//   - `src/modules/agenda/server/public-decline-session.ts`
// (re-exported from `@/modules/agenda`).
//
// This file MUST stay thin and carry the `'use server'` directive — every
// export of a `'use server'` file MUST be an async function.
//
// These actions run WITHOUT authentication — the confirmation token is the
// authorization credential.

import type { PublicConfirmSessionResult, PublicDeclineSessionResult } from '@/modules/agenda';
import { publicConfirmSessionImpl, publicDeclineSessionImpl } from '@/modules/agenda';

export async function publicConfirmSessionAction(
  token: string,
): Promise<PublicConfirmSessionResult> {
  return publicConfirmSessionImpl(token);
}

export async function publicDeclineSessionAction(
  token: string,
  reason?: string,
): Promise<PublicDeclineSessionResult> {
  return publicDeclineSessionImpl(token, reason);
}
