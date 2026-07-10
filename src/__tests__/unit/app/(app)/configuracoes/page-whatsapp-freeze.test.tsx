import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Subtask 6.3 — the /configuracoes index freezes each WhatsApp-dependent card
// independently, gated by its own surface flag:
//   - "Lembretes"  -> NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED
//   - "WhatsApp"   -> NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED (this card is
//     the entry point to the connection surface, which also covers template
//     text editing; both are frozen together by the CONNECTION flag)
//
// The MVP target config is reminders ON, connection OFF: "Lembretes" navigable,
// "WhatsApp"/connection frozen. This suite drives the flags explicitly via
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

/**
 * Renders the settings index after stubbing both surface flags. Either arg may
 * be omitted to exercise the "unset -> defaults to false (frozen)" branch.
 */
async function renderSettingsPage(flags: {
  reminders?: 'true' | 'false';
  connection?: 'true' | 'false';
}) {
  if (flags.reminders !== undefined) {
    vi.stubEnv('NEXT_PUBLIC_WHATSAPP_REMINDERS_UI_ENABLED', flags.reminders);
  }
  if (flags.connection !== undefined) {
    vi.stubEnv('NEXT_PUBLIC_WHATSAPP_CONNECTION_UI_ENABLED', flags.connection);
  }
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
  // No surrounding <Link>, so the card is not a navigation target.
  expect(card.closest('a')).toBeNull();
  expect(within(card).getByText('Em breve')).toBeInTheDocument();
}

describe('SettingsIndexPage — per-surface WhatsApp freeze', () => {
  // -------------------------------------------------------------------------
  // MVP target: reminders ON, connection OFF
  // -------------------------------------------------------------------------
  describe('MVP config (reminders on, connection off)', () => {
    beforeEach(async () => {
      await renderSettingsPage({ reminders: 'true', connection: 'false' });
    });

    it('renders "Lembretes" navigable (no "Em breve")', () => {
      assertNavigable('lembretes');
    });

    it('renders "WhatsApp"/connection frozen (aria-disabled, no link, "Em breve")', () => {
      assertFrozen('whatsapp');
    });

    it('keeps every other settings card navigable and untouched', () => {
      for (const slug of ALWAYS_NAVIGABLE_SLUGS) {
        assertNavigable(slug);
      }
      // Exactly one "Em breve" — the frozen WhatsApp/connection card.
      expect(screen.getAllByText('Em breve')).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Flag independence — each surface is gated separately
  // -------------------------------------------------------------------------
  describe('flag independence', () => {
    it('freezes only "Lembretes" when reminders is OFF but connection is ON', async () => {
      await renderSettingsPage({ reminders: 'false', connection: 'true' });
      assertFrozen('lembretes');
      assertNavigable('whatsapp');
      expect(screen.getAllByText('Em breve')).toHaveLength(1);
    });

    it('freezes both cards when both surface flags are OFF', async () => {
      await renderSettingsPage({ reminders: 'false', connection: 'false' });
      assertFrozen('lembretes');
      assertFrozen('whatsapp');
      expect(screen.getAllByText('Em breve')).toHaveLength(2);
    });

    it('renders both cards navigable when both surface flags are ON', async () => {
      await renderSettingsPage({ reminders: 'true', connection: 'true' });
      assertNavigable('lembretes');
      assertNavigable('whatsapp');
      expect(screen.queryByText('Em breve')).not.toBeInTheDocument();
    });

    it('defaults an unset flag to frozen (unset === false)', async () => {
      // Neither flag stubbed: both default to false -> both frozen.
      await renderSettingsPage({});
      assertFrozen('lembretes');
      assertFrozen('whatsapp');
      for (const slug of ALWAYS_NAVIGABLE_SLUGS) {
        assertNavigable(slug);
      }
    });
  });
});
