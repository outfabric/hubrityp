import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeleteSessionDialog } from '@/modules/agenda/components/delete-session-dialog';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog(
  opts: {
    onConfirm?: () => Promise<{ ok: boolean; error?: string; message?: string }>;
    onSuccess?: () => void;
    onOpenChange?: (open: boolean) => void;
  } = {},
) {
  const {
    onConfirm = vi.fn().mockResolvedValue({ ok: true }),
    onSuccess = vi.fn(),
    onOpenChange = vi.fn(),
  } = opts;

  return render(
    <DeleteSessionDialog
      open={true}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      onSuccess={onSuccess}
    />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeleteSessionDialog', () => {
  describe('confirm button disabled until "EXCLUIR" typed', () => {
    it('renders with confirm button disabled initially', () => {
      renderDialog();

      const confirmBtn = screen.getByTestId('delete-dialog-confirm');
      expect(confirmBtn).toBeDisabled();
    });

    it('keeps confirm button disabled with partial text', async () => {
      const user = userEvent.setup();
      renderDialog();

      const input = screen.getByTestId('delete-confirm-input');
      await user.type(input, 'EXCL');

      expect(screen.getByTestId('delete-dialog-confirm')).toBeDisabled();
    });

    it('enables confirm button when "EXCLUIR" is typed', async () => {
      const user = userEvent.setup();
      renderDialog();

      const input = screen.getByTestId('delete-confirm-input');
      await user.type(input, 'EXCLUIR');

      expect(screen.getByTestId('delete-dialog-confirm')).not.toBeDisabled();
    });

    it('disables confirm button if text does not match exactly', async () => {
      const user = userEvent.setup();
      renderDialog();

      const input = screen.getByTestId('delete-confirm-input');
      await user.type(input, 'excluir');

      expect(screen.getByTestId('delete-dialog-confirm')).toBeDisabled();
    });
  });

  describe('submission calls softDeleteSession', () => {
    it('calls onConfirm when form is submitted', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn().mockResolvedValue({ ok: true });
      const onSuccess = vi.fn();

      renderDialog({ onConfirm, onSuccess });

      const input = screen.getByTestId('delete-confirm-input');
      await user.type(input, 'EXCLUIR');

      const confirmBtn = screen.getByTestId('delete-dialog-confirm');
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onSuccess).toHaveBeenCalledTimes(1);
      });
    });

    it('shows loading state during submission', async () => {
      const user = userEvent.setup();
      let resolveConfirm: (value: { ok: boolean }) => void;
      const confirmPromise = new Promise<{ ok: boolean }>((resolve) => {
        resolveConfirm = resolve;
      });
      const onConfirm = vi.fn().mockReturnValue(confirmPromise);

      renderDialog({ onConfirm });

      const input = screen.getByTestId('delete-confirm-input');
      await user.type(input, 'EXCLUIR');

      const confirmBtn = screen.getByTestId('delete-dialog-confirm');
      await user.click(confirmBtn);

      // Both buttons should be disabled while the action is pending
      await waitFor(() => {
        expect(screen.getByTestId('delete-dialog-confirm')).toBeDisabled();
        expect(screen.getByTestId('delete-dialog-cancel')).toBeDisabled();
      });

      // Resolve the action — dialog closes on success, so we verify
      // that onConfirm was called (the dialog unmounts after success).
      resolveConfirm!({ ok: true });

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledTimes(1);
      });
    });
  });

  it('renders dialog title and description', () => {
    renderDialog();

    expect(screen.getByText('Excluir sessao definitivamente')).toBeInTheDocument();
    expect(screen.getByText(/Esta acao nao pode ser desfeita/)).toBeInTheDocument();
  });
});
