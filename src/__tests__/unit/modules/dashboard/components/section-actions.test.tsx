import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SectionActions } from '@/modules/dashboard/components/section-actions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderActions(overrides: Partial<React.ComponentProps<typeof SectionActions>> = {}) {
  const onNewPatient = vi.fn();
  const onNewSession = vi.fn();
  render(<SectionActions onNewPatient={onNewPatient} onNewSession={onNewSession} {...overrides} />);
  return { onNewPatient, onNewSession };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SectionActions', () => {
  it('invokes onNewPatient when "Novo paciente" is clicked (opens existing modal)', () => {
    const { onNewPatient, onNewSession } = renderActions();

    fireEvent.click(screen.getByTestId('dashboard-actions-new-patient'));

    expect(onNewPatient).toHaveBeenCalledTimes(1);
    expect(onNewSession).not.toHaveBeenCalled();
  });

  it('invokes onNewSession when "Nova sessão" is clicked (opens existing modal)', () => {
    const { onNewPatient, onNewSession } = renderActions();

    fireEvent.click(screen.getByTestId('dashboard-actions-new-session'));

    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(onNewPatient).not.toHaveBeenCalled();
  });

  it('does not navigate the creation actions (they are buttons, not links)', () => {
    renderActions();

    expect(screen.getByTestId('dashboard-actions-new-patient').tagName).toBe('BUTTON');
    expect(screen.getByTestId('dashboard-actions-new-session').tagName).toBe('BUTTON');
  });

  it('links "Ver agenda completa" to /agenda by default', () => {
    renderActions();

    expect(screen.getByTestId('dashboard-actions-agenda')).toHaveAttribute('href', '/agenda');
  });

  it('links "Ver pacientes" to /pacientes by default', () => {
    renderActions();

    expect(screen.getByTestId('dashboard-actions-patients')).toHaveAttribute('href', '/pacientes');
  });

  it('honors custom agenda/patients hrefs', () => {
    renderActions({ agendaHref: '/agenda?view=week', patientsHref: '/pacientes?filter=ativos' });

    expect(screen.getByTestId('dashboard-actions-agenda')).toHaveAttribute(
      'href',
      '/agenda?view=week',
    );
    expect(screen.getByTestId('dashboard-actions-patients')).toHaveAttribute(
      'href',
      '/pacientes?filter=ativos',
    );
  });
});
