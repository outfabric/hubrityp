import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Subtask 5.4 — the /configuracoes/integracoes index freezes the "WhatsApp"
// integration card while the WhatsApp UI flag is OFF, and renders it navigable
// while it is ON. The committed `page.test.tsx` covers the flag-ON behaviour
// (default test env); this file drives both flag states explicitly via
// `vi.stubEnv` + dynamic import.

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

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderIntegracoesPage(flag: 'true' | 'false') {
  vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED', flag);
  const { default: IntegrationsIndexPage } =
    await import('@/app/(app)/configuracoes/integracoes/page');
  render(<IntegrationsIndexPage />);
}

function getWhatsappCard(): HTMLElement {
  return screen.getByTestId('integration-card-whatsapp');
}

describe('IntegrationsIndexPage — WhatsApp integration freeze toggling', () => {
  describe('when the flag is OFF', () => {
    it('renders the WhatsApp card frozen (aria-disabled, no link, "Em breve")', async () => {
      await renderIntegracoesPage('false');

      const card = getWhatsappCard();
      expect(card).toHaveAttribute('aria-disabled', 'true');
      expect(card.closest('a')).toBeNull();
      expect(within(card).getByText('Em breve')).toBeInTheDocument();
    });
  });

  describe('when the flag is ON', () => {
    it('renders the WhatsApp card navigable with no "Em breve" badge', async () => {
      await renderIntegracoesPage('true');

      const card = getWhatsappCard();
      expect(card).not.toHaveAttribute('aria-disabled', 'true');
      const anchor = card.closest('a');
      expect(anchor).not.toBeNull();
      expect(anchor).toHaveAttribute('href', '/configuracoes/integracoes/whatsapp');
      expect(within(card).queryByText('Em breve')).not.toBeInTheDocument();
    });
  });
});
