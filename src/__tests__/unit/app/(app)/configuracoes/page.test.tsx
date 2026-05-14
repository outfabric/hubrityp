import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SettingsIndexPage from '@/app/(app)/configuracoes/page';
import { SETTINGS_AREAS } from '@/app/(app)/configuracoes/settings-areas';

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

describe('SettingsIndexPage', () => {
  it('renders h1 "Configurações" with correct diacritics', () => {
    render(<SettingsIndexPage />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Configurações');
    expect(heading).toHaveAttribute('data-testid', 'settings-index-page-title');
  });

  it('renders the page container with correct testid', () => {
    render(<SettingsIndexPage />);

    expect(screen.getByTestId('settings-index-page')).toBeInTheDocument();
  });

  it('renders exactly 4 settings area cards', () => {
    render(<SettingsIndexPage />);

    const cards = SETTINGS_AREAS.map((area) =>
      screen.getByTestId(`settings-area-card-${area.slug}`),
    );
    expect(cards).toHaveLength(4);
  });

  it.each([
    {
      slug: 'locais',
      label: 'Locais de atendimento',
      href: '/configuracoes/locais',
      description: 'Endereços e modalidades onde você atende presencial ou online.',
    },
    {
      slug: 'whatsapp',
      label: 'WhatsApp',
      href: '/configuracoes/integracoes/whatsapp',
      description: 'Conecte sua conta do WhatsApp para enviar lembretes e mensagens.',
    },
    {
      slug: 'lembretes',
      label: 'Lembretes',
      href: '/configuracoes/lembretes',
      description: 'Personalize quando e como avisar pacientes sobre suas sessões.',
    },
    {
      slug: 'agenda',
      label: 'Agenda',
      href: '/configuracoes/agenda',
      description: 'Horários de trabalho, duração padrão e regras de agendamento.',
    },
  ])(
    'renders card "$slug" with label "$label", correct href, and exact microcopy',
    ({ slug, label, href, description }) => {
      render(<SettingsIndexPage />);

      const card = screen.getByTestId(`settings-area-card-${slug}`);
      expect(card).toBeInTheDocument();

      // Label (h3)
      const heading = within(card).getByRole('heading', { level: 3 });
      expect(heading).toHaveTextContent(label);

      // Description with exact diacritics
      expect(within(card).getByText(description)).toBeInTheDocument();

      // The card is wrapped in a link with correct href
      const link = card.closest('a');
      expect(link).toHaveAttribute('href', href);
    },
  );

  it('each card contains a decorative Lucide icon (svg with aria-hidden)', () => {
    render(<SettingsIndexPage />);

    for (const area of SETTINGS_AREAS) {
      const card = screen.getByTestId(`settings-area-card-${area.slug}`);
      const icon = card.querySelector('svg');
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('renders descriptions with exact diacritics (ê, ã, õ, ç)', () => {
    render(<SettingsIndexPage />);

    // Verify diacritics are present in all descriptions
    expect(
      screen.getByText('Endereços e modalidades onde você atende presencial ou online.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Conecte sua conta do WhatsApp para enviar lembretes e mensagens.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Personalize quando e como avisar pacientes sobre suas sessões.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Horários de trabalho, duração padrão e regras de agendamento.'),
    ).toBeInTheDocument();
  });
});
