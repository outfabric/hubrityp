import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  CoupleSessionFields,
  type PatientOption,
} from '@/modules/sessions/components/couple-session-fields';

// ---------------------------------------------------------------------------
// jsdom polyfills required by Radix primitives
// ---------------------------------------------------------------------------

beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  // Radix Select calls `scrollIntoView` on the selected item, which jsdom
  // does not implement. Polyfill it as a no-op to avoid unhandled exceptions.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENTS: PatientOption[] = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Ana Silva' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Bruno Souza' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Carla Lima' },
];

// ---------------------------------------------------------------------------
// Test wrapper — provides FormProvider context
// ---------------------------------------------------------------------------

function Wrapper({
  children,
  defaultPatientId,
}: {
  children: React.ReactNode;
  defaultPatientId?: string;
}) {
  const form = useForm({
    defaultValues: {
      patientId: defaultPatientId ?? (undefined as string | undefined),
      couple: {
        enabled: false,
        secondPatientId: undefined as string | undefined,
      },
    },
  });

  return <FormProvider {...form}>{children}</FormProvider>;
}

function renderWithForm(opts?: { defaultPatientId?: string }) {
  return render(
    <Wrapper defaultPatientId={opts?.defaultPatientId}>
      <CoupleSessionFields patients={PATIENTS} />
    </Wrapper>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoupleSessionFields', () => {
  it('renders the "Atendimento de casal" checkbox', () => {
    renderWithForm();
    expect(screen.getByTestId('couple-toggle')).toBeInTheDocument();
    expect(screen.getByText('Atendimento de casal')).toBeInTheDocument();
  });

  it('checkbox toggles second select visibility', async () => {
    renderWithForm();

    // Initially, the second patient section should not be visible
    expect(screen.queryByTestId('second-patient-section')).not.toBeInTheDocument();

    // Click the checkbox to reveal
    const checkbox = screen.getByTestId('couple-toggle');
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.getByTestId('second-patient-section')).toBeInTheDocument();
    });

    // The second patient select should be present
    expect(screen.getByTestId('second-patient-select')).toBeInTheDocument();
    expect(screen.getByText('Segundo paciente')).toBeInTheDocument();

    // Click again to hide
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.queryByTestId('second-patient-section')).not.toBeInTheDocument();
    });
  });

  it('second select excludes already-selected primary patient', async () => {
    // Set Ana Silva as the primary patient
    renderWithForm({
      defaultPatientId: '11111111-1111-1111-1111-111111111111',
    });

    // Enable couple mode
    fireEvent.click(screen.getByTestId('couple-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('second-patient-select')).toBeInTheDocument();
    });

    // Open the select dropdown
    fireEvent.click(screen.getByTestId('second-patient-select'));

    // Wait for the dropdown content to appear
    await waitFor(() => {
      // Bruno and Carla should be in the list
      expect(
        screen.getByTestId('patient-option-22222222-2222-2222-2222-222222222222'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('patient-option-33333333-3333-3333-3333-333333333333'),
      ).toBeInTheDocument();
    });

    // Ana (the primary patient) should NOT be in the dropdown
    expect(
      screen.queryByTestId('patient-option-11111111-1111-1111-1111-111111111111'),
    ).not.toBeInTheDocument();
  });

  it('shows all patients when no primary patient is selected', async () => {
    renderWithForm();

    // Enable couple mode
    fireEvent.click(screen.getByTestId('couple-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('second-patient-select')).toBeInTheDocument();
    });

    // Open the select dropdown
    fireEvent.click(screen.getByTestId('second-patient-select'));

    // All three patients should be present
    await waitFor(() => {
      expect(
        screen.getByTestId('patient-option-11111111-1111-1111-1111-111111111111'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('patient-option-22222222-2222-2222-2222-222222222222'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('patient-option-33333333-3333-3333-3333-333333333333'),
      ).toBeInTheDocument();
    });
  });

  it('shows error when same patient selected in both (duplicate guard)', async () => {
    // To test the duplicate error, we need a scenario where primaryPatientId
    // equals secondPatientId. Since the filtered list normally prevents this,
    // the only realistic path is: the primary changes AFTER the second is set,
    // making them match. We simulate this by rendering with a wrapper that lets
    // us set form values programmatically.
    function DuplicateTestWrapper() {
      const form = useForm({
        defaultValues: {
          patientId: '11111111-1111-1111-1111-111111111111',
          couple: {
            enabled: true,
            secondPatientId: '11111111-1111-1111-1111-111111111111',
          },
        },
      });

      return (
        <FormProvider {...form}>
          <CoupleSessionFields patients={PATIENTS} />
        </FormProvider>
      );
    }

    render(<DuplicateTestWrapper />);

    // The error should be shown because both IDs match
    await waitFor(() => {
      expect(screen.getByTestId('couple-duplicate-error')).toBeInTheDocument();
    });

    expect(screen.getByTestId('couple-duplicate-error')).toHaveTextContent(
      'Selecione pacientes diferentes',
    );

    // The error should have role="alert" for accessibility
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('does not show error when different patients are selected', async () => {
    function ValidTestWrapper() {
      const form = useForm({
        defaultValues: {
          patientId: '11111111-1111-1111-1111-111111111111',
          couple: {
            enabled: true,
            secondPatientId: '22222222-2222-2222-2222-222222222222',
          },
        },
      });

      return (
        <FormProvider {...form}>
          <CoupleSessionFields patients={PATIENTS} />
        </FormProvider>
      );
    }

    render(<ValidTestWrapper />);

    // The second patient section should be visible (couple.enabled = true)
    await waitFor(() => {
      expect(screen.getByTestId('second-patient-section')).toBeInTheDocument();
    });

    // No error should be shown
    expect(screen.queryByTestId('couple-duplicate-error')).not.toBeInTheDocument();
  });

  it('unchecking the checkbox clears the second patient selection', async () => {
    renderWithForm();

    // Enable couple mode
    fireEvent.click(screen.getByTestId('couple-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('second-patient-section')).toBeInTheDocument();
    });

    // Disable couple mode
    fireEvent.click(screen.getByTestId('couple-toggle'));

    await waitFor(() => {
      expect(screen.queryByTestId('second-patient-section')).not.toBeInTheDocument();
    });

    // Re-enable — the select should be empty (no prior selection persisted)
    fireEvent.click(screen.getByTestId('couple-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('second-patient-section')).toBeInTheDocument();
    });

    // The placeholder should be shown, indicating no selection
    expect(screen.getByText('Selecione o segundo paciente')).toBeInTheDocument();
  });
});
