// Dark-mode substrate for the public marketing site.
// --------------------------------------------------------------------------
// Design decision (D4): a hand-rolled, minimal theme layer — NOT `next-themes`
// — so we keep full control of the cookie/SSR path and avoid an extra dep.
//
// The active theme is expressed as the `data-theme` attribute on `<html>`.
// Setting `data-theme='dark'` flips the entire token set (declared in
// `globals.css`) within one frame, with no class churn and no React re-render.
//
// Resolution order (highest precedence first):
//   1. Explicit stored choice  (the `theme` cookie: `light` | `dark`)
//   2. OS preference           (`prefers-color-scheme: dark`)
//   3. Light                   (default)
//
// This module is pure and client-safe: no Node-only deps, no `server-only`
// guard. It is imported by the server layout (to read the cookie), by the
// blocking no-flash inline script (as the generated string), and by the
// client provider/toggle (to persist the choice). Keeping the logic here makes
// it unit-testable in isolation and guarantees server and client agree on the
// exact same resolution rules.

/** The two themes the UI can resolve to. The `data-theme` attribute value. */
export type Theme = 'light' | 'dark';

/** The name of the cookie that persists the user's explicit theme choice. */
export const THEME_COOKIE_NAME = 'theme';

/** One year, in seconds — the lifetime of the persisted theme cookie. */
export const THEME_COOKIE_MAX_AGE = 31_536_000;

/**
 * Narrows an arbitrary string (e.g. a raw cookie value) to a valid `Theme`,
 * or `null` when it is absent/unrecognized. Used as the single gate so a
 * tampered cookie like `theme=evil` can never become a `data-theme` value.
 */
export function parseStoredTheme(value: string | null | undefined): Theme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

/**
 * Resolves the theme to apply, given the explicitly stored choice and the OS
 * preference. The stored choice always wins; otherwise the OS preference
 * decides; otherwise we default to light.
 *
 * @param stored - The value of the `theme` cookie (raw, possibly invalid).
 * @param prefersDark - Whether the OS reports `prefers-color-scheme: dark`.
 */
export function resolveTheme(stored: string | null | undefined, prefersDark: boolean): Theme {
  const explicit = parseStoredTheme(stored);
  if (explicit !== null) {
    return explicit;
  }
  return prefersDark ? 'dark' : 'light';
}

/**
 * Serializes the `theme` cookie with the attributes from the design decision
 * (D4): `SameSite=Lax`, `Path=/`, `Max-Age` of one year. `Secure` is
 * intentionally omitted so the cookie also works over plain `http` in local
 * development; the value (`light`/`dark`) is non-sensitive UI state, never PII
 * or a credential, so the absence of `Secure` carries no security risk.
 *
 * Returned as a `document.cookie`-compatible string so the client provider can
 * assign it directly without pulling a cookie library into the bundle.
 */
export function serializeThemeCookie(theme: Theme): string {
  return `${THEME_COOKIE_NAME}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Builds the blocking inline script injected into `<head>`. It runs before
 * first paint and applies `data-theme` to `<html>` so there is no
 * flash-of-unstyled-content (FOUC) when the resolved theme differs from the
 * CSS default (light).
 *
 * The script re-implements {@link resolveTheme} in plain DOM JS because it must
 * execute standalone, before any bundle (including this module) is parsed:
 *   - reads the `theme` cookie,
 *   - falls back to `matchMedia('(prefers-color-scheme: dark)')`,
 *   - sets `document.documentElement.dataset.theme`.
 *
 * It contains no interpolated/user data — it is a fixed string — so it is safe
 * to inject via `dangerouslySetInnerHTML` (the only way to make it blocking).
 * Wrapped in a `try/catch` so a hostile environment (e.g. cookies disabled)
 * degrades to the light default rather than throwing before paint.
 */
export function buildNoFlashThemeScript(): string {
  return `(function(){try{var m=document.cookie.match(/(?:^|; )theme=(light|dark)/);var t=m?m[1]:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
}
