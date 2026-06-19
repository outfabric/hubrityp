import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as RegistrationEdgeModule from '@/modules/registration/edge';

/*
 * Integration coverage (9.3) for the public legal pages — Política de
 * Privacidade (`/politica-de-privacidade`) and Termos de Uso (`/termos-de-uso`).
 *
 * Two contracts are asserted:
 *
 *   1. Negative-auth / gating — both routes are PUBLIC. An anonymous request
 *      passes through `middleware.ts` with a non-redirect, sub-300 response
 *      (no bounce to /login). These pages are a prerequisite for the consent
 *      and signup flows, so they MUST return 200 without a session.
 *
 *   2. Rendering — each page renders inside the `reading` (720px) Container,
 *      does NOT show any legal-review notice, exposes at least 8 sections, and carries
 *      the required heading anchors (the privacy page must anchor `#lgpd` and a
 *      cookies section; the terms page must anchor elegibilidade, planos,
 *      cancelamento, propriedade intelectual, responsabilidade, lei aplicável).
 *      Each page also exports a unique, non-empty SEO `metadata` (title +
 *      description + canonical).
 *
 * Pages are static Server Components with no Supabase access, so we render them
 * synchronously with `renderToStaticMarkup` (the integration env is `node`).
 */

// -- Middleware gating fixtures -----------------------------------------------

const { getUserMock, getCurrentProfileEdgeMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  getCurrentProfileEdgeMock: vi.fn(),
}));

const signOutMock = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));

vi.mock('@/shared/supabase/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return {
    createMiddlewareClient: vi.fn((request: NextRequest) => {
      const response = NextResponse.next({ request });
      return {
        supabase: {
          auth: {
            getUser: getUserMock,
            signOut: signOutMock,
          },
        },
        response,
      };
    }),
  };
});

vi.mock('@/modules/registration/edge', async (importOriginal) => {
  const actual = await importOriginal<typeof RegistrationEdgeModule>();
  return {
    ...actual,
    getCurrentProfileEdge: getCurrentProfileEdgeMock,
  };
});

beforeEach(() => {
  getUserMock.mockReset();
  getCurrentProfileEdgeMock.mockReset();
  signOutMock.mockReset();
  signOutMock.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.resetModules();
});

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

const LEGAL_ROUTES = [
  { path: '/politica-de-privacidade', label: '/politica-de-privacidade' },
  { path: '/termos-de-uso', label: '/termos-de-uso' },
] as const;

// -- Gating: anonymous -> 200 (no redirect to /login) -------------------------

describe('legal pages are public (anonymous -> pass, no /login redirect)', () => {
  it.each(LEGAL_ROUTES)('$label passes through anonymously without redirect', async ({ path }) => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
    getCurrentProfileEdgeMock.mockResolvedValue(null);

    const { middleware } = await import('@/middleware');
    const response = await middleware(makeRequest(path));

    // No redirect (location header absent) and a sub-300 (effectively 200)
    // status — the anonymous visitor is served the page, not bounced to login.
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBeLessThan(300);
  });
});

// -- Privacy policy page rendering --------------------------------------------

describe('Política de Privacidade page', () => {
  async function renderPage(): Promise<string> {
    const { default: PrivacyPolicyPage } =
      await import('@/app/(public)/politica-de-privacidade/page');
    return renderToStaticMarkup(createElement(PrivacyPolicyPage));
  }

  it('renders inside the reading-column (720px max-width)', async () => {
    const html = await renderPage();
    expect(html).toContain('max-w-[720px]');
  });

  it('does not show any legal-review notice', async () => {
    const html = await renderPage();
    expect(html).not.toContain('revisar com o jurídico');
    expect(html).not.toContain('Texto de referência');
  });

  it('renders at least 8 sections', async () => {
    const html = await renderPage();
    const sectionCount = (html.match(/<section/g) ?? []).length;
    expect(sectionCount).toBeGreaterThanOrEqual(8);
  });

  it('anchors the LGPD section as #lgpd', async () => {
    const html = await renderPage();
    expect(html).toContain('id="lgpd"');
    expect(html).toContain('LGPD');
  });

  it('includes a cookies section', async () => {
    const html = await renderPage();
    expect(html).toContain('id="cookies"');
    expect(html.toLowerCase()).toContain('cookies');
  });

  it('exports unique, non-empty SEO metadata with canonical', async () => {
    const { metadata } = await import('@/app/(public)/politica-de-privacidade/page');
    expect(metadata.title).toBe('Política de Privacidade | Hubrity');
    expect(typeof metadata.description).toBe('string');
    expect((metadata.description ?? '').length).toBeGreaterThan(0);
    expect(metadata.alternates?.canonical).toContain('/politica-de-privacidade');
  });
});

// -- Terms of use page rendering ----------------------------------------------

describe('Termos de Uso page', () => {
  async function renderPage(): Promise<string> {
    const { default: TermsOfUsePage } = await import('@/app/(public)/termos-de-uso/page');
    return renderToStaticMarkup(createElement(TermsOfUsePage));
  }

  it('renders inside the reading-column (720px max-width)', async () => {
    const html = await renderPage();
    expect(html).toContain('max-w-[720px]');
  });

  it('does not show any legal-review notice', async () => {
    const html = await renderPage();
    expect(html).not.toContain('revisar com o jurídico');
    expect(html).not.toContain('Texto de referência');
  });

  it('renders at least 8 sections', async () => {
    const html = await renderPage();
    const sectionCount = (html.match(/<section/g) ?? []).length;
    expect(sectionCount).toBeGreaterThanOrEqual(8);
  });

  it.each([
    { id: 'elegibilidade', label: 'elegibilidade (CRP ativo)' },
    { id: 'planos', label: 'planos' },
    { id: 'cancelamento', label: 'cancelamento' },
    { id: 'propriedade-intelectual', label: 'propriedade intelectual' },
    { id: 'limitacao-responsabilidade', label: 'responsabilidade' },
    { id: 'lei-aplicavel', label: 'lei aplicável / CDC' },
  ])('anchors the required "$label" section', async ({ id }) => {
    const html = await renderPage();
    expect(html).toContain(`id="${id}"`);
  });

  it('references the CRP eligibility and the CDC in the body', async () => {
    const html = await renderPage();
    expect(html).toContain('CRP');
    expect(html).toContain('Código de Defesa do Consumidor');
  });

  it('exports unique, non-empty SEO metadata with canonical', async () => {
    const { metadata } = await import('@/app/(public)/termos-de-uso/page');
    expect(metadata.title).toBe('Termos de Uso | Hubrity');
    expect(typeof metadata.description).toBe('string');
    expect((metadata.description ?? '').length).toBeGreaterThan(0);
    expect(metadata.alternates?.canonical).toContain('/termos-de-uso');
  });
});

// -- Cross-page uniqueness ----------------------------------------------------

describe('legal pages have distinct SEO metadata', () => {
  it('privacy and terms expose different titles and descriptions', async () => {
    const privacy = await import('@/app/(public)/politica-de-privacidade/page');
    const terms = await import('@/app/(public)/termos-de-uso/page');

    expect(privacy.metadata.title).not.toBe(terms.metadata.title);
    expect(privacy.metadata.description).not.toBe(terms.metadata.description);
  });
});
