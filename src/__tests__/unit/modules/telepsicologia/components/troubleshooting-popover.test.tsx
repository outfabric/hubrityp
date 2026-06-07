import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { TroubleshootingPopover } from '@/modules/telepsicologia/components/troubleshooting-popover';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TroubleshootingPopover', () => {
  it('opens popover on click and shows troubleshooting steps', async () => {
    const user = userEvent.setup();
    render(<TroubleshootingPopover />);

    const triggerButton = screen.getByTestId('troubleshooting-button');
    expect(triggerButton).toBeInTheDocument();

    // Popover content should not be visible before clicking
    expect(screen.queryByTestId('troubleshooting-popover')).not.toBeInTheDocument();

    await user.click(triggerButton);

    await waitFor(() => {
      expect(screen.getByTestId('troubleshooting-popover')).toBeInTheDocument();
    });

    // Verify all four troubleshooting steps are rendered
    expect(
      screen.getByText(
        'Verifique se microfone e câmera estão ativados nas configurações do navegador',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Saia e volte a entrar pelo mesmo link')).toBeInTheDocument();
    expect(screen.getByText('Tente usar Chrome ou Firefox')).toBeInTheDocument();
    // Psychologist view — generic support text for step 4
    expect(
      screen.getByText('Se o problema persistir, entre em contato com o suporte'),
    ).toBeInTheDocument();
  });

  it('shows psychologist name in step 4 when provided (patient view)', async () => {
    const user = userEvent.setup();
    render(<TroubleshootingPopover psychologistName="Dra. Ana Souza" />);

    await user.click(screen.getByTestId('troubleshooting-button'));

    await waitFor(() => {
      expect(screen.getByTestId('troubleshooting-popover')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Se o problema persistir, entre em contato com Dra. Ana Souza por WhatsApp'),
    ).toBeInTheDocument();
    // The generic support text should not appear
    expect(
      screen.queryByText('Se o problema persistir, entre em contato com o suporte'),
    ).not.toBeInTheDocument();
  });

  it('closes popover on Escape key', async () => {
    const user = userEvent.setup();
    render(<TroubleshootingPopover />);

    await user.click(screen.getByTestId('troubleshooting-button'));

    await waitFor(() => {
      expect(screen.getByTestId('troubleshooting-popover')).toBeInTheDocument();
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByTestId('troubleshooting-popover')).not.toBeInTheDocument();
    });
  });

  it('renders generic step 4 when psychologistName is null', async () => {
    const user = userEvent.setup();
    render(<TroubleshootingPopover psychologistName={null} />);

    await user.click(screen.getByTestId('troubleshooting-button'));

    await waitFor(() => {
      expect(screen.getByTestId('troubleshooting-popover')).toBeInTheDocument();
    });

    expect(
      screen.getByText('Se o problema persistir, entre em contato com o suporte'),
    ).toBeInTheDocument();
  });
});
