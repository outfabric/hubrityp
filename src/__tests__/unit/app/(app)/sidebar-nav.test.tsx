import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarNav } from '@/app/(app)/sidebar-nav';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const usePathnameMock = vi.fn<() => string>();

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock('next/link', () => ({
  // Render a plain <a> so we can assert href without the full Next.js router.
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/app/(app)/actions', () => ({
  getTotalUnreadCount: vi.fn().mockResolvedValue({ ok: true, totalUnread: 0 }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * The SidebarNav renders two <nav> elements: one for mobile (hidden via CSS)
 * and one for desktop. We scope queries to the desktop nav to avoid
 * "multiple elements" errors from duplicate nav items.
 */
function getDesktopNav(): HTMLElement {
  const navs = screen.getAllByRole('navigation', { name: 'Menu principal' });
  // Desktop nav is the second <nav> in the DOM (mobile nav comes first).
  return navs[1]!;
}

/**
 * Find the "Configurações" nav link within the desktop sidebar.
 */
function getSettingsLink(): HTMLElement {
  const nav = getDesktopNav();
  return within(nav).getByRole('link', { name: /Configurações/i });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SidebarNav — Configurações item', () => {
  beforeEach(() => {
    // Default: user is on dashboard (settings item is idle)
    usePathnameMock.mockReturnValue('/dashboard');
  });

  it('renders with the correct label "Configurações" (with diacritics)', () => {
    render(<SidebarNav />);

    const nav = getDesktopNav();
    // Must use the correct Portuguese spelling with cedilha and tilde
    expect(within(nav).getByText('Configurações')).toBeInTheDocument();
    // Must NOT render the old incorrect label without diacritics
    expect(within(nav).queryByText('Configuracoes')).not.toBeInTheDocument();
  });

  it('links to /configuracoes (not /configuracoes/locais)', () => {
    render(<SidebarNav />);

    const link = getSettingsLink();
    expect(link).toHaveAttribute('href', '/configuracoes');
  });

  it('uses the Settings icon (Lucide)', () => {
    render(<SidebarNav />);

    const link = getSettingsLink();
    // Lucide icons render as <svg> elements with aria-hidden="true".
    const icon = link.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('is active (brand styles) when pathname is /configuracoes', () => {
    usePathnameMock.mockReturnValue('/configuracoes');
    render(<SidebarNav />);

    const link = getSettingsLink();
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link.className).toContain('text-brand-700');
    expect(link.className).toContain('bg-brand-50');
  });

  it('is active on sub-routes like /configuracoes/lembretes/templates', () => {
    usePathnameMock.mockReturnValue('/configuracoes/lembretes/templates');
    render(<SidebarNav />);

    const link = getSettingsLink();
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link.className).toContain('text-brand-700');
    expect(link.className).toContain('bg-brand-50');
  });

  it('is idle (secondary text, no brand bg) when pathname is /dashboard', () => {
    usePathnameMock.mockReturnValue('/dashboard');
    render(<SidebarNav />);

    const link = getSettingsLink();
    expect(link).not.toHaveAttribute('aria-current');
    expect(link.className).toContain('text-text-secondary');
    expect(link.className).not.toContain('text-brand-700');
    expect(link.className).not.toContain('bg-brand-50');
  });
});
