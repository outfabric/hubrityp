import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { WeeklySummaryResult } from '@/modules/dashboard';
import {
  SectionWeekly,
  SectionWeeklySkeleton,
} from '@/modules/dashboard/components/section-weekly';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<WeeklySummaryResult> = {}): WeeklySummaryResult {
  return {
    ok: true,
    sessionsDoneThisWeek: 8,
    sessionsScheduledThisWeek: 12,
    noShowRatePercent: 10,
    newPatientsThisMonth: 3,
    evolutionsThisWeek: 6,
    ...overrides,
  };
}

const EMPTY_COPY = 'Ainda sem dados suficientes';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SectionWeekly', () => {
  it('renders each metric value when present', () => {
    render(<SectionWeekly result={makeResult()} />);

    expect(screen.getByTestId('dashboard-weekly-sessions-done-value')).toHaveTextContent('8');
    expect(screen.getByTestId('dashboard-weekly-sessions-scheduled-value')).toHaveTextContent('12');
    expect(screen.getByTestId('dashboard-weekly-no-show-rate-value')).toHaveTextContent('10%');
    expect(screen.getByTestId('dashboard-weekly-new-patients-value')).toHaveTextContent('3');
    expect(screen.getByTestId('dashboard-weekly-evolutions-value')).toHaveTextContent('6');
  });

  it('shows the graceful empty state for a metric whose count is zero', () => {
    render(<SectionWeekly result={makeResult({ sessionsDoneThisWeek: 0 })} />);

    expect(screen.getByTestId('dashboard-weekly-sessions-done-empty')).toHaveTextContent(
      EMPTY_COPY,
    );
    expect(screen.queryByTestId('dashboard-weekly-sessions-done-value')).not.toBeInTheDocument();
  });

  it('shows the empty state for every metric when there is no data at all', () => {
    render(
      <SectionWeekly
        result={makeResult({
          sessionsDoneThisWeek: 0,
          sessionsScheduledThisWeek: 0,
          noShowRatePercent: null,
          newPatientsThisMonth: 0,
          evolutionsThisWeek: 0,
        })}
      />,
    );

    expect(screen.getByTestId('dashboard-weekly-sessions-done-empty')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-weekly-sessions-scheduled-empty')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-weekly-no-show-rate-empty')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-weekly-new-patients-empty')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-weekly-evolutions-empty')).toBeInTheDocument();
  });

  it('hides the no-show rate (shows empty state) when null', () => {
    render(<SectionWeekly result={makeResult({ noShowRatePercent: null })} />);

    expect(screen.queryByTestId('dashboard-weekly-no-show-rate-value')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard-weekly-no-show-rate-empty')).toHaveTextContent(EMPTY_COPY);
  });

  it('renders the no-show rate as a percentage when present (including zero)', () => {
    render(<SectionWeekly result={makeResult({ noShowRatePercent: 0 })} />);

    expect(screen.getByTestId('dashboard-weekly-no-show-rate-value')).toHaveTextContent('0%');
  });

  it('contains no market-benchmark or comparative wording', () => {
    const { container } = render(<SectionWeekly result={makeResult()} />);

    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toContain('média do mercado');
    expect(text).not.toContain('benchmark');
    expect(text).not.toContain('comparado');
    expect(text).not.toContain('referência de mercado');
    expect(text).not.toContain('outros psicólogos');
  });

  it('exposes a skeleton fallback for the Suspense boundary', () => {
    render(<SectionWeeklySkeleton />);

    expect(screen.getByTestId('dashboard-section-weekly-skeleton')).toBeInTheDocument();
  });
});
