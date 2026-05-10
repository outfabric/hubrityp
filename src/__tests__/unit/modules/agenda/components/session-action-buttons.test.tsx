import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionActionButtons } from '@/modules/agenda/components/session-action-buttons';
import type { SessionStatus } from '@/modules/agenda/lib/session-status';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

function renderButtons(
  status: SessionStatus,
  opts: {
    updatedAt?: Date;
    deletedAt?: Date | null;
    onAction?: (type: string) => Promise<void> | void;
  } = {},
) {
  const { updatedAt = new Date(), deletedAt = null, onAction = vi.fn() } = opts;

  return render(
    <SessionActionButtons status={status} session={{ updatedAt, deletedAt }} onAction={onAction} />,
  );
}

// ---------------------------------------------------------------------------
// Tests — renders correct buttons for each status
// ---------------------------------------------------------------------------

describe('SessionActionButtons', () => {
  describe('renders correct buttons for each status', () => {
    it('renders scheduled status buttons', () => {
      renderButtons('scheduled');

      expect(screen.getByTestId('action-btn-confirm')).toBeInTheDocument();
      expect(screen.getByTestId('action-btn-reschedule')).toBeInTheDocument();
      expect(screen.getByTestId('action-btn-cancel')).toBeInTheDocument();
      expect(screen.getByTestId('action-btn-mark_done')).toBeInTheDocument();
      expect(screen.getByTestId('action-btn-mark_no_show')).toBeInTheDocument();
    });

    it('renders confirmed status buttons', () => {
      renderButtons('confirmed');

      expect(screen.queryByTestId('action-btn-confirm')).not.toBeInTheDocument();
      expect(screen.getByTestId('action-btn-reschedule')).toBeInTheDocument();
      expect(screen.getByTestId('action-btn-cancel')).toBeInTheDocument();
      expect(screen.getByTestId('action-btn-mark_done')).toBeInTheDocument();
      expect(screen.getByTestId('action-btn-mark_no_show')).toBeInTheDocument();
    });

    it('renders done status buttons (not locked)', () => {
      renderButtons('done', { updatedAt: new Date() });

      expect(screen.getByTestId('action-btn-view_record')).toBeInTheDocument();
      expect(screen.getByTestId('action-btn-add_payment')).toBeInTheDocument();
    });

    it('renders cancelled status buttons', () => {
      renderButtons('cancelled');

      expect(screen.getByTestId('action-btn-reactivate')).toBeInTheDocument();
      expect(screen.getByTestId('action-btn-hard_delete')).toBeInTheDocument();
    });

    it('renders no_show status buttons', () => {
      renderButtons('no_show');

      expect(screen.getByTestId('action-btn-charge_no_show')).toBeInTheDocument();
    });
  });

  describe('locked done session shows lock alert', () => {
    it('shows lock alert instead of action buttons for done sessions past 7 days', () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      renderButtons('done', { updatedAt: eightDaysAgo });

      expect(screen.getByTestId('session-locked-alert')).toBeInTheDocument();
      expect(screen.getByText('Sessao bloqueada para edicao apos 7 dias')).toBeInTheDocument();

      // No action buttons should be rendered
      expect(screen.queryByTestId('session-action-buttons')).not.toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading state during async action', async () => {
      const user = userEvent.setup();
      let resolveAction: () => void;
      const actionPromise = new Promise<void>((resolve) => {
        resolveAction = resolve;
      });
      const onAction = vi.fn().mockReturnValue(actionPromise);

      renderButtons('scheduled', { onAction });

      const confirmBtn = screen.getByTestId('action-btn-confirm');
      await user.click(confirmBtn);

      expect(onAction).toHaveBeenCalledWith('confirm');

      // All buttons should be disabled during pending state
      await waitFor(() => {
        const buttons = screen.getAllByRole('button');
        buttons.forEach((btn) => {
          expect(btn).toBeDisabled();
        });
      });

      // Resolve the action
      resolveAction!();

      await waitFor(() => {
        const buttons = screen.getAllByRole('button');
        buttons.forEach((btn) => {
          expect(btn).not.toBeDisabled();
        });
      });
    });
  });
});
