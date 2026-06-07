import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  LateRecordToggle,
  type LateRecordToggleProps,
} from '@/modules/sessions/components/late-record-toggle';

// ---------------------------------------------------------------------------
// jsdom polyfills required by Radix primitives
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

/** Build a Date that is `offsetMs` milliseconds from now. */
function dateFromNow(offsetMs: number): Date {
  return new Date(Date.now() + offsetMs);
}

const ONE_HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Test wrapper — provides FormProvider context
// ---------------------------------------------------------------------------

function Wrapper({
  children,
  defaultValues,
}: {
  children: React.ReactNode;
  defaultValues?: Record<string, unknown>;
}) {
  const form = useForm({
    defaultValues: {
      lateRecord: false,
      status: 'scheduled',
      ...defaultValues,
    },
  });

  return <FormProvider {...form}>{children}</FormProvider>;
}

function renderToggle(props: LateRecordToggleProps, defaultValues?: Record<string, unknown>) {
  return render(
    <Wrapper defaultValues={defaultValues}>
      <LateRecordToggle {...props} />
    </Wrapper>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LateRecordToggle', () => {
  it('does not render when selectedDateTime is null', () => {
    renderToggle({ selectedDateTime: null });

    expect(screen.queryByTestId('late-record-section')).not.toBeInTheDocument();
  });

  it('does not render when selectedDateTime is in the future', () => {
    const futureDate = dateFromNow(ONE_HOUR_MS);
    renderToggle({ selectedDateTime: futureDate });

    expect(screen.queryByTestId('late-record-section')).not.toBeInTheDocument();
  });

  it('renders when selectedDateTime is in the past', () => {
    const pastDate = dateFromNow(-ONE_HOUR_MS);
    renderToggle({ selectedDateTime: pastDate });

    expect(screen.getByTestId('late-record-section')).toBeInTheDocument();
    expect(screen.getByTestId('late-record-toggle')).toBeInTheDocument();
    expect(screen.getByText('Lançamento retroativo')).toBeInTheDocument();
  });

  it('has the correct aria-label', () => {
    const pastDate = dateFromNow(-ONE_HOUR_MS);
    renderToggle({ selectedDateTime: pastDate });

    expect(screen.getByTestId('late-record-toggle')).toHaveAttribute(
      'aria-label',
      'Marcar como lançamento retroativo',
    );
  });

  it('checking the toggle shows helper text and sets status to done', async () => {
    const pastDate = dateFromNow(-ONE_HOUR_MS);

    // Ref-based spy that the React compiler allows (ref identity is stable)
    const formRef = React.createRef<{ getValues: () => Record<string, unknown> }>();

    function SpyWrapper() {
      const form = useForm({
        defaultValues: {
          lateRecord: false,
          status: 'scheduled',
        },
      });

      // Expose getValues via a ref (no reassignment of outer variables)
      React.useImperativeHandle(formRef, () => ({
        getValues: form.getValues,
      }));

      return (
        <FormProvider {...form}>
          <LateRecordToggle selectedDateTime={pastDate} />
        </FormProvider>
      );
    }

    render(<SpyWrapper />);

    // Helper text should not be visible before checking
    expect(screen.queryByTestId('late-record-helper')).not.toBeInTheDocument();

    // Click the checkbox
    fireEvent.click(screen.getByTestId('late-record-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('late-record-helper')).toBeInTheDocument();
    });

    // Verify helper text content
    expect(screen.getByTestId('late-record-helper')).toHaveTextContent(
      'Esta sessão já foi realizada e será registrada como concluída',
    );

    // Verify status was set to 'done'
    expect(formRef.current?.getValues().status).toBe('done');
  });

  it('transitions from future to past correctly when re-rendered', () => {
    const futureDate = dateFromNow(ONE_HOUR_MS);
    const pastDate = dateFromNow(-ONE_HOUR_MS);

    const { rerender } = render(
      <Wrapper>
        <LateRecordToggle selectedDateTime={futureDate} />
      </Wrapper>,
    );

    // Not visible with future date
    expect(screen.queryByTestId('late-record-section')).not.toBeInTheDocument();

    // Re-render with past date
    rerender(
      <Wrapper>
        <LateRecordToggle selectedDateTime={pastDate} />
      </Wrapper>,
    );

    // Now visible
    expect(screen.getByTestId('late-record-section')).toBeInTheDocument();
  });

  it('does not show helper text when toggle is unchecked', async () => {
    const pastDate = dateFromNow(-ONE_HOUR_MS);
    renderToggle({ selectedDateTime: pastDate });

    // Check it
    fireEvent.click(screen.getByTestId('late-record-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('late-record-helper')).toBeInTheDocument();
    });

    // Uncheck it
    fireEvent.click(screen.getByTestId('late-record-toggle'));

    await waitFor(() => {
      expect(screen.queryByTestId('late-record-helper')).not.toBeInTheDocument();
    });
  });

  it('uses Date.now() for comparison (not a stale reference)', () => {
    // Mock Date.now to a fixed point, then create a date that is "past" relative to it
    const fixedNow = new Date('2025-06-15T12:00:00Z').getTime();
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);

    const justBefore = new Date('2025-06-15T11:59:00Z');
    renderToggle({ selectedDateTime: justBefore });

    expect(screen.getByTestId('late-record-section')).toBeInTheDocument();

    vi.restoreAllMocks();
  });
});
