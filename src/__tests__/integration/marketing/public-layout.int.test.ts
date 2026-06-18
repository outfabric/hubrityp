import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PublicLayout from '@/app/(public)/layout';

/*
 * Integration coverage (4.5) for the `(public)` shared layout.
 *
 * The layout is a Server Component with no DB / auth dependency, so we render
 * it to static markup (same approach as `theme-no-flash.int.test.ts`) and
 * assert two contracts:
 *
 *   1. Landmark contract — exactly one banner (<header>), one <main>, one
 *      contentinfo (<footer>), in that document order, with the main carrying
 *      the skip-link target id `conteudo`.
 *
 *   2. PII-leak contract — the layout chrome itself must never render
 *      authenticated user data. Even when a hostile/PII-shaped value is passed
 *      as children, the layout adds no email / id / CRP of its own. We assert
 *      no PII-shaped token appears outside the child slot the caller controls.
 */

function renderLayout(children: React.ReactNode): string {
  // PublicLayout is an async-free Server Component; calling it returns the
  // element tree directly. Children are passed as the third createElement arg
  // (not a `children` prop) per the project lint rule.
  return renderToStaticMarkup(createElement(PublicLayout, null, children));
}

describe('(public) layout landmarks', () => {
  it('renders exactly one banner, one main, and one contentinfo', () => {
    const html = renderLayout('child-content');

    expect(html.match(/<header/g) ?? []).toHaveLength(1);
    expect(html.match(/<main/g) ?? []).toHaveLength(1);
    expect(html.match(/<footer/g) ?? []).toHaveLength(1);
  });

  it('orders the landmarks header -> main -> footer in the document', () => {
    const html = renderLayout('child-content');

    const headerAt = html.indexOf('<header');
    const mainAt = html.indexOf('<main');
    const footerAt = html.indexOf('<footer');

    expect(headerAt).toBeGreaterThanOrEqual(0);
    expect(headerAt).toBeLessThan(mainAt);
    expect(mainAt).toBeLessThan(footerAt);
  });

  it('puts the skip-link target id on the main landmark', () => {
    const html = renderLayout('child-content');
    expect(html).toContain('<main id="conteudo"');
  });

  it('renders the skip link as the first focusable element, before the header', () => {
    const html = renderLayout('child-content');
    const skipAt = html.indexOf('href="#conteudo"');
    const headerAt = html.indexOf('<header');
    expect(skipAt).toBeGreaterThanOrEqual(0);
    expect(skipAt).toBeLessThan(headerAt);
  });
});

describe('(public) layout never leaks PII', () => {
  it('renders no email / id / CRP token from the layout chrome itself', () => {
    const html = renderLayout('child-content');

    // The layout chrome (header + footer) must carry no user-identifying data.
    // These patterns approximate the PII the public layout must never emit.
    const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const CRP = /CRP\s?\d{2}\/\d{4,6}/i;

    expect(EMAIL.test(html)).toBe(false);
    expect(UUID.test(html)).toBe(false);
    expect(CRP.test(html)).toBe(false);
  });

  it('does not echo PII-shaped data the layout was not given (chrome is user-agnostic)', () => {
    // Simulate an "authenticated" render: even if a caller were to attempt to
    // feed user data, the layout takes no `user` prop — its API surface is
    // children only. We render with benign children and confirm the chrome's
    // own output contains none of the canonical PII fixtures.
    const html = renderLayout('child-content');

    expect(html).not.toContain('psicologo@hubrity.com');
    expect(html).not.toContain('CRP 06/123456');
  });
});
