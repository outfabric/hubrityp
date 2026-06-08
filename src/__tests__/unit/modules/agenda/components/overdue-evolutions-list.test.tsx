import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OverdueEvolutionItem } from '@/modules/agenda';
import { OverdueEvolutionsList } from '@/modules/agenda/components/overdue-evolutions-list';
import { OverdueFilterChip } from '@/modules/agenda/components/overdue-filter-chip';

// next/navigation's useRouter is not available in jsdom; stub replace so we can
// assert the chip's remove control navigates back to the calendar.
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

afterEach(() => {
  cleanup();
  replaceMock.mockReset();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<OverdueEvolutionItem> = {}): OverdueEvolutionItem {
  return {
    sessionId: 'session-1',
    patientId: 'patient-1',
    patientName: 'Maria Souza',
    // 2026-05-15 14:00 in São Paulo (UTC-3) → 17:00 UTC.
    startAt: new Date('2026-05-15T17:00:00.000Z'),
    modality: 'online',
    daysOverdue: 9,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Row + CTA
// ---------------------------------------------------------------------------

describe('OverdueEvolutionsList — rows', () => {
  it('renders the "Registrar evolução" CTA pointing at the evolution-create route', () => {
    render(<OverdueEvolutionsList items={[makeItem()]} />);

    const cta = screen.getByTestId('overdue-evolution-cta');
    expect(cta).toHaveAttribute(
      'href',
      '/pacientes/patient-1/prontuario/evolucoes/nova?sessionId=session-1',
    );
  });

  it('renders the patient name and São Paulo date/time', () => {
    render(<OverdueEvolutionsList items={[makeItem()]} />);

    const row = screen.getByTestId('overdue-evolution-row');
    expect(within(row).getByText('Maria Souza')).toBeInTheDocument();
    // 17:00 UTC → 14:00 in America/Sao_Paulo.
    expect(within(row).getByText(/14:00/)).toBeInTheDocument();
  });

  it('renders "há N dias" from daysOverdue', () => {
    render(<OverdueEvolutionsList items={[makeItem({ daysOverdue: 9 })]} />);

    expect(screen.getByText(/há 9 dias/)).toBeInTheDocument();
  });

  it('renders the singular "há 1 dia" when exactly one day overdue', () => {
    render(<OverdueEvolutionsList items={[makeItem({ daysOverdue: 1 })]} />);

    expect(screen.getByText(/há 1 dia(?!s)/)).toBeInTheDocument();
  });

  it('renders the modality label when present', () => {
    render(<OverdueEvolutionsList items={[makeItem({ modality: 'presencial' })]} />);

    expect(screen.getByText(/Presencial/)).toBeInTheDocument();
  });

  it('omits the modality segment when modality is null', () => {
    render(<OverdueEvolutionsList items={[makeItem({ modality: null })]} />);

    expect(screen.queryByText(/Presencial|Online/)).not.toBeInTheDocument();
  });

  it('shows the header count matching the number of items', () => {
    render(
      <OverdueEvolutionsList
        items={[
          makeItem({ sessionId: 's1', patientId: 'p1' }),
          makeItem({ sessionId: 's2', patientId: 'p2' }),
        ]}
      />,
    );

    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getAllByTestId('overdue-evolution-row')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Empty state (RF-12.19)
// ---------------------------------------------------------------------------

describe('OverdueEvolutionsList — empty state', () => {
  it('renders the positive "tudo em dia" empty state with a link to /agenda', () => {
    render(<OverdueEvolutionsList items={[]} />);

    const empty = screen.getByTestId('overdue-evolutions-empty-state');
    expect(within(empty).getByText(/Tudo em dia/)).toBeInTheDocument();

    // The link points at the full agenda — NOT the filtered list/calendar.
    const link = within(empty).getByTestId('overdue-evolutions-view-agenda').closest('a');
    expect(link).toHaveAttribute('href', '/agenda');
  });
});

// ---------------------------------------------------------------------------
// Filter chip (RF-12.09 / RNF-12.03)
// ---------------------------------------------------------------------------

describe('OverdueFilterChip', () => {
  it('renders "Sem evolução · N" with the active count', () => {
    render(<OverdueFilterChip count={3} />);

    const chip = screen.getByTestId('overdue-evolutions-filter-chip');
    expect(chip).toHaveTextContent('Sem evolução · 3');
  });

  it('announces the chip via an aria-live region', () => {
    const { container } = render(<OverdueFilterChip count={1} />);

    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });

  it('exposes an accessibly-labelled remove control', () => {
    render(<OverdueFilterChip count={1} />);

    expect(
      screen.getByRole('button', { name: 'Remover filtro: sem evolução' }),
    ).toBeInTheDocument();
  });

  it('clears the filter (returns to /agenda calendar) on click', async () => {
    const user = userEvent.setup();
    render(<OverdueFilterChip count={1} />);

    await user.click(screen.getByTestId('overdue-evolutions-filter-remove'));

    expect(replaceMock).toHaveBeenCalledWith('/agenda', { scroll: false });
  });

  it('is keyboard-accessible: the remove control fires on Enter when focused', async () => {
    const user = userEvent.setup();
    render(<OverdueFilterChip count={1} />);

    await user.tab();
    expect(screen.getByTestId('overdue-evolutions-filter-remove')).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(replaceMock).toHaveBeenCalledWith('/agenda', { scroll: false });
  });
});
