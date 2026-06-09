import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SessionHistoryCard } from '@/modules/sessions/components/session-history-card';
import type { PatientId, SessionHistoryItem } from '@/modules/sessions/lib/session-history-schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENT_ID = '11111111-1111-1111-1111-111111111111' as PatientId;
const SESSION_ID = '22222222-2222-2222-2222-222222222222';
const EVOLUTION_ID = '33333333-3333-3333-3333-333333333333';

/** Reference "now" used for the finalized read-only window (RN-13.05). */
const NOW = new Date('2026-06-09T12:00:00Z');

/**
 * Build a `SessionHistoryItem` with sensible defaults; override only the fields
 * the assertion cares about so each test reads as the variant under test.
 */
function makeSession(overrides: Partial<SessionHistoryItem> = {}): SessionHistoryItem {
  return {
    id: SESSION_ID,
    patientId: PATIENT_ID,
    status: 'done',
    startAt: '2025-12-15T17:30:00.000Z', // 14:30 in São Paulo
    endAt: '2025-12-15T18:20:00.000Z', // 15:20 in São Paulo
    durationMinutes: 50,
    modality: null,
    locationName: null,
    amount: null,
    isCouple: false,
    isLateRecord: false,
    rescheduledFromDate: null,
    evolutionId: null,
    evolutionFinalizedAt: null,
    cancellationReason: null,
    cancelledBy: null,
    cancellationNotice: null,
    chargeCancellation: null,
    ...overrides,
  };
}

