import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { beforeAll, describe, expect, it } from 'vitest';

import { RecurrenceFormSection } from '@/modules/sessions/components/recurrence-form-section';

// ---------------------------------------------------------------------------
// jsdom polyfills required by Radix primitives
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Radix Checkbox uses ResizeObserver internally.
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// ---------------------------------------------------------------------------
// Test wrapper — provides FormProvider context
// ---------------------------------------------------------------------------

function Wrapper({ children }: { children: React.ReactNode }) {
  const form = useForm({
    defaultValues: {
      recurrence: {
        frequency: undefined as string | undefined,
        daysOfWeek: undefined as number[] | undefined,
        endDate: undefined as string | undefined,
        occurrenceCount: undefined as number | undefined,
        isIndefinite: false,
      },
    },
  });

  return <FormProvider {...form}>{children}</FormProvider>;
}

function renderWithForm() {
  return render(
    <Wrapper>
      <RecurrenceFormSection />
    </Wrapper>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecurrenceFormSection', () => {
  it('renders the "Sessão recorrente" checkbox', () => {
    renderWithForm();
    expect(screen.getByTestId('recurrence-toggle')).toBeInTheDocument();
    expect(screen.getByText('Sessão recorrente')).toBeInTheDocument();
  });

  it('checkbox toggles collapsible visibility', async () => {
    renderWithForm();

    // Initially, the frequency radio group should not be visible
    expect(screen.queryByTestId('frequency-radio-group')).not.toBeInTheDocument();

    // Click the checkbox to expand
    const checkbox = screen.getByTestId('recurrence-toggle');
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.getByTestId('frequency-radio-group')).toBeInTheDocument();
    });

    // Click again to collapse
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.queryByTestId('frequency-radio-group')).not.toBeInTheDocument();
    });
  });

  it('frequency RadioGroup renders 4 options', async () => {
    renderWithForm();

    // Expand the collapsible
    fireEvent.click(screen.getByTestId('recurrence-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('frequency-radio-group')).toBeInTheDocument();
    });

    expect(screen.getByText('Semanal')).toBeInTheDocument();
    expect(screen.getByText('Quinzenal')).toBeInTheDocument();
    expect(screen.getByText('Mensal')).toBeInTheDocument();
    expect(screen.getByText('Personalizada')).toBeInTheDocument();

    // All 4 radio items are present
    expect(screen.getByTestId('freq-weekly')).toBeInTheDocument();
    expect(screen.getByTestId('freq-biweekly')).toBeInTheDocument();
    expect(screen.getByTestId('freq-monthly')).toBeInTheDocument();
    expect(screen.getByTestId('freq-custom')).toBeInTheDocument();
  });

  it('selecting "Semanal" shows days-of-week ToggleGroup', async () => {
    renderWithForm();

    // Expand the collapsible
    fireEvent.click(screen.getByTestId('recurrence-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('frequency-radio-group')).toBeInTheDocument();
    });

    // Days of week should NOT be visible initially
    expect(screen.queryByTestId('days-of-week-section')).not.toBeInTheDocument();

    // Select "Semanal"
    fireEvent.click(screen.getByTestId('freq-weekly'));

    await waitFor(() => {
      expect(screen.getByTestId('days-of-week-section')).toBeInTheDocument();
    });

    // Verify all 7 day toggle items are rendered
    for (let i = 0; i <= 6; i++) {
      expect(screen.getByTestId(`day-${i}`)).toBeInTheDocument();
    }

    // Verify aria-labels for full day names
    expect(screen.getByLabelText('Domingo')).toBeInTheDocument();
    expect(screen.getByLabelText('Segunda-feira')).toBeInTheDocument();
    expect(screen.getByLabelText('Terça-feira')).toBeInTheDocument();
    expect(screen.getByLabelText('Quarta-feira')).toBeInTheDocument();
    expect(screen.getByLabelText('Quinta-feira')).toBeInTheDocument();
    expect(screen.getByLabelText('Sexta-feira')).toBeInTheDocument();
    expect(screen.getByLabelText('Sábado')).toBeInTheDocument();
  });

  it('selecting "Mensal" hides days-of-week', async () => {
    renderWithForm();

    // Expand and select "Semanal" first to show days-of-week
    fireEvent.click(screen.getByTestId('recurrence-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('frequency-radio-group')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('freq-weekly'));

    await waitFor(() => {
      expect(screen.getByTestId('days-of-week-section')).toBeInTheDocument();
    });

    // Now select "Mensal" — days-of-week should hide
    fireEvent.click(screen.getByTestId('freq-monthly'));

    await waitFor(() => {
      expect(screen.queryByTestId('days-of-week-section')).not.toBeInTheDocument();
    });
  });

  it('end condition "Número de sessões" reveals number input', async () => {
    renderWithForm();

    // Expand the collapsible
    fireEvent.click(screen.getByTestId('recurrence-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('end-condition-radio-group')).toBeInTheDocument();
    });

    // Number input should NOT be visible initially (default is indefinite)
    expect(screen.queryByTestId('occurrence-count-input')).not.toBeInTheDocument();

    // Select "Número de sessões"
    fireEvent.click(screen.getByTestId('end-condition-count'));

    await waitFor(() => {
      expect(screen.getByTestId('occurrence-count-input')).toBeInTheDocument();
    });

    // Verify it's a number input with min/max
    const input = screen.getByTestId('occurrence-count-input');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('min', '2');
    expect(input).toHaveAttribute('max', '104');
  });

  it('end condition "Indefinido" shows helper text', async () => {
    renderWithForm();

    // Expand the collapsible
    fireEvent.click(screen.getByTestId('recurrence-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('end-condition-radio-group')).toBeInTheDocument();
    });

    // Default end condition is "indefinite" — helper should be visible
    expect(screen.getByTestId('indefinite-helper')).toBeInTheDocument();
    expect(screen.getByTestId('indefinite-helper')).toHaveTextContent(
      'As sessões serão geradas continuamente até que você cancele a recorrência.',
    );
  });

  it('switching end condition from "Indefinido" to "Data específica" hides helper and shows date picker', async () => {
    renderWithForm();

    // Expand the collapsible
    fireEvent.click(screen.getByTestId('recurrence-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('indefinite-helper')).toBeInTheDocument();
    });

    // Switch to "Data especifica"
    fireEvent.click(screen.getByTestId('end-condition-date'));

    await waitFor(() => {
      expect(screen.queryByTestId('indefinite-helper')).not.toBeInTheDocument();
      expect(screen.getByTestId('end-date-picker')).toBeInTheDocument();
    });
  });

  it('selecting "Personalizada" also shows days-of-week ToggleGroup', async () => {
    renderWithForm();

    fireEvent.click(screen.getByTestId('recurrence-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('frequency-radio-group')).toBeInTheDocument();
    });

    // Select "Personalizada"
    fireEvent.click(screen.getByTestId('freq-custom'));

    await waitFor(() => {
      expect(screen.getByTestId('days-of-week-section')).toBeInTheDocument();
    });
  });

  it('has correct aria-label on the frequency RadioGroup', async () => {
    renderWithForm();

    fireEvent.click(screen.getByTestId('recurrence-toggle'));

    await waitFor(() => {
      const group = screen.getByTestId('frequency-radio-group');
      expect(group).toHaveAttribute('aria-label', 'Frequência da recorrência');
    });
  });
});
