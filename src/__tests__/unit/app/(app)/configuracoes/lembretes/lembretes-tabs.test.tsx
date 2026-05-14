import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LembretesTabs } from '@/app/(app)/configuracoes/lembretes/lembretes-tabs';

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LembretesTabs', () => {
  it('renders 3 tabs with correct labels and hrefs', () => {
    usePathnameMock.mockReturnValue('/configuracoes/lembretes');
    render(<LembretesTabs />);

    const tabs = screen.getAllByRole('link');
    expect(tabs).toHaveLength(3);

    expect(tabs[0]).toHaveTextContent('Configuração');
    expect(tabs[0]).toHaveAttribute('href', '/configuracoes/lembretes');

    expect(tabs[1]).toHaveTextContent('Templates');
    expect(tabs[1]).toHaveAttribute('href', '/configuracoes/lembretes/templates');

    expect(tabs[2]).toHaveTextContent('Histórico');
    expect(tabs[2]).toHaveAttribute('href', '/configuracoes/lembretes/historico');
  });

  it('renders the container with data-testid="lembretes-tabs"', () => {
    usePathnameMock.mockReturnValue('/configuracoes/lembretes');
    render(<LembretesTabs />);

    expect(screen.getByTestId('lembretes-tabs')).toBeInTheDocument();
  });

  it('renders each tab with the correct data-testid', () => {
    usePathnameMock.mockReturnValue('/configuracoes/lembretes');
    render(<LembretesTabs />);

    expect(screen.getByTestId('lembretes-tab-configuracao')).toBeInTheDocument();
    expect(screen.getByTestId('lembretes-tab-templates')).toBeInTheDocument();
    expect(screen.getByTestId('lembretes-tab-historico')).toBeInTheDocument();
  });

  it('marks "Configuração" as active on exact /configuracoes/lembretes', () => {
    usePathnameMock.mockReturnValue('/configuracoes/lembretes');
    render(<LembretesTabs />);

    const configTab = screen.getByTestId('lembretes-tab-configuracao');
    expect(configTab).toHaveAttribute('aria-current', 'page');

    const templatesTab = screen.getByTestId('lembretes-tab-templates');
    expect(templatesTab).not.toHaveAttribute('aria-current');

    const historicoTab = screen.getByTestId('lembretes-tab-historico');
    expect(historicoTab).not.toHaveAttribute('aria-current');
  });

  it('marks "Templates" as active on /configuracoes/lembretes/templates (exact)', () => {
    usePathnameMock.mockReturnValue('/configuracoes/lembretes/templates');
    render(<LembretesTabs />);

    const templatesTab = screen.getByTestId('lembretes-tab-templates');
    expect(templatesTab).toHaveAttribute('aria-current', 'page');

    const configTab = screen.getByTestId('lembretes-tab-configuracao');
    expect(configTab).not.toHaveAttribute('aria-current');
  });

  it('marks "Templates" as active on /configuracoes/lembretes/templates/lembrete_24h (startsWith match)', () => {
    usePathnameMock.mockReturnValue('/configuracoes/lembretes/templates/lembrete_24h');
    render(<LembretesTabs />);

    const templatesTab = screen.getByTestId('lembretes-tab-templates');
    expect(templatesTab).toHaveAttribute('aria-current', 'page');

    // Ensure no other tab is active
    const configTab = screen.getByTestId('lembretes-tab-configuracao');
    expect(configTab).not.toHaveAttribute('aria-current');

    const historicoTab = screen.getByTestId('lembretes-tab-historico');
    expect(historicoTab).not.toHaveAttribute('aria-current');
  });

  it('marks "Histórico" as active on exact /configuracoes/lembretes/historico', () => {
    usePathnameMock.mockReturnValue('/configuracoes/lembretes/historico');
    render(<LembretesTabs />);

    const historicoTab = screen.getByTestId('lembretes-tab-historico');
    expect(historicoTab).toHaveAttribute('aria-current', 'page');

    const configTab = screen.getByTestId('lembretes-tab-configuracao');
    expect(configTab).not.toHaveAttribute('aria-current');

    const templatesTab = screen.getByTestId('lembretes-tab-templates');
    expect(templatesTab).not.toHaveAttribute('aria-current');
  });
});
