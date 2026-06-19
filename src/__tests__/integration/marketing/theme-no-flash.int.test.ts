import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/*
 * No-flash dark-mode SSR proof (3.4, revised for decision D1).
 *
 * The dark-mode substrate is now driven SOLELY by the OS `prefers-color-scheme`
 * — there is no theme cookie, no localStorage, and no user-facing toggle (delta
 * spec: "the `data-theme` attribute on `<html>` ... driven SOLELY by the OS
 * `prefers-color-scheme`"). Because the server cannot know the OS preference, it
 * MUST NOT stamp a `data-theme` attribute on `<html>`; the blocking no-flash
 * inline script resolves it client-side before first paint.
 *
 * We render the real `RootLayout` Server Component to static markup and assert:
 *   1. No `data-theme` attribute is server-rendered on `<html>` (neither dark
 *      nor light) — the value is decided client-side by the script.
 *   2. The blocking no-flash inline script is present and reads
 *      `prefers-color-scheme` (not cookies / localStorage), and sets
 *      `data-theme` from that media query.
 *
 * `next/font/google` is mocked because its real implementation is a build-time
 * transform that does not run under Vitest; we only need the CSS-variable
 * contract it exposes to the layout.
 */

vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--ds-font-sans' }),
  Nunito: () => ({ variable: '--ds-font-wordmark' }),
}));

describe('RootLayout no-flash dark-mode SSR', () => {
  it('does not server-render a data-theme attribute on <html>', async () => {
    const { default: RootLayout } = await import('@/app/layout');
    const html = renderToStaticMarkup(RootLayout({ children: 'content' }));

    // The server cannot know the OS preference, so it renders no concrete theme
    // attribute on <html>; the blocking script resolves it before first paint.
    expect(html).not.toContain('data-theme="dark"');
    expect(html).not.toContain('data-theme="light"');
  });

  it('ships a blocking no-flash script that reads prefers-color-scheme', async () => {
    const { default: RootLayout } = await import('@/app/layout');
    const html = renderToStaticMarkup(RootLayout({ children: 'content' }));

    // The script must resolve the theme from the OS media query only — no cookie
    // or localStorage branch — and set the data-theme attribute client-side.
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('data-theme');
    expect(html).not.toMatch(/cookie/i);
    expect(html).not.toMatch(/localStorage/i);
  });
});
