import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type * as MarketingModule from '@/modules/marketing';

/*
 * Integration coverage (4.5) for the `(public)` shared layout.
 *
 * The layout renders the marketing chrome and asserts two contracts:
 *
 *   1. Landmark contract — exactly one banner (<header>), one <main>, one
 *      contentinfo (<footer>), in that document order, with the main carrying
 *      the skip-link target id `conteudo`.
 *
 *   2. PII-leak contract — the layout chrome itself must never render
 *      authenticated user data. Even when a hostile/PII-shaped value is passed
 *      as children, the layout adds no email / id / CRP of its own.
 *
 * Since section 6 the header (`PublicHeader`) is an async Server Component that
 * reads the Supabase session, and the layout mounts a `ThemeProvider`. To keep
 * this test focused on the LAYOUT contracts (landmarks + chrome PII) — the
 * header's own auth/PII behavior is covered by `public-header.int.test.ts` — we
 * substitute the header with a synchronous `<header>` stub and the provider
 * with a passthrough, so the synchronous `renderToStaticMarkup` does not
 * suspend on the header's async auth read.
 */

vi.mock('@/modules/marketing', async () => {
  const actual = await vi.importActual<typeof MarketingModule>('@/modules/marketing');
  return {
    ...actual,
    // Synchronous landmark-only stub (the real header's behavior is tested in
    // public-header.int.test.ts). Renders no user data.
    PublicHeader: () => createElement('header', null, 'header-chrome'),
    // Passthrough — the layout only needs the provider to mount its children.
    ThemeProvider: ({ children }: { children: ReactNode }) => children,
  };
});

async function renderLayout(children: ReactNode): Promise<string> {
  const { default: PublicLayout } = await import('@/app/(public)/layout');
  // Children are passed as the third createElement arg (not a `children` prop)
  // per the project lint rule.
  return renderToStaticMarkup(createElement(PublicLayout, null, children));
}

describe('(public) layout landmarks', () => {
  it('renders exactly one banner, one main, and one contentinfo', async () => {
    const html = await renderLayout('child-content');

    expect(html.match(/<header/g) ?? []).toHaveLength(1);
    expect(html.match(/<main/g) ?? []).toHaveLength(1);
    expect(html.match(/<footer/g) ?? []).toHaveLength(1);
  });

  it('orders the landmarks header -> main -> footer in the document', async () => {
    const html = await renderLayout('child-content');

    const headerAt = html.indexOf('<header');
    const mainAt = html.indexOf('<main');
    const footerAt = html.indexOf('<footer');

    expect(headerAt).toBeGreaterThanOrEqual(0);
    expect(headerAt).toBeLessThan(mainAt);
    expect(mainAt).toBeLessThan(footerAt);
  });

  it('puts the skip-link target id on the main landmark', async () => {
    const html = await renderLayout('child-content');
    expect(html).toContain('<main id="conteudo"');
  });

  it('renders the skip link as the first focusable element, before the header', async () => {
    const html = await renderLayout('child-content');
    const skipAt = html.indexOf('href="#conteudo"');
    const headerAt = html.indexOf('<header');
    expect(skipAt).toBeGreaterThanOrEqual(0);
    expect(skipAt).toBeLessThan(headerAt);
  });
});

describe('(public) layout never leaks PII', () => {
  it('renders no email / id / CRP token from the layout chrome itself', async () => {
    const html = await renderLayout('child-content');

    // The layout chrome (header + footer) must carry no user-identifying data.
    // These patterns approximate the PII the public layout must never emit.
    //
    // The footer publishes a STATIC support address (`suporte@hubrity.com.br`).
    // That is intentional public contact info, not user PII, so we strip the
    // single known support mailto before applying the EMAIL guard — any OTHER
    // email-shaped string (i.e. a real leaked user address) still fails.
    const SUPPORT_EMAIL = 'hubrity.platform@gmail.com';
    const htmlWithoutSupport = html.split(SUPPORT_EMAIL).join('');

    const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const CRP = /CRP\s?\d{2}\/\d{4,6}/i;

    expect(EMAIL.test(htmlWithoutSupport)).toBe(false);
    expect(UUID.test(html)).toBe(false);
    expect(CRP.test(html)).toBe(false);
  });

  it('does not echo PII-shaped data the layout was not given (chrome is user-agnostic)', async () => {
    // Simulate an "authenticated" render: even if a caller were to attempt to
    // feed user data, the layout takes no `user` prop — its API surface is
    // children only. We render with benign children and confirm the chrome's
    // own output contains none of the canonical PII fixtures.
    const html = await renderLayout('child-content');

    expect(html).not.toContain('psicologo@hubrity.com');
    expect(html).not.toContain('CRP 06/123456');
  });
});
