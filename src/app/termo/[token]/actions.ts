'use server';

// Thin route shell for the public consent signing Server Action.
//
// The actual implementation lives in `src/modules/patients/server/sign-consent.ts`
// (re-exported from `@/modules/patients`). This file MUST stay thin and carry
// the `'use server'` directive — every export of a `'use server'` file MUST
// be an async function.
//
// This action runs WITHOUT authentication — the signature token is the
// authorization credential. IP and user-agent are extracted from request
// headers to record signing metadata for legal audit trail.
//
// TODO: Add rate limiting at the edge/middleware level (keyed by IP) to
// prevent DoS via repeated signing attempts. The 256-bit token provides
// unguessability, but each call triggers expensive operations (PDF gen,
// Storage upload, multiple DB writes). This is tracked as a known limitation
// until infrastructure-level rate limiting is in place.

import { headers } from 'next/headers';
import { z } from 'zod';

import type { SignConsentResult } from '@/modules/patients';
import { signConsentImpl } from '@/modules/patients';

/** Validates the token is a 64-char hex string (256-bit signature token). */
const signConsentInput = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid consent token'),
});

export async function signConsent(token: string): Promise<SignConsentResult> {
  // Validate token format at the Server Action boundary (defense-in-depth;
  // signConsentImpl also validates internally). Early rejection avoids any
  // DB work for malformed tokens.
  const parsed = signConsentInput.safeParse({ token });
  if (!parsed.success) {
    return { ok: false, error: 'not_found' };
  }

  const headersList = await headers();
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const userAgent = headersList.get('user-agent') ?? 'unknown';

  return signConsentImpl(parsed.data.token, ip, userAgent);
}
