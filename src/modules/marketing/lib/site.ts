// Single source of truth for absolute URLs emitted by the public marketing
// site (Next `metadataBase`, canonical / og:url tags, sitemap.xml, robots.txt).
// Everything derives from `clientEnv.NEXT_PUBLIC_SITE_URL` so the host is never
// hardcoded and never silently relative.
//
// `clientEnv` is imported from the leaf module (`@/shared/env/client`) rather
// than the `@/shared/env` barrel: the barrel is `server-only`, so importing a
// runtime value from it inside code that may run on the client breaks the
// Next build. The leaf is client-safe.
import { clientEnv } from '@/shared/env/client';

/**
 * Returns the configured public site base URL, normalized without a trailing
 * slash so callers can append paths predictably.
 */
export function siteUrl(): string {
  return stripTrailingSlashes(clientEnv.NEXT_PUBLIC_SITE_URL);
}

/**
 * Builds an absolute URL for a path under the public site base.
 *
 * The base comes from `NEXT_PUBLIC_SITE_URL` (validated as a URL at env load),
 * never from caller-supplied origins — so this cannot be turned into an
 * open-redirect sink. The `path` is treated as a path on that origin; any
 * trailing slash on the base and any leading slashes on the path are
 * normalized to a single separator.
 *
 * @example absoluteUrl('/precos')      // 'https://hubrity.com/precos'
 * @example absoluteUrl('precos')       // 'https://hubrity.com/precos'
 * @example absoluteUrl('/')            // 'https://hubrity.com/'
 * @example absoluteUrl()               // 'https://hubrity.com'
 */
export function absoluteUrl(path = ''): string {
  const base = siteUrl();
  if (path === '') {
    return base;
  }
  if (path === '/') {
    return `${base}/`;
  }
  const normalizedPath = path.replace(/^\/+/, '');
  return `${base}/${normalizedPath}`;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}
