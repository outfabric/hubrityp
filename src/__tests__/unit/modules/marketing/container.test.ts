import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Container, CONTAINER_WIDTH_CLASS } from '@/modules/marketing/components/container';
import { MAIN_CONTENT_ID, SkipLink } from '@/modules/marketing/components/skip-link';

/*
 * Unit coverage (4.4) for the public-site layout primitives:
 *   - Container width/padding variants (1200px default, 720px reading), and
 *   - the skip link's target (#conteudo) matching the layout's <main> id.
 *
 * Rendered to static markup so we assert on the class contract the layout
 * relies on, without a DOM.
 */

describe('Container width variants', () => {
  it('maps the default width to the 1200px cap', () => {
    expect(CONTAINER_WIDTH_CLASS.default).toBe('max-w-[1200px]');
  });

  it('maps the reading width to the 720px cap', () => {
    expect(CONTAINER_WIDTH_CLASS.reading).toBe('max-w-[720px]');
  });

  it('renders the default (1200px) width when no variant is given', () => {
    const html = renderToStaticMarkup(createElement(Container, null, 'body'));
    expect(html).toContain('max-w-[1200px]');
    expect(html).not.toContain('max-w-[720px]');
  });

  it('renders the 720px cap for the reading variant', () => {
    const html = renderToStaticMarkup(createElement(Container, { width: 'reading' }, 'body'));
    expect(html).toContain('max-w-[720px]');
    expect(html).not.toContain('max-w-[1200px]');
  });

  it('applies responsive horizontal padding (16px mobile / 32px desktop)', () => {
    const html = renderToStaticMarkup(createElement(Container, null, 'body'));
    // px-4 -> space/4 (16px) mobile; md:px-8 -> space/8 (32px) desktop.
    expect(html).toContain('px-4');
    expect(html).toContain('md:px-8');
  });

  it('centers content and forwards a custom className', () => {
    const html = renderToStaticMarkup(
      createElement(Container, { className: 'custom-marker' }, 'body'),
    );
    expect(html).toContain('mx-auto');
    expect(html).toContain('custom-marker');
  });
});

describe('SkipLink target', () => {
  it('targets the #conteudo anchor that the layout puts on <main>', () => {
    expect(MAIN_CONTENT_ID).toBe('conteudo');
    const html = renderToStaticMarkup(createElement(SkipLink));
    expect(html).toContain(`href="#${MAIN_CONTENT_ID}"`);
  });

  it('renders the Portuguese skip-link label', () => {
    const html = renderToStaticMarkup(createElement(SkipLink));
    expect(html).toContain('Pular para o conteúdo');
  });

  it('is visually hidden until focused (sr-only + focus:not-sr-only)', () => {
    const html = renderToStaticMarkup(createElement(SkipLink));
    expect(html).toContain('sr-only');
    expect(html).toContain('focus:not-sr-only');
  });
});
