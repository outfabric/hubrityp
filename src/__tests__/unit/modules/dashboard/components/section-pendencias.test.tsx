import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PendenciasResult } from '@/modules/dashboard';
import { SectionPendencias } from '@/modules/dashboard/components/section-pendencias';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<PendenciasResult> = {}): PendenciasResult {
  return {
    ok: true,
    overdueEvolutionsCount: 2,
    overdueEvolutionsHref: '/agenda?pendencia=evolucoes',
    patientsMissingConsentCount: 1,
    patientsMissingConsentHref: '/pacientes?pendencia=consentimento',
    aiNotesAwaitingReviewCount: 3,
    aiNotesAwaitingReviewHref: '/caixa-de-entrada?pendencia=ia',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SectionPendencias', () => {
  it('renders the three MVP rows with counts and deep links', () => {
    render(<SectionPendencias result={makeResult()} />);

    const overdue = screen.getByTestId('dashboard-pendencias-row-overdue-evolutions');
    expect(overdue).toHaveTextContent('2');
    expect(overdue).toHaveTextContent('sessões sem evolução');
    expect(screen.getByTestId('dashboard-pendencias-link-overdue-evolutions')).toHaveAttribute(
      'href',
      '/agenda?pendencia=evolucoes',
    );

    const consent = screen.getByTestId('dashboard-pendencias-row-missing-consent');
    expect(consent).toHaveTextContent('1');
    expect(consent).toHaveTextContent('paciente sem consentimento');
    expect(screen.getByTestId('dashboard-pendencias-link-missing-consent')).toHaveAttribute(
      'href',
      '/pacientes?pendencia=consentimento',
    );

    const ai = screen.getByTestId('dashboard-pendencias-row-ai-review');
    expect(ai).toHaveTextContent('3');
    expect(ai).toHaveTextContent('notas de IA para revisar');
    expect(screen.getByTestId('dashboard-pendencias-link-ai-review')).toHaveAttribute(
      'href',
      '/caixa-de-entrada?pendencia=ia',
    );
  });

  it('uses singular labels when a count is exactly 1', () => {
    render(
      <SectionPendencias
        result={makeResult({
          overdueEvolutionsCount: 1,
          patientsMissingConsentCount: 1,
          aiNotesAwaitingReviewCount: 1,
        })}
      />,
    );

    expect(screen.getByTestId('dashboard-pendencias-row-overdue-evolutions')).toHaveTextContent(
      'sessão sem evolução',
    );
    expect(screen.getByTestId('dashboard-pendencias-row-ai-review')).toHaveTextContent(
      'nota de IA para revisar',
    );
  });

  it('hides rows whose count is zero', () => {
    render(
      <SectionPendencias
        result={makeResult({ patientsMissingConsentCount: 0, aiNotesAwaitingReviewCount: 0 })}
      />,
    );

    expect(screen.getByTestId('dashboard-pendencias-row-overdue-evolutions')).toBeInTheDocument();
    expect(
      screen.queryByTestId('dashboard-pendencias-row-missing-consent'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-pendencias-row-ai-review')).not.toBeInTheDocument();
  });

  it('shows the positive "Tudo em dia." state when every count is zero', () => {
    render(
      <SectionPendencias
        result={makeResult({
          overdueEvolutionsCount: 0,
          patientsMissingConsentCount: 0,
          aiNotesAwaitingReviewCount: 0,
        })}
      />,
    );

    expect(screen.getByTestId('dashboard-pendencias-clear')).toHaveTextContent('Tudo em dia.');
    expect(screen.queryByTestId('dashboard-pendencias-list')).not.toBeInTheDocument();
  });

  it('never renders any post-MVP pendência string', () => {
    const { container } = render(<SectionPendencias result={makeResult()} />);

    const text = container.textContent ?? '';
    expect(text).not.toContain('Receita Saúde');
    expect(text).not.toContain('cobrança');
    expect(text).not.toContain('WhatsApp');
  });

  it('never renders post-MVP strings even in the all-clear state', () => {
    const { container } = render(
      <SectionPendencias
        result={makeResult({
          overdueEvolutionsCount: 0,
          patientsMissingConsentCount: 0,
          aiNotesAwaitingReviewCount: 0,
        })}
      />,
    );

    const text = container.textContent ?? '';
    expect(text).not.toContain('Receita Saúde');
    expect(text).not.toContain('cobrança');
    expect(text).not.toContain('WhatsApp');
  });
});
