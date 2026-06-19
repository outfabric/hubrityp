import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/modules/marketing';

/**
 * XML sitemap for the public, indexable marketing pages only.
 *
 * Every URL is absolute, derived from `NEXT_PUBLIC_SITE_URL` via `absoluteUrl()`
 * (never hardcoded). Authenticated surfaces (`/dashboard`, `/agenda`,
 * `/pacientes`, etc.) are deliberately excluded — they are disallowed in
 * `robots.ts` and must never appear in a search index. Only the marketing
 * routes that exist and are meant to rank are listed here.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // Public, indexable routes. `priority` is relative within the site; the
  // homepage leads, legal pages trail.
  const routes: ReadonlyArray<{ path: string; priority: number }> = [
    { path: '/', priority: 1 },
    { path: '/precos', priority: 0.8 },
    { path: '/politica-de-privacidade', priority: 0.3 },
    { path: '/termos-de-uso', priority: 0.3 },
  ];

  const lastModified = new Date();

  return routes.map(({ path, priority }) => ({
    url: absoluteUrl(path),
    lastModified,
    changeFrequency: 'monthly',
    priority,
  }));
}
