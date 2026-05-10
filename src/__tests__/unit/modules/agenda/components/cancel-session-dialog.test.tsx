import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CancelSessionDialog } from '@/modules/agenda/components/cancel-session-dialog';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock sonner toast
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
    sessionStartAt?: Date;
    onConfirm?: () => Promise<{ ok: boolean; error?: string; message?: string }>;
    onSuccess?: () => void;
    onOpenChange?: (open: boolean) => void;
  } = {},
) {
  const {
    // Default to session 2 hours from now
    sessionStartAt = new Date(Date.now() + 2 * 60 * 60 * 1000),
    onConfirm = vi.fn().mockResolvedValue({ ok: true }),
    onSuccess = vi.fn(),
    onOpenChange = vi.fn(),
  } = opts;

  return render(
    <CancelSessionDialog
      sessionId="test-session-id"
      sessionStartAt={sessionStartAt}
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

describe('CancelSessionDialog', () => {
  describe('renders all form fields', () => {
    it('renders the dialog title', () => {
      renderDialog();
      // The title text also appears on the submit button, so use role heading
      expect(screen.getByRole('heading', { name: 'Cancelar sessao' })).toBeInTheDocument();
    });

    it('renders the reason select', () => {
      renderDialog();
      expect(screen.getByTestId('cancel-reason-select')).toBeInTheDocument();
    });

    it('renders the cancelled-by radio group', () => {
      renderDialog();
      expect(screen.getByTestId('cancel-cancelled-by')).toBeInTheDocument();
      expect(screen.getByText('Paciente')).toBeInTheDocument();
      expect(screen.getByText('Psicologo')).toBeInTheDocument();
    });

    it('renders the charge cancellation switch', () => {
      renderDialog();
      expect(screen.getByTestId('cancel-charge-switch')).toBeInTheDocument();
      expect(screen.getByText('Aplicar cobranca?')).toBeInTheDocument();
    });

    it('renders the notice alert', () => {
      renderDialog();
      expect(screen.getByTestId('cancel-notice-alert')).toBeInTheDocument();
    });

    it('renders footer buttons', () => {
      renderDialog();
      expect(screen.getByTestId('cancel-dialog-back')).toBeInTheDocument();
      expect(screen.getByTestId('cancel-dialog-confirm')).toBeInTheDocument();
    });
  });

  describe('notice alert updates based on session time', () => {
    it('shows info notice for sessions more than 24h away', () => {
      const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);
      renderDialog({ sessionStartAt: tomorrow });

      expect(screen.getByText('Cancelamento com mais de 24h de antecedencia.')).toBeInTheDocument();
    });

    it('shows warning notice for sessions less than 24h away', () => {
      const in12h = new Date(Date.now() + 12 * 60 * 60 * 1000);
      renderDialog({ sessionStartAt: in12h });

      expect(
        screen.getByText('Cancelamento com menos de 24h de antecedencia.'),
      ).toBeInTheDocument();
    });

    it('shows warning notice for sessions less than 1h away', () => {
      const in30min = new Date(Date.now() + 30 * 60 * 1000);
      renderDialog({ sessionStartAt: in30min });

      expect(screen.getByText('Cancelamento com menos de 1h de antecedencia.')).toBeInTheDocument();
    });

    it('shows danger notice for sessions at or past start time', () => {
      const inPast = new Date(Date.now() - 10 * 60 * 1000);
      renderDialog({ sessionStartAt: inPast });

      expect(
        screen.getByText('Cancelamento no horario da sessao ou apos o inicio.'),
      ).toBeInTheDocument();
    });
  });

  describe('form validation', () => {
    it('does not submit when required fields are not filled', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn().mockResolvedValue({ ok: true });
      renderDialog({ onConfirm });

      const confirmBtn = screen.getByTestId('cancel-dialog-confirm');
      await user.click(confirmBtn);

      // onConfirm should NOT have been called because form validation fails
      await waitFor(() => {
        expect(onConfirm).not.toHaveBeenCalled();
      });
    });
  });

  describe('loading state on submit', () => {
    it('confirm button has submit type for form integration', () => {
      renderDialog();

      const confirmBtn = screen.getByTestId('cancel-dialog-confirm');
      expect(confirmBtn).toHaveAttribute('type', 'submit');
    });

    it('back button has button type to prevent form submission', () => {
      renderDialog();

      const backBtn = screen.getByTestId('cancel-dialog-back');
      expect(backBtn).toHaveAttribute('type', 'button');
    });
  });
});
