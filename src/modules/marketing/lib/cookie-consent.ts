// LGPD cookie-consent substrate for the public marketing site.
// --------------------------------------------------------------------------
// A single cookie, `cookie_consent`, records the visitor's choice:
//   - `accepted` → analytics may load,
//   - `rejected` → analytics stays off.
// The banner is shown only while the cookie is ABSENT (any value hides it).
//
// Unlike the `theme` cookie, the consent cookie is written with `Secure`: it is
// a compliance signal and we want it scoped to HTTPS in every deployed
// environment (the spec for this cookie explicitly requires `Secure`).
//
// This module is pure and client-safe (no Node-only deps, no `server-only`
// guard) so it can be unit-tested in isolation and reused by the banner leaf.

/** The name of the cookie that records the LGPD consent choice. */
export const CONSENT_COOKIE_NAME = 'cookie_consent';

/** One year, in seconds — the lifetime of the consent cookie. */
export const CONSENT_COOKIE_MAX_AGE = 31_536_000;

/** The two explicit consent decisions the visitor can make. */
export type ConsentChoice = 'accepted' | 'rejected';

/**
 * Narrows a raw cookie value to a {@link ConsentChoice}, or `null` when it is
 * absent/unrecognized. Used as the single gate so a tampered cookie like
 * `cookie_consent=evil` is never treated as consent (it falls back to `null`,
 * i.e. "no decision", which keeps analytics off and re-shows the banner).
 */
export function parseConsent(value: string | null | undefined): ConsentChoice | null {
  return value === 'accepted' || value === 'rejected' ? value : null;
}

/**
 * Reads the `cookie_consent` value out of a raw `document.cookie` string,
 * returning the raw value (un-narrowed) or `null` when the cookie is absent.
 *
 * Per the spec the banner hides whenever the cookie EXISTS (any value), so
 * callers use "is this non-null" for visibility and {@link parseConsent} only
 * for the analytics gate.
 *
 * @param cookieString - The full `document.cookie` string.
 */
export function readConsentCookie(cookieString: string): string | null {
  const match = cookieString.match(/(?:^|;\s*)cookie_consent=([^;]*)/);
  const raw = match?.[1];
  return raw === undefined ? null : decodeURIComponent(raw);
}

/**
 * Serializes the `cookie_consent` cookie with the attributes required by the
 * spec: `SameSite=Lax`, `Secure`, `Path=/`, `Max-Age` of one year.
 *
 * Returned as a `document.cookie`-compatible string so the banner leaf can
 * assign it directly without pulling a cookie library into the bundle.
 */
export function serializeConsentCookie(choice: ConsentChoice): string {
  return `${CONSENT_COOKIE_NAME}=${choice}; Path=/; Max-Age=${CONSENT_COOKIE_MAX_AGE}; SameSite=Lax; Secure`;
}
