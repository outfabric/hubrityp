import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { NpsModal } from '@/modules/nps/components/nps-modal';
import type { SubmitNpsResult } from '@/modules/nps/server/submit-nps';

// ---------------------------------------------------------------------------
// jsdom polyfills required by Radix Dialog
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

const OK: SubmitNpsResult = { ok: true };

function renderModal(overrides: Partial<React.ComponentProps<typeof NpsModal>> = {}) {
  const defaultProps: React.ComponentProps<typeof NpsModal> = {
    isEligible: true,
    onSubmit: vi.fn(() => Promise.resolve(OK)),
    onDismiss: vi.fn(() => Promise.resolve(OK)),
    ...overrides,
  };

  const result = render(<NpsModal {...defaultProps} />);

  return { ...result, props: defaultProps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NpsModal', () => {
  it('renders the survey when eligible', () => {
    renderModal();

    expect(screen.getByTestId('nps-modal')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Em uma escala de 0 a 10, qual a chance de você recomendar o sistema a uma colega?',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('O que faria você dar nota mais alta?')).toBeInTheDocument();
  });

  it('renders all 11 score options (0–10)', () => {
    renderModal();

    for (let value = 0; value <= 10; value += 1) {
      expect(screen.getByTestId(`nps-score-${value}`)).toBeInTheDocument();
    }
  });

  it('is hidden when not eligible', () => {
    renderModal({ isEligible: false });

    expect(screen.queryByTestId('nps-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nps-form')).not.toBeInTheDocument();
  });

  it('"Não responder agora" calls the dismiss action', async () => {
    const { props } = renderModal();

    fireEvent.click(screen.getByTestId('nps-dismiss'));

    await waitFor(() => {
      expect(props.onDismiss).toHaveBeenCalledTimes(1);
    });
    // Dismissal never submits an answer.
    expect(props.onSubmit).not.toHaveBeenCalled();
    // The modal stops being shown after dismissal.
    await waitFor(() => {
      expect(screen.queryByTestId('nps-modal')).not.toBeInTheDocument();
    });
  });

  it('submit is disabled until a score is selected', () => {
    renderModal();

    expect(screen.getByTestId('nps-submit')).toBeDisabled();
  });

  it('selecting a score and submitting calls onSubmit with that score', async () => {
    const { props } = renderModal();

    fireEvent.click(screen.getByTestId('nps-score-9'));
    expect(screen.getByTestId('nps-score-9')).toHaveAttribute('aria-checked', 'true');

    const submit = screen.getByTestId('nps-submit');
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(props.onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(props.onSubmit).toHaveBeenCalledWith({ score: 9 });
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it('includes the trimmed feedback when the open field is filled', async () => {
    const { props } = renderModal();

    fireEvent.click(screen.getByTestId('nps-score-3'));
    fireEvent.change(screen.getByTestId('nps-feedback'), {
      target: { value: '  mais relatórios  ' },
    });
    fireEvent.click(screen.getByTestId('nps-submit'));

    await waitFor(() => {
      expect(props.onSubmit).toHaveBeenCalledWith({ score: 3, feedback: 'mais relatórios' });
    });
  });

  it('closes the modal after a successful answer', async () => {
    const { props } = renderModal();

    fireEvent.click(screen.getByTestId('nps-score-10'));
    fireEvent.click(screen.getByTestId('nps-submit'));

    await waitFor(() => {
      expect(props.onSubmit).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.queryByTestId('nps-modal')).not.toBeInTheDocument();
    });
  });

  it('Escape defers the survey (dismiss) and closes the modal (a11y)', async () => {
    const { props } = renderModal();

    fireEvent.keyDown(screen.getByTestId('nps-modal'), { key: 'Escape' });

    await waitFor(() => {
      expect(props.onDismiss).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('nps-modal')).not.toBeInTheDocument();
    });
  });

  it('exposes the dialog with an accessible name (focus/a11y contract)', () => {
    renderModal();

    // Radix Dialog wires role="dialog" + aria-labelledby to the title.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Sua opinião');
  });
});
