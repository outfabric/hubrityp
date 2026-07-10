import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Subtask 5.2 — the "Caixa de entrada" sidebar entry is navigable when the
// WhatsApp UI flag is ON and frozen (non-navigable, "Em breve", no unread
// badge) when it is OFF. The committed `sidebar-nav.test.tsx` covers the
// flag-ON (default test env) behaviour; this file drives both flag states
// explicitly via `vi.stubEnv` + dynamic import, since `isInboxFrozen` is read
// from `clientEnv` at module-evaluation time.

// usePathname is mocked so the client component renders without a router.
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

// next/link rendered as a plain anchor so we can assert href without the
// Next.js router context.
vi.mock('next/link', () => ({
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

// The unread-count Server Action is mocked so the component never reaches the
// whatsapp module / database. `mockUnread` controls the polled value.
let mockUnread = 0;
vi.mock('@/app/(app)/actions', () => ({
  getTotalUnreadCount: vi.fn(() => Promise.resolve({ ok: true as const, totalUnread: mockUnread })),
}));

beforeEach(() => {
  vi.resetModules();
  mockUnread = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

/**
 * Renders SidebarNav after stubbing the WhatsApp UI flag. `vi.stubEnv` mutates
 * `process.env` in an isolated, auto-restorable way; combined with
 * `vi.resetModules()` the dynamically imported component re-parses `clientEnv`.
 */
async function renderSidebarNav(flag: 'true' | 'false') {
  vi.stubEnv('NEXT_PUBLIC_WHATSAPP_INBOX_UI_ENABLED', flag);
  const { SidebarNav } = await import('@/app/(app)/sidebar-nav');
  render(<SidebarNav />);
}

/** The desktop nav is the last "Menu principal" nav in the DOM. */
function desktopNav(): HTMLElement {
  const navs = screen.getAllByRole('navigation', { name: 'Menu principal' });
  return navs[navs.length - 1]!;
}

describe('SidebarNav — WhatsApp inbox freeze toggling', () => {
  describe('when the flag is ON', () => {
    it('renders "Caixa de entrada" as a navigable link without "Em breve"', async () => {
      await renderSidebarNav('true');

      const nav = desktopNav();
      const link = within(nav).getByRole('link', { name: /caixa de entrada/i });
      expect(link).toHaveAttribute('href', '/caixa-de-entrada');
      expect(link).not.toHaveAttribute('aria-disabled');
      expect(within(nav).queryByText('Em breve')).not.toBeInTheDocument();
    });

    it('shows the unread-count badge when there are unread conversations', async () => {
      mockUnread = 3;
      await renderSidebarNav('true');

      const nav = desktopNav();
      await waitFor(() => {
        expect(within(nav).getByLabelText('3 mensagens nao lidas')).toBeInTheDocument();
      });
    });
  });

  describe('when the flag is OFF', () => {
    it('renders "Caixa de entrada" as a frozen, non-navigable span', async () => {
      await renderSidebarNav('false');

      const nav = desktopNav();
      expect(
        within(nav).queryByRole('link', { name: /caixa de entrada/i }),
      ).not.toBeInTheDocument();

      const label = within(nav).getByText('Caixa de entrada');
      const entry = label.closest('[aria-disabled="true"]');
      expect(entry).not.toBeNull();
      expect(entry?.tagName).toBe('SPAN');
    });

    it('shows the neutral "Em breve" badge on the frozen item', async () => {
      await renderSidebarNav('false');

      const nav = desktopNav();
      const comingSoon = within(nav).getByText('Em breve');
      expect(comingSoon).toBeInTheDocument();
      // Badge variant="neutral" maps to the muted surface token.
      expect(comingSoon.className).toContain('bg-surface-muted');
    });

    it('never shows the unread-count badge while frozen, even with unread messages', async () => {
      mockUnread = 5;
      await renderSidebarNav('false');

      const nav = desktopNav();
      await waitFor(() => {
        expect(within(nav).getByText('Caixa de entrada')).toBeInTheDocument();
      });
      expect(within(nav).queryByLabelText(/mensagens nao lidas/i)).not.toBeInTheDocument();

      const entry = within(nav).getByText('Caixa de entrada').closest('span[aria-disabled="true"]');
      expect(entry).not.toBeNull();
      if (entry) {
        expect(within(entry as HTMLElement).queryByText('5')).not.toBeInTheDocument();
      }
    });

    it('keeps the other primary items navigable while the inbox is frozen', async () => {
      await renderSidebarNav('false');

      const nav = desktopNav();
      expect(within(nav).getByRole('link', { name: /painel/i })).toHaveAttribute(
        'href',
        '/dashboard',
      );
      expect(within(nav).getByRole('link', { name: /pacientes/i })).toHaveAttribute(
        'href',
        '/pacientes',
      );
      expect(within(nav).getByRole('link', { name: /agenda/i })).toHaveAttribute('href', '/agenda');
      expect(within(nav).getByRole('link', { name: /configurações/i })).toHaveAttribute(
        'href',
        '/configuracoes',
      );
    });
  });
});
