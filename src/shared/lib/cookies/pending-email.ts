/**
 * Signed sidecar cookie that carries the pending (unconfirmed) email
 * server-side between the signup/login Server Actions and the public
 * `/verifique-email` page.
 *
 * The value is HMAC-SHA256 signed with `PENDING_EMAIL_COOKIE_SECRET` so an
 * attacker cannot forge the cookie to make the public page trigger a
 * confirmation-email send for an arbitrary address (email-bombing). The read
 * path recomputes the HMAC and rejects on mismatch (timing-safe compare),
 * treating a tampered/forged cookie as absent.
 *
 * Node runtime only — `node:crypto` is unavailable on the Edge, so this module
 * must never be imported from `src/middleware.ts`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies';

import { serverEnv } from '@/shared/env';

/** The name of the signed pending-email cookie. */
export const PENDING_EMAIL_COOKIE_NAME = 'hp_pending_email';

/** Lifetime of the cookie (30 minutes) — enough to finish the verify flow. */
export const PENDING_EMAIL_MAX_AGE = 1_800;

/** Shared base options for the cookie — security-hardened. */
const BASE_OPTIONS: Pick<ResponseCookie, 'path' | 'httpOnly' | 'secure' | 'sameSite'> = {
  path: '/',
  httpOnly: true,
  // `Secure` is irrelevant over http on localhost (browsers still send the
  // cookie); production is always https so this is honored there.
  secure: serverEnv.NODE_ENV === 'production',
  sameSite: 'lax',
};

/** Minimal write surface of the Next.js `cookies()` store. */
type WritableCookieStore = {
  set: (name: string, value: string, options?: Partial<ResponseCookie>) => void;
};

/** Minimal read surface of the Next.js `cookies()` store. */
type ReadableCookieStore = {
  get: (name: string) => { value: string } | undefined;
};

/** Compute the base64url-encoded HMAC-SHA256 of `email`. */
function signEmail(email: string): string {
  return createHmac('sha256', serverEnv.PENDING_EMAIL_COOKIE_SECRET)
    .update(email, 'utf8')
    .digest('base64url');
}

/**
 * Write the signed `hp_pending_email` cookie.
 *
 * Value format: `base64url(email) + "." + base64url(HMAC_SHA256(email))`.
 *
 * @param cookieStore - The Next.js `cookies()` store (awaited).
 * @param email - The pending email to carry server-side.
 */
export function setPendingEmailCookie(cookieStore: WritableCookieStore, email: string): void {
  const encodedEmail = Buffer.from(email, 'utf8').toString('base64url');
  const signature = signEmail(email);
  cookieStore.set(PENDING_EMAIL_COOKIE_NAME, `${encodedEmail}.${signature}`, {
    ...BASE_OPTIONS,
    maxAge: PENDING_EMAIL_MAX_AGE,
  });
}

/**
 * Read and verify the pending email from the `hp_pending_email` cookie.
 *
 * Returns the email only when the signature is present and matches (timing-safe
 * compare). A missing, malformed, tampered, or wrong-secret-signed cookie is
 * treated as absent and yields `null`.
 *
 * @param cookieStore - The Next.js `cookies()` store (awaited).
 */
export function readPendingEmail(cookieStore: ReadableCookieStore): string | null {
  const raw = cookieStore.get(PENDING_EMAIL_COOKIE_NAME)?.value;
  if (!raw) return null;

  const separatorIndex = raw.indexOf('.');
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) return null;

  const encodedEmail = raw.slice(0, separatorIndex);
  const providedSignature = raw.slice(separatorIndex + 1);

  let email: string;
  try {
    email = Buffer.from(encodedEmail, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (email.length === 0) return null;

  const expectedSignature = signEmail(email);

  // Compare as bytes with a constant-time primitive. The length guard avoids
  // `timingSafeEqual` throwing on mismatched buffer lengths.
  const providedBuf = Buffer.from(providedSignature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;

  return email;
}

/**
 * Clear the `hp_pending_email` cookie (after successful confirmation or when
 * abandoning the flow). Sets `Max-Age=0` so the browser discards it.
 *
 * @param cookieStore - The Next.js `cookies()` store (awaited).
 */
export function clearPendingEmailCookie(cookieStore: WritableCookieStore): void {
  cookieStore.set(PENDING_EMAIL_COOKIE_NAME, '', {
    ...BASE_OPTIONS,
    maxAge: 0,
  });
}

/**
 * Mask an email for display: keep the first character of the local part and the
 * full domain, replacing the rest of the local part with asterisks.
 *
 * Example: `maria@gmail.com` -> `m****@gmail.com`.
 *
 * If the input has no `@` or an empty local part, returns it unchanged — the
 * caller is responsible for never displaying an unmaskable value.
 */
export function maskEmail(email: string): string {
  const atIndex = email.lastIndexOf('@');
  if (atIndex <= 0) return email;

  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex); // includes the leading '@'

  const firstChar = localPart[0];
  const stars = '*'.repeat(localPart.length - 1);
  return `${firstChar}${stars}${domain}`;
}
