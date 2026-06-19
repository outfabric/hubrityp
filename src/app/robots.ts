import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/modules/marketing';

/**
 * `robots.txt` for the public site.
 *
 * Crawlers may index everything under the public marketing site, but every
 * authenticated / private surface is explicitly disallowed so that no
 * dashboard, agenda, patient, inbox, settings, onboarding, session, or API URL
 * is ever indexed or exposed in search results. The `Sitemap:` line points at
 * the absolute sitemap URL derived from `NEXT_PUBLIC_SITE_URL`.
 *
 * Note: disallowing a path in robots.txt is a crawler hint, NOT an access
 * control — those routes are independently gated by `middleware.ts`. This entry
 * exists to keep private URLs out of the index (defense in depth for privacy),
 * not as the enforcement layer.
 */
export default function robots(): MetadataRoute.Robots {
  // Authenticated / non-public prefixes that must never be indexed.
  const disallow = [
    '/dashboard',
    '/agenda',
    '/pacientes',
    '/caixa-de-entrada',
    '/configuracoes',
    '/onboarding',
    '/sessao',
    '/api',
  ];

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow,
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
