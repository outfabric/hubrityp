// Public API (barrel) for the `marketing` module — the public-site domain.
// External consumers import only from `@/modules/marketing`, never from
// internal paths. Header, footer, cookie-consent, theme-toggle, plans config,
// and SEO helpers will be exported here as the module grows.
export { siteUrl, absoluteUrl } from './lib/site';
