import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Subtask 5.3 — the /configuracoes index freezes the "WhatsApp" and "Lembretes"
// cards while the WhatsApp UI flag is OFF, and renders every card navigable
// while it is ON. The committed `page.test.tsx` covers the flag-ON behaviour
// (default test env); this file drives both flag states explicitly via
// `vi.stubEnv` + dynamic import (the page reads `clientEnv` at render time, and
// `clientEnv` re-parses `process.env` on import).

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

const FROZEN_SLUGS = ['whatsapp', 'lembretes'] as const;
const ALWAYS_NAVIGABLE_SLUGS = ['locais', 'agenda', 'transcricao-ia'] as const;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderSettingsPage(flag: 'true' | 'false') {
  vi.stubEnv('NEXT_PUBLIC_WHATSAPP_UI_ENABLED', flag);
  const { default: SettingsIndexPage } = await import('@/app/(app)/configuracoes/page');
  render(<SettingsIndexPage />);
}

function getCard(slug: string): HTMLElement {
  return screen.getByTestId(`settings-area-card-${slug}`);
}

function assertNavigable(slug: string) {
  const card = getCard(slug);
  expect(card).not.toHaveAttribute('aria-disabled', 'true');
  const anchor = card.closest('a');
  expect(anchor).not.toBeNull();
  expect(anchor).toHaveAttribute('href');
  expect(within(card).queryByText('Em breve')).not.toBeInTheDocument();
}

function assertFrozen(slug: string) {
  const card = getCard(slug);
  expect(card).toHaveAttribute('aria-disabled', 'true');
  expect(card.closest('a')).toBeNull();
  expect(within(card).getByText('Em breve')).toBeInTheDocument();
}

describe('SettingsIndexPage — WhatsApp/Lembretes freeze toggling', () => {
  describe('when the flag is OFF', () => {
    it('renders the WhatsApp and Lembretes cards frozen', async () => {
      await renderSettingsPage('false');
      for (const slug of FROZEN_SLUGS) {
        assertFrozen(slug);
      }
    });

    it('keeps every other settings card navigable', async () => {
      await renderSettingsPage('false');
      for (const slug of ALWAYS_NAVIGABLE_SLUGS) {
        assertNavigable(slug);
      }
      // Exactly the two WhatsApp-dependent cards carry "Em breve".
      expect(screen.getAllByText('Em breve')).toHaveLength(FROZEN_SLUGS.length);
    });
  });

  describe('when the flag is ON', () => {
    it('renders every settings card navigable with no "Em breve" badge', async () => {
      await renderSettingsPage('true');
      for (const slug of [...FROZEN_SLUGS, ...ALWAYS_NAVIGABLE_SLUGS]) {
        assertNavigable(slug);
      }
      expect(screen.queryByText('Em breve')).not.toBeInTheDocument();
    });
  });
});
