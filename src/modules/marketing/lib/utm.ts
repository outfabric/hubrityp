// UTM preservation for public-site CTAs.
// --------------------------------------------------------------------------
// Marketing acquisition links arrive with `utm_*` query parameters (e.g.
// `?utm_source=newsletter&utm_campaign=launch`). When a visitor clicks a CTA
// that navigates to `/signup`, those parameters must survive the hop so the
// signup can be attributed to the originating campaign.
//
// Privacy posture (LGPD): UTM values are treated as OPAQUE strings. They are
// only ever copied from the current URL onto the target URL — never parsed,
// never decoded, never logged, and never correlated with any user-identifying
// field. This module performs no logging at all.
//
// This is a pure, client-safe helper: it takes the current query string as an
// argument (the caller reads `window.location.search` at click time) so the
// logic stays deterministic and unit-testable without a DOM.

/**
 * The allowlist of query parameters that are forwarded across a CTA hop.
 *
 * Restricting to exactly these keys is a deliberate safeguard: an attacker who
 * crafts a link like `/?evil=<script>&utm_source=x` cannot smuggle arbitrary
 * params onto the target URL — only the five canonical `utm_*` keys (plus the
 * common `gclid`/`fbclid` click identifiers) ride along. Everything else on the
 * source URL is dropped.
 */
const FORWARDED_PARAMS: ReadonlySet<string> = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
]);

/**
 * Appends the allowlisted tracking parameters present in `currentSearch` onto
 * `targetPath`, returning a path-relative href.
 *
 * The `targetPath` is always an internal, path-relative value (e.g. `/signup`)
 * supplied by our own code — never user input — so the result cannot become an
 * open-redirect sink. Only the allowlisted keys are copied; their values are
 * carried verbatim (opaque) without inspection.
 *
 * @param targetPath - Internal path the CTA navigates to (e.g. `/signup`).
 * @param currentSearch - The current URL query string (e.g. `window.location.search`),
 *   with or without the leading `?`.
 * @returns `targetPath` with the forwarded params appended, or unchanged when
 *   there are none to forward.
 *
 * @example withUtm('/signup', '?utm_source=news&foo=bar') // '/signup?utm_source=news'
 * @example withUtm('/signup', '')                         // '/signup'
 */
export function withUtm(targetPath: string, currentSearch: string): string {
  const source = new URLSearchParams(currentSearch);
  const forwarded = new URLSearchParams();

  // Iterate the allowlist (not the source) so unknown/hostile params are never
  // even read onto the target, and the output param order is deterministic.
  for (const key of FORWARDED_PARAMS) {
    const value = source.get(key);
    if (value !== null && value !== '') {
      forwarded.set(key, value);
    }
  }

  const query = forwarded.toString();
  if (query === '') {
    return targetPath;
  }

  // `targetPath` is path-relative and never carries its own query string in our
  // usage, but guard the separator anyway so the helper composes safely.
  const separator = targetPath.includes('?') ? '&' : '?';
  return `${targetPath}${separator}${query}`;
}

/**
 * Reads the current browser query string (client-only) and forwards the
 * allowlisted tracking params onto `targetPath`. On the server (no `window`),
 * returns `targetPath` unchanged so server rendering stays deterministic.
 *
 * @param targetPath - Internal path the CTA navigates to (e.g. `/signup`).
 */
export function withUtmFromLocation(targetPath: string): string {
  if (typeof window === 'undefined') {
    return targetPath;
  }
  return withUtm(targetPath, window.location.search);
}
