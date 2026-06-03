import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TodaySessionView, TodaySessionsResult } from '@/modules/dashboard';
import { SectionToday } from '@/modules/dashboard/components/section-today';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<TodaySessionView> = {}): TodaySessionView {
  return {
    sessionId: 'sess-1',
    patientId: 'pat-1',
    patientName: 'Ana Souza',
    // 14:00 in São Paulo (UTC-3) → 17:00 UTC
    startAt: new Date('2026-06-03T17:00:00.000Z'),
    modality: 'online',
    status: 'scheduled',
    openHref: '/sessao/sess-1/video',
    ...overrides,
  };
}

function makeResult(overrides: Partial<TodaySessionsResult> = {}): TodaySessionsResult {
  const next = makeSession();
  return {
    ok: true,
    next,
    sessions: [next],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SectionToday', () => {
  it('renders the next session with patient name, São Paulo time and modality', () => {
    render(<SectionToday result={makeResult()} />);

    const next = screen.getByTestId('dashboard-today-next');
    expect(within(next).getByText(/Ana Souza/)).toBeInTheDocument();
    // 17:00 UTC formatted to America/Sao_Paulo (UTC-3) is 14:00.
    expect(within(next).getByText(/14:00/)).toBeInTheDocument();
    expect(within(next).getByText('Online')).toBeInTheDocument();
  });

  it('renders the compact list of the day sessions with status badges', () => {
    const sessions: TodaySessionView[] = [
      makeSession({ sessionId: 's1', patientName: 'Ana', status: 'confirmed' }),
      makeSession({
        sessionId: 's2',
        patientName: 'Bruno',
        status: 'done',
        modality: 'in_person',
        openHref: '/pacientes/pat-2',
      }),
    ];
    render(<SectionToday result={makeResult({ next: sessions[0], sessions })} />);

    const items = screen.getAllByTestId('dashboard-today-list-item');
    expect(items).toHaveLength(2);
    expect(screen.getByTestId('dashboard-today-status-confirmed')).toHaveTextContent('Confirmada');
    expect(screen.getByTestId('dashboard-today-status-done')).toHaveTextContent('Realizada');
  });

  it('maps every session status to the correct badge label', () => {
    const statuses: TodaySessionView['status'][] = [
      'scheduled',
      'confirmed',
      'done',
      'cancelled',
      'no_show',
    ];
    const sessions = statuses.map((status, i) =>
      makeSession({ sessionId: `s-${status}`, status, patientName: `P${i}` }),
    );
    render(<SectionToday result={makeResult({ next: sessions[0], sessions })} />);

    expect(screen.getByTestId('dashboard-today-status-scheduled')).toHaveTextContent('Agendada');
    expect(screen.getByTestId('dashboard-today-status-confirmed')).toHaveTextContent('Confirmada');
    expect(screen.getByTestId('dashboard-today-status-done')).toHaveTextContent('Realizada');
    expect(screen.getByTestId('dashboard-today-status-cancelled')).toHaveTextContent('Cancelada');
    expect(screen.getByTestId('dashboard-today-status-no_show')).toHaveTextContent('Faltou');
  });

  it('points "Abrir sessão" to the video room for an online session', () => {
    const next = makeSession({ modality: 'online', openHref: '/sessao/sess-1/video' });
    render(<SectionToday result={makeResult({ next, sessions: [next] })} />);

    expect(screen.getByTestId('dashboard-today-open-session')).toHaveAttribute(
      'href',
      '/sessao/sess-1/video',
    );
  });

  it('points "Abrir sessão" to the patient file for an in_person session (href differs)', () => {
    const next = makeSession({
      modality: 'in_person',
      patientId: 'pat-9',
      openHref: '/pacientes/pat-9',
    });
    render(<SectionToday result={makeResult({ next, sessions: [next] })} />);

    expect(screen.getByTestId('dashboard-today-open-session')).toHaveAttribute(
      'href',
      '/pacientes/pat-9',
    );
  });

  it('renders the schedule CTA empty state when there are no sessions today', () => {
    render(<SectionToday result={makeResult({ next: null, sessions: [] })} />);

    expect(screen.getByTestId('dashboard-today-empty')).toHaveTextContent('Nenhuma sessão hoje');
    const link = screen.getByTestId('dashboard-today-schedule-link');
    expect(link).toHaveTextContent('agendar uma');
    expect(link).toHaveAttribute('href', '/agenda');
    expect(screen.queryByTestId('dashboard-today-open-session')).not.toBeInTheDocument();
  });

  it('respects a custom agendaHref on the empty-state link', () => {
    render(
      <SectionToday
        result={makeResult({ next: null, sessions: [] })}
        agendaHref="/agenda?novo=1"
      />,
    );

    expect(screen.getByTestId('dashboard-today-schedule-link')).toHaveAttribute(
      'href',
      '/agenda?novo=1',
    );
  });

  it('omits the "Abrir sessão" CTA when openHref is null', () => {
    const next = makeSession({ openHref: null });
    render(<SectionToday result={makeResult({ next, sessions: [next] })} />);

    expect(screen.queryByTestId('dashboard-today-open-session')).not.toBeInTheDocument();
  });
});
