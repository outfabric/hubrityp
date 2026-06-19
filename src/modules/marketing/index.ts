// Public API (barrel) for the `marketing` module — the public-site domain.
// External consumers import only from `@/modules/marketing`, never from
// internal paths. Header, footer, cookie-consent, plans config, and SEO
// helpers will be exported here as the module grows.
export { siteUrl, absoluteUrl } from './lib/site';
export { buildPageMetadata, SITE_NAME, DEFAULT_OG_IMAGE, type PageMetadataInput } from './lib/seo';
// Dark mode follows the OS `prefers-color-scheme` only — no toggle, no stored
// choice. Only the blocking no-flash script (and the Theme type) are exported.
export { buildNoFlashThemeScript, type Theme } from './lib/theme';
export { Container, CONTAINER_WIDTH_CLASS, type ContainerProps } from './components/container';
export { SkipLink, MAIN_CONTENT_ID, type SkipLinkProps } from './components/skip-link';
export { PublicHeader } from './components/public-header';
export {
  PublicHeaderClient,
  type PublicHeaderClientProps,
} from './components/public-header-client';
export { PublicFooter } from './components/public-footer';
export {
  CONSENT_COOKIE_NAME,
  CONSENT_COOKIE_MAX_AGE,
  parseConsent,
  readConsentCookie,
  serializeConsentCookie,
  type ConsentChoice,
} from './lib/cookie-consent';
export { withUtm, withUtmFromLocation } from './lib/utm';
export { CookieConsent } from './components/cookie-consent';
export { AnalyticsLoader } from './components/analytics-loader';
export { SignupCta, type SignupCtaProps } from './components/signup-cta';
export { LegalReviewNotice } from './components/legal-review-notice';
export {
  PLANS,
  FEATURE_KEYS,
  FEATURE_LABELS,
  PRICING_SUPPORT_EMAIL,
  planSlugSchema,
  featureKeySchema,
  emptyPlansFallback,
  type Plan,
  type PlanFeature,
  type PlanSlug,
  type FeatureKey,
  type EmptyPlansFallback,
} from './lib/plans';
