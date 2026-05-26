'use server';

// Thin route shell for public consent signing Server Actions.
//
// The actual implementations live in the `patients` module:
//   - General consent: `src/modules/patients/server/sign-consent.ts`
//   - AI consent: `src/modules/patients/server/sign-ai-consent.ts`
//
// This file MUST stay thin and carry the `'use server'` directive -- every
// export of a `'use server'` file MUST be an async function.
//
// Both actions run WITHOUT authentication -- the signature token is the
// authorization credential. IP and user-agent are extracted from request
// headers to record signing metadata for legal audit trail.

import { headers } from 'next/headers';
import { z } from 'zod';

import { signAiConsentImpl, signConsentImpl } from '@/modules/patients';
import type { SignConsentResult } from '@/modules/patients';
import type { SignAiConsentResult } from '@/modules/patients';

// ---------------------------------------------------------------------------
// Input validation schemas
// ---------------------------------------------------------------------------

/** General consent: 64-char hex string (256-bit signature token). */
const signConsentInput = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid consent token'),
});

/** AI consent: 43-char base64url string (256-bit token, base64url encoded). */
const signAiConsentInput = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid consent token'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function extractSigningMetadata(): Promise<{
  ip: string;
  userAgent: string;
}> {
  const headersList = await headers();
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const userAgent = headersList.get('user-agent') ?? 'unknown';
  return { ip, userAgent };
}

// ---------------------------------------------------------------------------
// General consent signing action
// ---------------------------------------------------------------------------

export async function signConsent(token: string): Promise<SignConsentResult> {
  // Validate token format at the Server Action boundary (defense-in-depth;
  // signConsentImpl also validates internally). Early rejection avoids any
  // DB work for malformed tokens.
  const parsed = signConsentInput.safeParse({ token });
  if (!parsed.success) {
    return { ok: false, error: 'not_found' };
  }

  const { ip, userAgent } = await extractSigningMetadata();

  return signConsentImpl(parsed.data.token, ip, userAgent);
}

// ---------------------------------------------------------------------------
// AI consent signing action
// ---------------------------------------------------------------------------

export async function signAiConsent(token: string): Promise<SignAiConsentResult> {
  const parsed = signAiConsentInput.safeParse({ token });
  if (!parsed.success) {
    return { ok: false, error: 'not_found' };
  }

  const { ip, userAgent } = await extractSigningMetadata();

  return signAiConsentImpl(parsed.data.token, ip, userAgent);
}
