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
export {
  ScreenshotCarousel,
  type ScreenshotCarouselProps,
  type CarouselSlide,
} from './components/home/screenshot-carousel';
export { Hero } from './components/home/hero';
export { ProvaSocial } from './components/home/prova-social';
export { Problema } from './components/home/problema';
export { SolucaoTimeline } from './components/home/solucao-timeline';
export { Funcionalidades } from './components/home/funcionalidades';
export { DestaqueIa } from './components/home/destaque-ia';
export { Confianca } from './components/home/confianca';
export { PrecosResumo } from './components/home/precos-resumo';
export { Faq } from './components/home/faq';
export { CtaFinal } from './components/home/cta-final';
export {
  ScreenshotLightbox,
  type ScreenshotLightboxProps,
  type LightboxScreenshot,
} from './components/home/screenshot-lightbox';
export {
  PLANS,
  FEATURE_KEYS,
  FEATURE_LABELS,
  PLAN_SLUGS,
  PRICING_SUPPORT_EMAIL,
  planSlugSchema,
  featureKeySchema,
  emptyPlansFallback,
  getComparisonMatrix,
  isKnownPlanSlug,
  type Plan,
  type PlanFeature,
  type PlanSlug,
  type FeatureKey,
  type EmptyPlansFallback,
  type ComparisonRow,
} from './lib/plans';
export { PRICING_PAGE, BILLING_FAQ_ENTRIES } from './lib/pricing-content';
export { PlanCards } from './components/pricing/plan-cards';
export {
  HERO,
  SOCIAL_PROOF_STATS,
  PROBLEM,
  SOLUTION_STEPS,
  SOLUTION_CLOSER,
  FEATURE_CARDS,
  AI_HIGHLIGHT,
  TRUST,
  PRICING_SUMMARY,
  FAQ_ENTRIES,
  FINAL_CTA,
  SCREENSHOTS,
  HERO_CAROUSEL_SLIDES,
  type HomeCta,
  type SocialProofStat,
  type LucideIconName,
  type SolutionStep,
  type FeatureCard,
  type TrustItem,
  type RegulatoryGuarantee,
  type FaqEntry,
  type ScreenshotKey,
  type ScreenshotAsset,
} from './lib/home-content';
