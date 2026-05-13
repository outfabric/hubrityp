import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsBreadcrumb } from '@/app/(app)/configuracoes/settings-breadcrumb';

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

function getBreadcrumbNav(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Breadcrumb' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsBreadcrumb', () => {
  it('renders only "Configuracoes" as current (non-link) on /configuracoes', () => {
    usePathnameMock.mockReturnValue('/configuracoes');
    render(<SettingsBreadcrumb />);

    const nav = getBreadcrumbNav();
    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(1);

    // The single segment is the current page (non-link).
    const current = within(nav).getByText('Configurações');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.tagName).toBe('SPAN');

    // No links should be present on the index page.
    expect(within(nav).queryAllByRole('link')).toHaveLength(0);
  });

  it('renders correct trail for /configuracoes/locais', () => {
    usePathnameMock.mockReturnValue('/configuracoes/locais');
    render(<SettingsBreadcrumb />);

    const nav = getBreadcrumbNav();
    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(2);

    // First segment is a link.
    const configLink = within(nav).getByRole('link', { name: 'Configurações' });
    expect(configLink).toHaveAttribute('href', '/configuracoes');

    // Last segment is the current page (non-link).
    const current = within(nav).getByText('Locais de atendimento');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.tagName).toBe('SPAN');
  });

  it('renders correct trail for /configuracoes/lembretes/templates', () => {
    usePathnameMock.mockReturnValue('/configuracoes/lembretes/templates');
    render(<SettingsBreadcrumb />);

    const nav = getBreadcrumbNav();
    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(3);

    // First two segments are links.
    const configLink = within(nav).getByRole('link', { name: 'Configurações' });
    expect(configLink).toHaveAttribute('href', '/configuracoes');

    const lembretesLink = within(nav).getByRole('link', { name: 'Lembretes' });
    expect(lembretesLink).toHaveAttribute('href', '/configuracoes/lembretes');

    // Last segment is the current page.
    const current = within(nav).getByText('Templates');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.tagName).toBe('SPAN');
  });

  it('renders correct trail for /configuracoes/integracoes/whatsapp', () => {
    usePathnameMock.mockReturnValue('/configuracoes/integracoes/whatsapp');
    render(<SettingsBreadcrumb />);

    const nav = getBreadcrumbNav();
    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(3);

    const configLink = within(nav).getByRole('link', { name: 'Configurações' });
    expect(configLink).toHaveAttribute('href', '/configuracoes');

    const integracoesLink = within(nav).getByRole('link', { name: 'Integrações' });
    expect(integracoesLink).toHaveAttribute('href', '/configuracoes/integracoes');

    const current = within(nav).getByText('WhatsApp');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.tagName).toBe('SPAN');
  });

  it('renders correct trail for /configuracoes/integracoes', () => {
    usePathnameMock.mockReturnValue('/configuracoes/integracoes');
    render(<SettingsBreadcrumb />);

    const nav = getBreadcrumbNav();
    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(2);

    const configLink = within(nav).getByRole('link', { name: 'Configurações' });
    expect(configLink).toHaveAttribute('href', '/configuracoes');

    const current = within(nav).getByText('Integrações');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.tagName).toBe('SPAN');
  });

  it('renders unknown/dynamic segments as raw value', () => {
    usePathnameMock.mockReturnValue('/configuracoes/lembretes/templates/lembrete_24h');
    render(<SettingsBreadcrumb />);

    const nav = getBreadcrumbNav();
    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(4);

    // The dynamic segment renders as its raw value (no label mapping).
    const current = within(nav).getByText('lembrete_24h');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.tagName).toBe('SPAN');
  });

  it('marks the last segment with aria-current="page" and renders it as non-link', () => {
    usePathnameMock.mockReturnValue('/configuracoes/locais');
    render(<SettingsBreadcrumb />);

    const nav = getBreadcrumbNav();

    // Last segment should NOT be a link.
    const links = within(nav).getAllByRole('link');
    const linkTexts = links.map((link) => link.textContent);
    expect(linkTexts).not.toContain('Locais de atendimento');

    // It should have aria-current.
    const current = within(nav).getByText('Locais de atendimento');
    expect(current).toHaveAttribute('aria-current', 'page');
  });

  it('renders intermediate segments as links', () => {
    usePathnameMock.mockReturnValue('/configuracoes/lembretes/templates');
    render(<SettingsBreadcrumb />);

    const nav = getBreadcrumbNav();
    const links = within(nav).getAllByRole('link');

    // "Configuracoes" and "Lembretes" should be links.
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/configuracoes');
    expect(links[1]).toHaveAttribute('href', '/configuracoes/lembretes');
  });

  it('renders separator icons with aria-hidden', () => {
    usePathnameMock.mockReturnValue('/configuracoes/locais');
    render(<SettingsBreadcrumb />);

    const nav = getBreadcrumbNav();
    const svgs = nav.querySelectorAll('svg');

    // One separator between "Configuracoes" and "Locais de atendimento".
    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toHaveAttribute('aria-hidden', 'true');
  });
});
