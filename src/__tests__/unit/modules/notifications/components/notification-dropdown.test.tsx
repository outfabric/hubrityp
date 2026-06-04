import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationView } from '@/modules/notifications';
import { NotificationDropdown } from '@/modules/notifications';
import { DropdownMenu } from '@/shared/ui/dropdown-menu';

// next/navigation's useRouter is not available in jsdom; stub push so we can
// assert navigation intent without a real router.
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date('2024-05-15T15:00:00Z');

function makeNotification(overrides: Partial<NotificationView> = {}): NotificationView {
  return {
    id: 'n-1',
    type: 'session_confirmed',
    title: 'Sessão confirmada',
    body: null,
    actionUrl: null,
    readAt: null,
    // 5 minutes before FIXED_NOW so the relative time reads "há 5 min".
    createdAt: new Date(FIXED_NOW.getTime() - 5 * 60_000),
    ...overrides,
  };
}

function renderDropdown(
  overrides: {
    notifications?: NotificationView[];
    onMarkRead?: ReturnType<typeof vi.fn>;
    onMarkAllRead?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const notifications = overrides.notifications ?? [makeNotification()];
  const onMarkRead = overrides.onMarkRead ?? vi.fn();
  const onMarkAllRead = overrides.onMarkAllRead ?? vi.fn();

  // The dropdown renders Radix DropdownMenuContent, which only mounts inside an
  // open DropdownMenu root (its portal child).
  render(
    <DropdownMenu open>
      <NotificationDropdown
        notifications={notifications}
        onMarkRead={onMarkRead}
        onMarkAllRead={onMarkAllRead}
      />
    </DropdownMenu>,
  );

  return { onMarkRead, onMarkAllRead };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationDropdown', () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it('renders the per-type icon and relative time for an MVP notification', () => {
    // Pin the clock only for the relative-time assertion. userEvent + Radix's
    // pointer handling deadlocks under fake timers, so the click-based tests
    // below run on real timers instead — they assert routing/callbacks, which
    // are clock-independent.
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    try {
      renderDropdown({
        notifications: [makeNotification({ type: 'session_confirmed' })],
      });

      expect(screen.getByText('Sessão confirmada')).toBeInTheDocument();
      expect(screen.getByText('há 5 min')).toBeInTheDocument();

      // The row carries its type so the icon/affordance can be asserted.
      const row = screen.getByRole('button', { name: /Sessão confirmada/ });
      expect(row).toHaveAttribute('data-notification-type', 'session_confirmed');
      // The per-type Lucide icon renders as an inline <svg> inside the row.
      expect(row.querySelector('svg')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the notification read and routes to its target on click', async () => {
    const user = userEvent.setup();
    const { onMarkRead } = renderDropdown({
      notifications: [makeNotification({ id: 'n-42', type: 'session_confirmed' })],
    });

    await user.click(screen.getByRole('button', { name: /Sessão confirmada/ }));

    expect(onMarkRead).toHaveBeenCalledTimes(1);
    expect(onMarkRead).toHaveBeenCalledWith('n-42');
    // session_confirmed → default route /agenda (no actionUrl override).
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/agenda');
  });

  it('routes to the per-notification actionUrl when present, over the default route', async () => {
    const user = userEvent.setup();
    renderDropdown({
      notifications: [makeNotification({ type: 'evolution_pending', actionUrl: '/pacientes/p-7' })],
    });

    await user.click(screen.getByRole('button', { name: /Sessão confirmada/ }));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/pacientes/p-7');
  });

  it('wires the "Marcar todas como lidas" header action', async () => {
    const user = userEvent.setup();
    const { onMarkAllRead } = renderDropdown();

    await user.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));

    expect(onMarkAllRead).toHaveBeenCalledOnce();
  });

  it('renders an empty state when there are no notifications', () => {
    renderDropdown({ notifications: [] });
    expect(screen.getByText('Você não tem notificações.')).toBeInTheDocument();
  });

  it('does NOT render a clickable/icon affordance for a post-MVP type', () => {
    renderDropdown({
      notifications: [
        // A post-MVP type that is intentionally outside the MVP allowlist —
        // e.g. a future payment/Receita/WhatsApp-delivery notification.
        makeNotification({
          id: 'n-post-mvp',
          type: 'payment_received',
          title: 'Pagamento recebido',
        }),
      ],
    });

    // The title still renders so nothing silently vanishes...
    expect(screen.getByText('Pagamento recebido')).toBeInTheDocument();

    // ...but there is NO clickable row (no button), so it can never act as a
    // payment/Receita/WhatsApp affordance, and clicking does not navigate.
    expect(screen.queryByRole('button', { name: /Pagamento recebido/ })).not.toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();

    // The inert row carries no Lucide icon either.
    const inertRow = screen.getByText('Pagamento recebido').closest('li');
    expect(inertRow).not.toBeNull();
    expect(inertRow?.querySelector('svg')).toBeNull();
  });
});
