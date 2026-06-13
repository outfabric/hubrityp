import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';

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

export const metadata: Metadata = {
  title: 'Hubrity',
  description: 'Plataforma para psicólogos autônomos brasileiros.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
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
