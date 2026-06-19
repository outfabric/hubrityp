// Per-page SEO metadata helper for the public marketing site.
// --------------------------------------------------------------------------
// `buildPageMetadata()` produces a Next.js `Metadata` object with a unique
// title, description, canonical URL, and Open Graph / Twitter card tags for a
// single public page. Every absolute URL (canonical, og:url, og:image) is
// derived from `NEXT_PUBLIC_SITE_URL` via `absoluteUrl()` — never hardcoded and
// never relative — so canonical/og:url cannot drift from the configured host
// and cannot be turned into an open-redirect sink (the base origin is an
// env-validated URL, not caller-supplied).
import type { Metadata } from 'next';

import { absoluteUrl } from './site';

// Brand name used to suffix page titles and as the OG site name.
export const SITE_NAME = 'Hubrity';

// Default Open Graph image shipped under `public/`. Referenced as the fallback
// og:image when a page does not supply its own. Must be >= 1200x630.
export const DEFAULT_OG_IMAGE = '/og-default.png';
const DEFAULT_OG_IMAGE_WIDTH = 1200;
const DEFAULT_OG_IMAGE_HEIGHT = 630;

/**
 * Input for {@link buildPageMetadata}.
 */
export type PageMetadataInput = {
  /** Page title (without the site-name suffix — the helper appends it). */
  title: string;
  /** Concise meta description for the page. */
  description: string;
  /** Path on the public site (e.g. `/precos`). Drives canonical + og:url. */
  path: string;
  /**
   * Optional page-specific OG image path. Defaults to {@link DEFAULT_OG_IMAGE}.
   * Resolved to an absolute URL via {@link absoluteUrl}.
   */
  ogImage?: string;
};

/**
 * Builds a Next.js `Metadata` object for a single public marketing page.
 *
 * - `title` is suffixed with the site name (`"<title> | Hubrity"`).
 * - `alternates.canonical` and `openGraph.url` are absolute, from the site base.
 * - `openGraph.images` / `twitter.images` resolve the (defaulted) OG image to
 *   an absolute URL.
 * - Twitter card mirrors the OG title/description/image as a large summary card.
 *
 * @example
 * buildPageMetadata({
 *   title: 'Preços',
 *   description: 'Planos e preços da Hubrity.',
 *   path: '/precos',
 * });
 */
export function buildPageMetadata(input: PageMetadataInput): Metadata {
  const { title, description, path, ogImage } = input;
  const canonical = absoluteUrl(path);
  const imageUrl = absoluteUrl(ogImage ?? DEFAULT_OG_IMAGE);
  const fullTitle = `${title} | ${SITE_NAME}`;

  const images = [
    {
      url: imageUrl,
      width: DEFAULT_OG_IMAGE_WIDTH,
      height: DEFAULT_OG_IMAGE_HEIGHT,
      alt: SITE_NAME,
    },
  ];

  return {
    title: fullTitle,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'pt_BR',
      title: fullTitle,
      description,
      url: canonical,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [imageUrl],
    },
  };
}
