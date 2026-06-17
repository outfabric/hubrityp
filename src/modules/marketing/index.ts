// Public API (barrel) for the `marketing` module — the public-site domain.
// External consumers import only from `@/modules/marketing`, never from
// internal paths. Header, footer, cookie-consent, theme-toggle, plans config,
// and SEO helpers will be exported here as the module grows.
export { siteUrl, absoluteUrl } from './lib/site';
export {
  THEME_COOKIE_NAME,
  THEME_COOKIE_MAX_AGE,
  parseStoredTheme,
  resolveTheme,
  serializeThemeCookie,
  buildNoFlashThemeScript,
  type Theme,
} from './lib/theme';
export { ThemeProvider, useTheme } from './components/theme-provider';
export { ThemeToggle } from './components/theme-toggle';
