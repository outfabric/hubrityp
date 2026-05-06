/**
 * Sidecar cookie that signals whether the user opted for persistent login.
 *
 * The Supabase SSR wrapper (`src/shared/supabase/server.ts`) reads this cookie
 * on every request to decide whether to apply `Max-Age = 86400` (24h) to
 * Supabase session cookies or leave them as session cookies (no Max-Age).
 *
 * This module exposes helpers for writing/clearing the sidecar from Server
 * Actions and Route Handlers that have access to the Next.js `cookies()` API.
 */

import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies';

/** The name of the sidecar cookie read by the Supabase wrapper. */
export const KEEP_LOGGED_IN_COOKIE_NAME = 'hp_keep_logged_in';

/** Max-Age applied to both this sidecar and Supabase session cookies (24h). */
export const KEEP_LOGGED_IN_MAX_AGE = 86_400;

/** Shared base options for the sidecar cookie — security-hardened. */
const BASE_OPTIONS: Pick<ResponseCookie, 'path' | 'httpOnly' | 'secure' | 'sameSite'> = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
};

/**
 * Write the `hp_keep_logged_in` sidecar cookie.
 *
 * @param cookieStore - The Next.js `cookies()` store (awaited).
 * @param keepLoggedIn - `true` to persist the session for 24h; `false` for a
 *   session-only cookie (cleared when the browser closes).
 */
export function setKeepLoggedInCookie(
  cookieStore: {
    set: (name: string, value: string, options?: Partial<ResponseCookie>) => void;
  },
  keepLoggedIn: boolean,
): void {
  if (keepLoggedIn) {
    cookieStore.set(KEEP_LOGGED_IN_COOKIE_NAME, '1', {
      ...BASE_OPTIONS,
      maxAge: KEEP_LOGGED_IN_MAX_AGE,
    });
  } else {
    // Session cookie — omit maxAge so the browser discards it on close.
    cookieStore.set(KEEP_LOGGED_IN_COOKIE_NAME, '0', {
      ...BASE_OPTIONS,
    });
  }
}

/**
 * Clear the `hp_keep_logged_in` sidecar cookie (typically on sign-out).
 *
 * Sets `Max-Age=0` which instructs browsers to immediately expire and discard
 * the cookie.
 *
 * @param cookieStore - The Next.js `cookies()` store (awaited).
 */
export function clearKeepLoggedInCookie(cookieStore: {
  set: (name: string, value: string, options?: Partial<ResponseCookie>) => void;
}): void {
  cookieStore.set(KEEP_LOGGED_IN_COOKIE_NAME, '', {
    ...BASE_OPTIONS,
    maxAge: 0,
  });
}
