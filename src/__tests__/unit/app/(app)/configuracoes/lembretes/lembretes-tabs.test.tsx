import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The "Templates" tab is gated by `NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED`,
// read from `clientEnv` at module-evaluation time. To exercise both flag
// states we stub the env with `vi.stubEnv` and re-import the component after
// `vi.resetModules()` so the dynamically imported module re-parses `clientEnv`.

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const usePathnameMock = vi.fn<() => string>();

vi.mock('next/navigation', () => ({
  usePathname: () => usePathnameMock(),
}));

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Renders LembretesTabs after stubbing the connection UI flag. `vi.stubEnv`
 * mutates `process.env` in an isolated, auto-restorable way; combined with
 * `vi.resetModules()` the dynamically imported component re-parses `clientEnv`.
 */
async function renderTabs(flag: 'true' | 'false', pathname = '/configuracoes/lembretes') {
  usePathnameMock.mockReturnValue(pathname);
  vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED', flag);
  const { LembretesTabs } = await import('@/app/(app)/configuracoes/lembretes/lembretes-tabs');
  render(<LembretesTabs />);
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LembretesTabs — Templates tab gated by connection UI flag', () => {
  describe('when the connection UI flag is OFF (MVP default)', () => {
    it('renders only "Configuração" and "Histórico" — no Templates element at all', async () => {
      await renderTabs('false');

      const tabs = screen.getAllByRole('link');
      expect(tabs).toHaveLength(2);
      expect(tabs[0]).toHaveTextContent('Configuração');
      expect(tabs[1]).toHaveTextContent('Histórico');

      // The Templates tab must be fully hidden — not a disabled "Em breve".
      expect(screen.queryByTestId('lembretes-tab-templates')).not.toBeInTheDocument();
      expect(screen.queryByText('Templates')).not.toBeInTheDocument();
      expect(screen.queryByText('Em breve')).not.toBeInTheDocument();

      // The other two tabs remain present.
      expect(screen.getByTestId('lembretes-tab-configuracao')).toBeInTheDocument();
      expect(screen.getByTestId('lembretes-tab-historico')).toBeInTheDocument();
    });

    it('keeps active-tab logic working for the two visible tabs', async () => {
      await renderTabs('false', '/configuracoes/lembretes/historico');

      expect(screen.getByTestId('lembretes-tab-historico')).toHaveAttribute('aria-current', 'page');
      expect(screen.getByTestId('lembretes-tab-configuracao')).not.toHaveAttribute('aria-current');
    });
  });

  describe('when the connection UI flag is ON', () => {
    it('renders all three tabs with correct labels and hrefs', async () => {
      await renderTabs('true');

      const tabs = screen.getAllByRole('link');
      expect(tabs).toHaveLength(3);

      expect(tabs[0]).toHaveTextContent('Configuração');
      expect(tabs[0]).toHaveAttribute('href', '/configuracoes/lembretes');

      expect(tabs[1]).toHaveTextContent('Templates');
      expect(tabs[1]).toHaveAttribute('href', '/configuracoes/lembretes/templates');

      expect(tabs[2]).toHaveTextContent('Histórico');
      expect(tabs[2]).toHaveAttribute('href', '/configuracoes/lembretes/historico');
    });

    it('renders each tab with the correct data-testid', async () => {
      await renderTabs('true');

      expect(screen.getByTestId('lembretes-tab-configuracao')).toBeInTheDocument();
      expect(screen.getByTestId('lembretes-tab-templates')).toBeInTheDocument();
      expect(screen.getByTestId('lembretes-tab-historico')).toBeInTheDocument();
    });

    it('marks "Templates" as active on /configuracoes/lembretes/templates (exact)', async () => {
      await renderTabs('true', '/configuracoes/lembretes/templates');

      expect(screen.getByTestId('lembretes-tab-templates')).toHaveAttribute('aria-current', 'page');
      expect(screen.getByTestId('lembretes-tab-configuracao')).not.toHaveAttribute('aria-current');
    });

    it('marks "Templates" as active on a nested template edit path (startsWith match)', async () => {
      await renderTabs('true', '/configuracoes/lembretes/templates/lembrete_24h');

      expect(screen.getByTestId('lembretes-tab-templates')).toHaveAttribute('aria-current', 'page');
      expect(screen.getByTestId('lembretes-tab-configuracao')).not.toHaveAttribute('aria-current');
      expect(screen.getByTestId('lembretes-tab-historico')).not.toHaveAttribute('aria-current');
    });
  });

  describe('shared behaviour', () => {
    it('renders the container with data-testid="lembretes-tabs" regardless of flag', async () => {
      await renderTabs('false');
      expect(screen.getByTestId('lembretes-tabs')).toBeInTheDocument();
    });

    it('marks "Configuração" as active on exact /configuracoes/lembretes', async () => {
      await renderTabs('true', '/configuracoes/lembretes');

      expect(screen.getByTestId('lembretes-tab-configuracao')).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByTestId('lembretes-tab-templates')).not.toHaveAttribute('aria-current');
      expect(screen.getByTestId('lembretes-tab-historico')).not.toHaveAttribute('aria-current');
    });
  });
});
