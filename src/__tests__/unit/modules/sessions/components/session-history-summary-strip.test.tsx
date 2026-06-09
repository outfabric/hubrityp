import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SessionHistorySummaryStrip } from '@/modules/sessions/components/session-history-summary-strip';
import type { SessionHistorySummary } from '@/modules/sessions/lib/session-history-schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a `SessionHistorySummary` with sensible defaults; override only the
 * fields the assertion cares about so each test reads as the case under test.
 */
function makeSummary(overrides: Partial<SessionHistorySummary> = {}): SessionHistorySummary {
  return {
    doneTotal: 12,
    attendanceRate: 92,
    doneWithoutEvolution: 3,
    lastDoneAt: '2025-12-15T17:30:00.000Z', // 15 dez 2025 in São Paulo
    ...overrides,
  };
}

function renderStrip(overrides: Partial<SessionHistorySummary> = {}) {
  return render(<SessionHistorySummaryStrip summary={makeSummary(overrides)} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionHistorySummaryStrip', () => {
  it('renders realized total, attendance rate, and last-session date', () => {
    renderStrip({ doneTotal: 12, attendanceRate: 92 });

    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.getByText(/15 de dezembro de 2025/i)).toBeInTheDocument();
  });

  describe('attendance rate', () => {
    it('renders `0%` (never hidden) when the rate is zero (§8 edge case)', () => {
      renderStrip({ attendanceRate: 0 });

      expect(screen.getByText('0%')).toBeInTheDocument();
    });
  });

  describe('pending-evolution badge', () => {
    it('shows the warning badge with the count when sessions lack an evolution', () => {
      renderStrip({ doneWithoutEvolution: 3 });

      const badge = screen.getByTestId('pending-evolution-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('3 evoluções pendentes');
    });

    it('uses the singular label for exactly one pending evolution', () => {
      renderStrip({ doneWithoutEvolution: 1 });

      expect(screen.getByTestId('pending-evolution-badge')).toHaveTextContent(
        '1 evolução pendente',
      );
    });

    it('hides the badge entirely when zero sessions lack an evolution', () => {
      renderStrip({ doneWithoutEvolution: 0 });

      expect(screen.queryByTestId('pending-evolution-badge')).not.toBeInTheDocument();
    });
  });

  describe('last-session date', () => {
    it('renders an em-dash when there is no realized session yet', () => {
      renderStrip({ lastDoneAt: null });

      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });
});
