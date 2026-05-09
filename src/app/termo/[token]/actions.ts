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

import { headers } from 'next/headers';

import type { SignConsentResult } from '@/modules/patients';
import { signConsentImpl } from '@/modules/patients';

export async function signConsent(token: string): Promise<SignConsentResult> {
  const headersList = await headers();
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const userAgent = headersList.get('user-agent') ?? 'unknown';

  return signConsentImpl(token, ip, userAgent);
}
