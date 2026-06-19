import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Integration coverage (6.6) for the public header's server boundary.
 *
 * `PublicHeader` is an async Server Component whose only server job is to read
 * a boolean "is authenticated" from the Supabase session via
 * `supabase.auth.getUser()`. We mock that client at the module boundary (same
 * approach as `api-me.int.test.ts`) to stage anonymous vs. authenticated
 * sessions and render the component to static markup — the HTML that would be
 * served to the browser.
 *
 * Contracts asserted:
 *   1. Authenticated request → "Acessar plataforma" → /dashboard, and the
 *      render performs NO redirect (renderToStaticMarkup completes normally;
 *      a `redirect()` call would throw the Next redirect error).
 *   2. Anonymous request → "Entrar" (/login) + "Começar grátis" (/signup).
 *   3. The served HTML carries no PII (email / UUID / CRP), even when the
 *      mocked session user is rich with PII-shaped fields.
 */

const getUserMock = vi.fn();

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: getUserMock,
    },
  }),
}));

// `next/font` does not run under Vitest; the header pulls it transitively only
// via the Logo (inline SVG, no font) so no font mock is needed here. We mock
// `next/headers` defensively in case any transitive import touches cookies.
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), getAll: vi.fn().mockReturnValue([]) }),
}));

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CRP = /CRP\s?\d{2}\/\d{4,6}/i;

async function renderHeader(): Promise<string> {
  const { PublicHeader } = await import('@/modules/marketing/components/public-header');
  // PublicHeader is async; awaiting it resolves the server auth check. If it
  // ever called redirect(), this await would reject — proving "no redirect".
  // The header no longer depends on a ThemeProvider (dark mode is OS-driven,
  // there is no theme context), so the resolved element renders standalone.
  const element = await PublicHeader();
  return renderToStaticMarkup(element);
}

beforeEach(() => {
  getUserMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('PublicHeader — authenticated visitor', () => {
  it('renders "Acessar plataforma" → /dashboard and performs no redirect', async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          email: 'psicologo@hubrity.com',
        },
      },
      error: null,
    });

    const html = await renderHeader();

    expect(html).toContain('Acessar plataforma');
    expect(html).toContain('href="/dashboard"');
    // The anonymous CTAs must be absent for an authenticated visitor.
    expect(html).not.toContain('href="/signup"');
  });

  it('leaks no PII into the served HTML even with a PII-rich session user', async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: {
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          email: 'psicologo@hubrity.com',
          user_metadata: { crp: 'CRP 06/123456', full_name: 'Dra. Fulana' },
        },
      },
      error: null,
    });

    const html = await renderHeader();

    expect(EMAIL.test(html)).toBe(false);
    expect(UUID.test(html)).toBe(false);
    expect(CRP.test(html)).toBe(false);
    expect(html).not.toContain('psicologo@hubrity.com');
    expect(html).not.toContain('Dra. Fulana');
  });
});

describe('PublicHeader — anonymous visitor', () => {
  it('renders "Entrar" (/login) and "Começar grátis" (/signup)', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const html = await renderHeader();

    expect(html).toContain('Entrar');
    expect(html).toContain('href="/login"');
    expect(html).toContain('Começar grátis');
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain('Acessar plataforma');
  });

  it('renders no PII for the anonymous case', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const html = await renderHeader();

    expect(EMAIL.test(html)).toBe(false);
    expect(UUID.test(html)).toBe(false);
    expect(CRP.test(html)).toBe(false);
  });

  it('ships a <noscript> fallback carrying the nav links inline', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const html = await renderHeader();

    // The <noscript> body is only meaningful in SSR HTML; assert it carries the
    // nav destinations so the menu works without client JS.
    const noscriptMatch = html.match(/<noscript>([\s\S]*?)<\/noscript>/);
    expect(noscriptMatch).not.toBeNull();
    const fallback = noscriptMatch?.[1] ?? '';
    expect(fallback).toContain('Funcionalidades');
    expect(fallback).toContain('href="/precos"');
    expect(fallback).toContain('href="/login"');
  });
});

describe('PublicHeader — Figma 128:3 chrome fidelity', () => {
  it('renders no theme-toggle control in the served HTML (OS-driven dark mode)', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const html = await renderHeader();

    // The former toggle exposed these pt-BR accessible names + lucide icons; the
    // chrome must now carry no theme control at all.
    expect(html).not.toContain('Ativar tema claro');
    expect(html).not.toContain('Ativar tema escuro');
  });

  it('renders "Entrar" as the DS secondary bordered button (not a ghost)', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });

    const html = await renderHeader();

    // At least one `/login` anchor must carry the secondary variant's bordered
    // surface classes (the styled "Entrar" CTA, as opposed to the plain
    // <noscript> text link). Scan every `/login` anchor open-tag for the marker.
    const loginAnchorTags = html.match(/<a[^>]*href="\/login"[^>]*>/g) ?? [];
    expect(loginAnchorTags.length).toBeGreaterThan(0);
    const hasSecondaryEntrar = loginAnchorTags.some(
      (tag) => tag.includes('border-border-strong') && tag.includes('bg-surface'),
    );
    expect(hasSecondaryEntrar).toBe(true);
  });
});