function renderCard(overrides: Partial<SessionHistoryItem> = {}) {
  return render(<SessionHistoryCard session={makeSession(overrides)} now={NOW} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionHistoryCard', () => {
  describe('base rendering', () => {
    it('renders status badge label, full date with weekday, time range and duration', () => {
      renderCard({ status: 'done' });

      expect(screen.getByText('Realizada')).toBeInTheDocument();
      expect(screen.getByText(/segunda-feira, 15 de dezembro de 2025/i)).toBeInTheDocument();
      expect(screen.getByText(/14:30 – 15:20/)).toBeInTheDocument();
      expect(screen.getByText(/50 min/)).toBeInTheDocument();
    });

    it('marks status icon as decorative (aria-hidden)', () => {
      const { container } = renderCard({ status: 'done' });
      // Every icon in the card is decorative — none expose an accessible name.
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
      svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden'));
    });
  });

  describe('optional facets omitted when absent', () => {
    it('omits modality icon, location and amount when null', () => {
      renderCard({ modality: null, locationName: null, amount: null });

      expect(screen.queryByTestId('session-location')).not.toBeInTheDocument();
      expect(screen.queryByTestId('session-modality-icon')).not.toBeInTheDocument();
      expect(screen.queryByTestId('session-amount')).not.toBeInTheDocument();
    });

    it('renders location with modality icon when both present', () => {
      renderCard({ modality: 'in_person', locationName: 'Consultório Centro' });

      expect(screen.getByTestId('session-location')).toHaveTextContent('Consultório Centro');
    });

    it('renders a standalone modality icon when modality is set but location is absent', () => {
      renderCard({ modality: 'online', locationName: null });

      expect(screen.getByTestId('session-modality-icon')).toBeInTheDocument();
      expect(screen.queryByTestId('session-location')).not.toBeInTheDocument();
    });

    it('formats amount as BRL when present', () => {
      renderCard({ amount: 200.5 });

      expect(screen.getByTestId('session-amount').textContent).toMatch(/R\$\s?200,50/);
    });
  });

  describe('contextual tags', () => {
    it('renders the couple tag with NO partner data in the DOM', () => {
      renderCard({ isCouple: true });

      const tag = screen.getByTestId('tag-couple');
      expect(tag).toHaveTextContent('Sessão de casal');
      // The card is partner-agnostic: no second patient name/id leaks in.
      expect(screen.queryByText(/parceir|partner/i)).not.toBeInTheDocument();
    });

    it('renders the rescheduled tag with the original date', () => {
      renderCard({ rescheduledFromDate: '2025-12-01T17:30:00.000Z' });

      expect(screen.getByTestId('tag-rescheduled')).toHaveTextContent('Remarcada de 01/12/2025');
    });

    it('renders the retroactive-record tag', () => {
      renderCard({ isLateRecord: true });

      expect(screen.getByTestId('tag-late-record')).toHaveTextContent('Registro retroativo');
    });

    it('omits all tags when none apply', () => {
      renderCard({ isCouple: false, isLateRecord: false, rescheduledFromDate: null });

      expect(screen.queryByTestId('tag-couple')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tag-rescheduled')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tag-late-record')).not.toBeInTheDocument();
    });
  });

  describe('evolution indicator (done only)', () => {
    it('done WITH evolution shows "Evolução registrada" + a "Ver" link to the evolution', () => {
      renderCard({ status: 'done', evolutionId: EVOLUTION_ID });

      expect(screen.getByTestId('evolution-registered')).toHaveTextContent('Evolução registrada');
      const link = screen.getByRole('link', { name: 'Ver' });
      expect(link).toHaveAttribute(
        'href',
        `/pacientes/${PATIENT_ID}/prontuario/evolucoes/${EVOLUTION_ID}`,
      );
      // No "Registrar" CTA in the registered branch.
      expect(screen.queryByRole('link', { name: 'Registrar' })).not.toBeInTheDocument();
    });

    it('done WITHOUT evolution shows "Sem evolução" + a "Registrar" link with sessionId', () => {
      renderCard({ status: 'done', evolutionId: null });

      expect(screen.getByTestId('evolution-missing')).toHaveTextContent('Sem evolução');
      const link = screen.getByRole('link', { name: 'Registrar' });
      expect(link).toHaveAttribute(
        'href',
        `/pacientes/${PATIENT_ID}/prontuario/evolucoes/nova?sessionId=${SESSION_ID}`,
      );
      expect(screen.queryByRole('link', { name: 'Ver' })).not.toBeInTheDocument();
    });

    it('shows the "Finalizada" hint when the evolution is past the 30-day edit window', () => {
      renderCard({
        status: 'done',
        evolutionId: EVOLUTION_ID,
        // 40 days before NOW — outside the 30-day window (RN-13.05).
        evolutionFinalizedAt: '2026-04-30T12:00:00.000Z',
      });

      expect(screen.getByTestId('evolution-finalized-hint')).toHaveTextContent('Finalizada');
    });

    it('hides the "Finalizada" hint when the evolution is still within the edit window', () => {
      renderCard({
        status: 'done',
        evolutionId: EVOLUTION_ID,
        // 5 days before NOW — still editable.
        evolutionFinalizedAt: '2026-06-04T12:00:00.000Z',
      });

      expect(screen.getByRole('link', { name: 'Ver' })).toBeInTheDocument();
      expect(screen.queryByTestId('evolution-finalized-hint')).not.toBeInTheDocument();
    });

    it('does NOT render the evolution indicator for non-done statuses', () => {
      renderCard({ status: 'cancelled', evolutionId: EVOLUTION_ID });
      expect(screen.queryByTestId('evolution-indicator')).not.toBeInTheDocument();

      renderCard({ status: 'no_show', evolutionId: null });
      expect(screen.queryByTestId('evolution-indicator')).not.toBeInTheDocument();
    });
  });

  describe('cancellation details (cancelled only)', () => {
    it('shows who cancelled, reason, notice and charged flag', () => {
      renderCard({
        status: 'cancelled',
        cancelledBy: 'patient',
        cancellationReason: 'Imprevisto pessoal',
        cancellationNotice: 'less_than_2h',
        chargeCancellation: true,
      });

      const details = screen.getByTestId('cancellation-details');
      expect(within(details).getByTestId('cancellation-by')).toHaveTextContent(
        'Cancelada pelo paciente',
      );
      expect(within(details).getByTestId('cancellation-reason')).toHaveTextContent(
        'Imprevisto pessoal',
      );
      expect(within(details).getByTestId('cancellation-notice')).toHaveTextContent(
        'Aviso com menos de 2h',
      );
      expect(within(details).getByTestId('cancellation-charge')).toHaveTextContent('Cobrada');
    });

    it('labels a therapist cancellation as "Cancelada por você" and a not-charged flag', () => {
      renderCard({
        status: 'cancelled',
        cancelledBy: 'therapist',
        chargeCancellation: false,
      });

      expect(screen.getByTestId('cancellation-by')).toHaveTextContent('Cancelada por você');
      expect(screen.getByTestId('cancellation-charge')).toHaveTextContent('Não cobrada');
    });

    it('omits cancellation sub-fields that are absent', () => {
      renderCard({
        status: 'cancelled',
        cancelledBy: 'patient',
        cancellationReason: null,
        cancellationNotice: null,
        chargeCancellation: null,
      });

      expect(screen.getByTestId('cancellation-by')).toBeInTheDocument();
      expect(screen.queryByTestId('cancellation-reason')).not.toBeInTheDocument();
      expect(screen.queryByTestId('cancellation-notice')).not.toBeInTheDocument();
      expect(screen.queryByTestId('cancellation-charge')).not.toBeInTheDocument();
    });

    it('does NOT render cancellation details for non-cancelled statuses', () => {
      renderCard({ status: 'done' });
      expect(screen.queryByTestId('cancellation-details')).not.toBeInTheDocument();
    });
  });
});
