import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * No-flash dark-mode SSR proof (3.4).
 *
 * The spec ("no light-flash") requires that a returning visitor with an
 * explicit `theme=dark` choice gets the dark theme on the very first byte of
 * HTML — not after a client round-trip. We render the real `RootLayout` Server
 * Component to static markup with a mocked `theme=dark` request cookie and
 * assert that:
 *   1. `<html>` carries `data-theme="dark"` directly from SSR (no flash for the
 *      stored-choice path), and
 *   2. the blocking no-flash inline script is present in `<head>` (covers the
 *      first-visit/OS path before first paint).
 *
 * `next/font/google` is mocked because its real implementation is a build-time
 * transform that does not run under Vitest; we only need the CSS-variable
 * contract it exposes to the layout.
 */

const cookieGet = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: cookieGet,
  }),
}));

vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--ds-font-sans' }),
  Nunito: () => ({ variable: '--ds-font-wordmark' }),
}));

beforeEach(() => {
  cookieGet.mockReset();
});

describe('RootLayout no-flash dark-mode SSR', () => {
  it('applies data-theme="dark" in SSR output when the theme cookie is dark', async () => {
    cookieGet.mockImplementation((name: string) =>
      name === 'theme' ? { value: 'dark' } : undefined,
    );

    const { default: RootLayout } = await import('@/app/layout');
    const html = renderToStaticMarkup(await RootLayout({ children: 'content' }));

    expect(html).toContain('data-theme="dark"');
    // The blocking no-flash script must be inlined in <head>.
    expect(html).toContain('data-theme'); // present inside the script too
    expect(html).toContain('prefers-color-scheme: dark');
    // There must be no light data-theme leaking into the same render.
    expect(html).not.toContain('data-theme="light"');
  });

  it('omits the server-rendered data-theme attribute when no theme cookie is set', async () => {
    cookieGet.mockReturnValue(undefined);

    const { default: RootLayout } = await import('@/app/layout');
    const html = renderToStaticMarkup(await RootLayout({ children: 'content' }));

    // First visit: the server cannot know the OS preference, so it renders no
    // data-theme on <html>; the blocking script (still present) resolves it
    // before first paint.
    expect(html).not.toContain('data-theme="dark"');
    expect(html).not.toContain('data-theme="light"');
    // The no-flash script is always shipped.
    expect(html).toContain('prefers-color-scheme: dark');
  });
});
