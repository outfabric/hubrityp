import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PublicHeaderClient } from '@/modules/marketing/components/public-header-client';
import { ThemeProvider } from '@/modules/marketing/components/theme-provider';

/*
 * PublicHeaderClient (leaf) — DOM behavior (task 6.5).
 *
 * Covers the spec contracts that can be exercised in jsdom:
 *   - link destinations (logo, Funcionalidades, Preços, auth CTAs);
 *   - scrolled-state class swap WITHOUT any backdrop-filter/blur (DS rule);
 *   - hamburger ARIA (aria-expanded / aria-controls) + Escape-to-close;
 *   - anon-vs-auth CTA swap (Entrar/Começar grátis ↔ Acessar plataforma).
 *
 * The header consumes `ThemeToggle`, which requires a ThemeProvider; we wrap
 * with the real provider (same approach as theme-toggle.test.tsx).
 */

function renderHeader(isAuthenticated: boolean) {
  return render(
    <ThemeProvider>
      <PublicHeaderClient isAuthenticated={isAuthenticated} />
    </ThemeProvider>,
  );
}

function hrefOf(name: RegExp | string): string | null {
  const link = screen.getAllByRole('link', { name }).at(0);
  return link ? link.getAttribute('href') : null;
}

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'light');
  window.scrollY = 0;
});

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('PublicHeaderClient — link destinations', () => {
  it('points the logo at "/" and the nav links at the spec destinations', () => {
    renderHeader(false);

    expect(hrefOf('Hubrity — página inicial')).toBe('/');
    expect(hrefOf(/Funcionalidades/i)).toBe('/#funcionalidades');
    expect(hrefOf(/Preços/i)).toBe('/precos');
  });
});

describe('PublicHeaderClient — anonymous CTAs', () => {
  it('renders "Entrar" → /login and "Começar grátis" → /signup', () => {
    renderHeader(false);

    expect(hrefOf(/Entrar/i)).toBe('/login');
    expect(hrefOf(/Começar grátis/i)).toBe('/signup');
    expect(screen.queryAllByRole('link', { name: /Acessar plataforma/i })).toHaveLength(0);
  });
});

describe('PublicHeaderClient — authenticated CTA swap', () => {
  it('replaces the auth pair with "Acessar plataforma" → /dashboard and renders no PII', () => {
    const { container } = renderHeader(true);

    expect(hrefOf(/Acessar plataforma/i)).toBe('/dashboard');
    expect(screen.queryAllByRole('link', { name: /^Começar grátis$/i })).toHaveLength(0);

    // The auth render must never carry user-identifying data.
    const html = container.innerHTML;
    expect(/[\w.+-]+@[\w-]+\.[\w.-]+/.test(html)).toBe(false);
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(html)).toBe(false);
    expect(/CRP\s?\d{2}\/\d{4,6}/i.test(html)).toBe(false);
  });
});

describe('PublicHeaderClient — scrolled state (no blur)', () => {
  it('is transparent at scroll 0 and solid-opaque after scroll, never using backdrop-filter', () => {
    const { container } = renderHeader(false);
    const header = container.querySelector('header');
    expect(header).not.toBeNull();
    const headerEl = header as HTMLElement;

    // At top: transparent, no surface/border/shadow.
    expect(headerEl.dataset.scrolled).toBe('false');
    expect(headerEl.className).toContain('bg-transparent');
    expect(headerEl.className).not.toContain('bg-surface');

    // Simulate scrolling down past the hero.
    act(() => {
      window.scrollY = 200;
      window.dispatchEvent(new Event('scroll'));
    });

    // The state-driven class set must flip to the solid-opaque surface.
    expect(headerEl.dataset.scrolled).toBe('true');
    expect(headerEl.className).toContain('bg-surface');
    expect(headerEl.className).toContain('border-b');
    expect(headerEl.className).toContain('shadow-xs');

    // DS prohibition: no blur in any state.
    expect(headerEl.className).not.toMatch(/backdrop-blur|backdrop-filter/);
  });
});

describe('PublicHeaderClient — mobile hamburger', () => {
  it('exposes aria-expanded/aria-controls and toggles the panel', async () => {
    const user = userEvent.setup();
    renderHeader(false);

    const toggle = screen.getByRole('button', { name: 'Abrir menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const controls = toggle.getAttribute('aria-controls');
    expect(controls).toBeTruthy();

    // Panel is not rendered while closed.
    expect(document.getElementById(controls as string)).toBeNull();

    await user.click(toggle);

    const openToggle = screen.getByRole('button', { name: 'Fechar menu' });
    expect(openToggle).toHaveAttribute('aria-expanded', 'true');
    const panel = document.getElementById(controls as string);
    expect(panel).not.toBeNull();
    // The mobile menu duplicates the nav links inside the panel.
    expect(within(panel as HTMLElement).getByRole('link', { name: /Preços/i })).toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the toggle', async () => {
    const user = userEvent.setup();
    renderHeader(false);

    const toggle = screen.getByRole('button', { name: 'Abrir menu' });
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Fechar menu' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: 'Abrir menu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir menu' })).toHaveFocus();
  });

  it('keeps a persistent primary CTA visible in the bar (mobile)', () => {
    renderHeader(false);
    // "Começar grátis" appears in both the desktop cluster and the mobile bar;
    // at least one instance is always present regardless of menu state.
    expect(screen.getAllByRole('link', { name: /Começar grátis/i }).length).toBeGreaterThan(0);
  });

  it('renders a <noscript> inline-links fallback element', () => {
    const { container } = renderHeader(false);
    // React does not project element children into <noscript> during a
    // client-side (jsdom) render — the content model treats them as text when
    // scripting is enabled — so here we only assert the element is present. The
    // serialized fallback markup (with the actual links) is asserted in the SSR
    // integration test (`public-header.int.test.ts`), which is where the
    // <noscript> body is meaningful.
    expect(container.querySelector('noscript')).not.toBeNull();
  });
});
