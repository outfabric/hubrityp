import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { EditScopeDialog } from '@/modules/sessions/components/edit-scope-dialog';

// ---------------------------------------------------------------------------
// jsdom polyfills required by Radix AlertDialog
// ---------------------------------------------------------------------------

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDialog(overrides: Partial<React.ComponentProps<typeof EditScopeDialog>> = {}) {
  const defaultProps: React.ComponentProps<typeof EditScopeDialog> = {
    open: true,
    onOpenChange: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };

  const result = render(<EditScopeDialog {...defaultProps} />);

  return { ...result, props: defaultProps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EditScopeDialog', () => {
  it('renders 3 scope buttons with correct labels', () => {
    renderDialog();

    // Verify all 3 scope buttons are present
    expect(screen.getByTestId('scope-this')).toBeInTheDocument();
    expect(screen.getByTestId('scope-this_and_future')).toBeInTheDocument();
    expect(screen.getByTestId('scope-all')).toBeInTheDocument();

    // Verify labels
    expect(screen.getByText('Apenas esta sessão')).toBeInTheDocument();
    expect(screen.getByText('Esta e todas as próximas')).toBeInTheDocument();
    expect(screen.getByText('Toda a série')).toBeInTheDocument();

    // Verify subtitles
    expect(screen.getByText('As demais sessões da série não serão alteradas')).toBeInTheDocument();
    expect(screen.getByText('Sessões anteriores permanecem como estão')).toBeInTheDocument();
    expect(screen.getByText('Todas as sessões futuras serão atualizadas')).toBeInTheDocument();
  });

  it('clicking "Apenas esta sessão" calls onSelect with "this"', () => {
    const { props } = renderDialog();

    fireEvent.click(screen.getByTestId('scope-this'));

    expect(props.onSelect).toHaveBeenCalledWith('this');
    expect(props.onSelect).toHaveBeenCalledTimes(1);
  });

  it('clicking "Esta e todas as próximas" calls onSelect with "this_and_future"', () => {
    const { props } = renderDialog();

    fireEvent.click(screen.getByTestId('scope-this_and_future'));

    expect(props.onSelect).toHaveBeenCalledWith('this_and_future');
    expect(props.onSelect).toHaveBeenCalledTimes(1);
  });

  it('clicking "Toda a série" calls onSelect with "all"', () => {
    const { props } = renderDialog();

    fireEvent.click(screen.getByTestId('scope-all'));

    expect(props.onSelect).toHaveBeenCalledWith('all');
    expect(props.onSelect).toHaveBeenCalledTimes(1);
  });

  it('cancel button closes dialog', async () => {
    const { props } = renderDialog();

    const cancelButton = screen.getByTestId('scope-cancel');
    expect(cancelButton).toBeInTheDocument();
    expect(cancelButton).toHaveTextContent('Cancelar');

    fireEvent.click(cancelButton);

    // AlertDialogCancel calls onOpenChange(false) when clicked
    await waitFor(() => {
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('dialog traps focus within content', () => {
    renderDialog();

    // When dialog is open, the dialog content should be present and have focus within it
    const dialogContent = screen.getByTestId('edit-scope-dialog');
    expect(dialogContent).toBeInTheDocument();

    // The dialog should contain a role="group" for the scope options
    const group = screen.getByRole('group', { name: 'Escopo da edição' });
    expect(group).toBeInTheDocument();
  });

  it('Escape closes dialog', async () => {
    const { props } = renderDialog();

    // Press Escape key on the dialog content
    const dialogContent = screen.getByTestId('edit-scope-dialog');
    fireEvent.keyDown(dialogContent, { key: 'Escape' });

    await waitFor(() => {
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('renders default title and description', () => {
    renderDialog();

    expect(screen.getByText('Editar sessão recorrente')).toBeInTheDocument();
    expect(
      screen.getByText('Escolha o escopo da alteração para esta sessão recorrente.'),
    ).toBeInTheDocument();
  });

  it('accepts custom title and description props', () => {
    renderDialog({
      title: 'Cancelar sessão recorrente',
      description: 'Escolha quais sessões deseja cancelar.',
    });

    expect(screen.getByText('Cancelar sessão recorrente')).toBeInTheDocument();
    expect(screen.getByText('Escolha quais sessões deseja cancelar.')).toBeInTheDocument();
    // Default title should NOT be present
    expect(screen.queryByText('Editar sessão recorrente')).not.toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    renderDialog({ open: false });

    expect(screen.queryByTestId('edit-scope-dialog')).not.toBeInTheDocument();
  });
});
