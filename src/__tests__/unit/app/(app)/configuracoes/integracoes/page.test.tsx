import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { INTEGRATIONS } from '@/app/(app)/configuracoes/integracoes/integrations';
import IntegrationsIndexPage from '@/app/(app)/configuracoes/integracoes/page';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IntegrationsIndexPage', () => {
  it('renders h1 "Integrações" with correct diacritics', () => {
    render(<IntegrationsIndexPage />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Integrações');
    expect(heading).toHaveAttribute('data-testid', 'integrations-index-page-title');
  });

  it('renders the page container with correct testid', () => {
    render(<IntegrationsIndexPage />);

    expect(screen.getByTestId('integrations-index-page')).toBeInTheDocument();
  });

  it('renders 1 integration card for WhatsApp', () => {
    render(<IntegrationsIndexPage />);

    const card = screen.getByTestId('integration-card-whatsapp');
    expect(card).toBeInTheDocument();

    // Verify total count matches INTEGRATIONS data
    const allCards = INTEGRATIONS.map((i) => screen.getByTestId(`integration-card-${i.slug}`));
    expect(allCards).toHaveLength(1);
  });

  it('renders WhatsApp card with correct label, description, and href', () => {
    render(<IntegrationsIndexPage />);

    const card = screen.getByTestId('integration-card-whatsapp');

    // Label (h3)
    const heading = within(card).getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('WhatsApp');

    // Description with exact copy
    expect(
      within(card).getByText('Conecte sua conta para enviar lembretes e mensagens.'),
    ).toBeInTheDocument();

    // The card is wrapped in a link with correct href
    const link = card.closest('a');
    expect(link).toHaveAttribute('href', '/configuracoes/integracoes/whatsapp');
  });

  it('WhatsApp card contains a decorative Lucide icon (svg with aria-hidden)', () => {
    render(<IntegrationsIndexPage />);

    const card = screen.getByTestId('integration-card-whatsapp');
    const icon = card.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
