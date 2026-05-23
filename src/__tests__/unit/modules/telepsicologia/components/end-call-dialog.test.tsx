import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Vitest before the component import.
// ---------------------------------------------------------------------------

const mockLeave = vi.fn().mockResolvedValue(undefined);

vi.mock('@stream-io/video-react-sdk', () => ({
  useCall: () => ({ leave: mockLeave }),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import type { EndVideoSessionResult } from '@/modules/telepsicologia';
import { EndCallDialog } from '@/modules/telepsicologia/components/end-call-dialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog(
  opts: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onEndSession?: (roomId: string) => Promise<EndVideoSessionResult>;
    roomId?: string;
  } = {},
) {
  const {
    open = true,
    onOpenChange = vi.fn(),
    onEndSession = vi.fn().mockResolvedValue({ ok: true } satisfies EndVideoSessionResult),
    roomId = 'room-123',
  } = opts;

  return {
    onOpenChange,
    onEndSession,
    ...render(
      <EndCallDialog
        open={open}
        onOpenChange={onOpenChange}
        roomId={roomId}
        onEndSession={onEndSession}
      />,
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EndCallDialog', () => {
  it('renders the dialog when open', () => {
    renderDialog({ open: true });

    expect(screen.getByText('Encerrar sessao?')).toBeInTheDocument();
    expect(screen.getByText('O paciente sera desconectado.')).toBeInTheDocument();
    expect(screen.getByText('Cancelar')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-end-call')).toHaveTextContent('Encerrar sessao');
  });

  it('does not render the dialog when closed', () => {
    renderDialog({ open: false });

    expect(screen.queryByText('Encerrar sessao?')).not.toBeInTheDocument();
  });

  it('closes without calling onEndSession when "Cancelar" is clicked', async () => {
    const user = userEvent.setup();
    const onEndSession = vi.fn().mockResolvedValue({ ok: true });
    const onOpenChange = vi.fn();

    renderDialog({ onEndSession, onOpenChange });

    const cancelBtn = screen.getByText('Cancelar');
    await user.click(cancelBtn);

    expect(onEndSession).not.toHaveBeenCalled();
  });

  it('calls onEndSession with roomId when "Encerrar sessao" is clicked', async () => {
    const user = userEvent.setup();
    const onEndSession = vi.fn().mockResolvedValue({ ok: true });

    renderDialog({ onEndSession, roomId: 'room-abc' });

    const confirmBtn = screen.getByTestId('confirm-end-call');
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(onEndSession).toHaveBeenCalledWith('room-abc');
    });
  });

  it('shows loading state while ending the session', async () => {
    const user = userEvent.setup();
    let resolveEnd: (v: EndVideoSessionResult) => void;
    const onEndSession = vi.fn().mockReturnValue(
      new Promise<EndVideoSessionResult>((resolve) => {
        resolveEnd = resolve;
      }),
    );

    renderDialog({ onEndSession });

    const confirmBtn = screen.getByTestId('confirm-end-call');
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-end-call')).toHaveTextContent('Encerrando...');
      expect(screen.getByTestId('confirm-end-call')).toBeDisabled();
    });

    // Also check that "Cancelar" is disabled during the operation
    expect(screen.getByText('Cancelar').closest('button')).toBeDisabled();

    // Resolve the promise to complete the test cleanly
    resolveEnd!({ ok: true });

    await waitFor(() => {
      expect(screen.queryByText('Encerrando...')).not.toBeInTheDocument();
    });
  });

  it('calls call.leave() after onEndSession succeeds', async () => {
    const user = userEvent.setup();
    const onEndSession = vi.fn().mockResolvedValue({ ok: true });

    renderDialog({ onEndSession });

    const confirmBtn = screen.getByTestId('confirm-end-call');
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockLeave).toHaveBeenCalledOnce();
    });
  });
});
