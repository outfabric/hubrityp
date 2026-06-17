import type { Metadata, Viewport } from 'next';
import { Inter, Nunito } from 'next/font/google';
import { cookies } from 'next/headers';
import { Toaster } from 'sonner';

import { THEME_COOKIE_NAME, buildNoFlashThemeScript, parseStoredTheme } from '@/modules/marketing';

import './globals.css';

/*
 * Inter is loaded via `next/font/google` so Next.js downloads the font files
 * at build time and self-hosts them under `/_next/static`. This eliminates
 * any runtime request to `fonts.googleapis.com` / `fonts.gstatic.com`,
 * matching the design-system substrate spec ("No external font request"
 * scenario) and our CSP `font-src 'self' data:` policy.
 *
 * `display: 'swap'` keeps text visible during the brief font-fetch window
 * with a system fallback (matching the `--ds-font-sans` fallback chain).
 *
 * The font is exposed as a CSS variable rather than a class so primitives
 * and Tailwind utilities can reference `var(--ds-font-sans)` consistently;
 * we override the `--ds-font-sans` runtime token with the Next.js-managed
 * value, keeping the `font-sans` Tailwind utility correct.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--ds-font-sans',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
});

/*
 * Nunito is the brand wordmark font ("hubrity"), loaded via `next/font/google`
 * so it is self-hosted at build time under `/_next/static` — no runtime request
 * to `fonts.googleapis.com` / `fonts.gstatic.com`, satisfying the CSP
 * `font-src 'self' data:` policy and the "Font is self-hosted" spec scenario.
 *
 * Scope: this font is exposed ONLY as `--ds-font-wordmark` and is referenced
 * exclusively by the brand wordmark (the `font-wordmark` utility / the Logo
 * text wordmark). Body and UI text MUST stay on Inter (`--ds-font-sans`); we do
 * NOT apply Nunito to `<body>`. Only the SemiBold weight (600) is loaded — the
 * single weight the wordmark uses — keeping the bundle minimal and honoring the
 * DS weight rule (400/600 only, never >=700).
 */
const nunito = Nunito({
  subsets: ['latin'],
  weight: ['600'],
  display: 'swap',
  variable: '--ds-font-wordmark',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
});

export const metadata: Metadata = {
  title: 'Hubrity',
  description: 'Plataforma para psicólogos autônomos brasileiros.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /*
   * Dark-mode substrate (D4). Two cooperating mechanisms keep the page free of
   * a flash-of-wrong-theme (FOUC):
   *
   *  1. For returning visitors with an explicit choice, we read the `theme`
   *     cookie server-side and render `data-theme` directly onto `<html>`, so
   *     the very first byte streamed already carries the right theme — no
   *     client round-trip, no flash.
   *
   *  2. For first visits (no cookie), the theme depends on the OS
   *     `prefers-color-scheme`, which the server cannot know. The blocking
   *     inline script in `<head>` resolves it (cookie -> OS -> light) and sets
   *     `data-theme` before first paint. When the cookie is present, the script
   *     simply re-affirms the same value the server already rendered.
   */
  const cookieStore = await cookies();
  const storedTheme = parseStoredTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);

  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${nunito.variable}`}
      {...(storedTheme ? { 'data-theme': storedTheme } : {})}
    >
      <head>
        {/*
         * Blocking, synchronous theme resolution. Injected as a raw string via
         * `dangerouslySetInnerHTML` so it executes before first paint (a React
         * element child would not be inline-executed early enough). The content
         * is a fixed, build-time string with no user/interpolated data, so it
         * is not an XSS sink.
         */}
        <script dangerouslySetInnerHTML={{ __html: buildNoFlashThemeScript() }} />
      </head>
      <body className="bg-background text-text-primary min-h-screen font-sans antialiased">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            classNames: {
              toast: 'bg-surface border border-border shadow-md rounded-lg',
              success: 'border-l-4 border-l-success-500',
              error: 'border-l-4 border-l-danger-500',
              warning: 'border-l-4 border-l-warning-500',
            },
          }}
        />
      </body>
    </html>
  );
}
