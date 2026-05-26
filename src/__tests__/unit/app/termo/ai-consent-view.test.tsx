import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AiConsentView } from '@/app/termo/[token]/_components/ai-consent-view';
import type { AiConsentSection } from '@/app/termo/[token]/_components/ai-consent-view';

// ---------------------------------------------------------------------------
// Fixture — 8 sections matching the V1 template
// ---------------------------------------------------------------------------

const FIXTURE_SECTIONS: AiConsentSection[] = [
  {
    heading: 'Identificacao',
    body: 'Profissional responsavel: Dr. Teste, inscrito(a) no CRP sob o numero 12345/SP.\n\nPaciente: Maria Silva.',
  },
  {
    heading: 'Finalidade',
    body: 'A gravacao da sessao sera realizada exclusivamente para processamento por IA.',
  },
  {
    heading: 'Bases legais',
    body: 'O tratamento dos dados pessoais fundamenta-se na LGPD.',
  },
  {
    heading: 'Operacao de tratamento',
    body: 'Controlador: o psicologo identificado neste termo.',
  },
  {
    heading: 'Retencao',
    body: 'O audio sera descartado no prazo maximo de 24 horas apos o processamento.',
  },
  {
    heading: 'Direitos do titular',
    body: 'Em conformidade com o art. 18 da LGPD, o paciente tem direito a confirmacao.',
  },
  {
    heading: 'Revogacao',
    body: 'O paciente pode revogar este consentimento a qualquer momento.',
  },
  {
    heading: 'Riscos',
    body: 'O paciente deve estar ciente dos riscos associados ao uso de IA.',
  },
];

const DEFAULT_PROPS = {
  token: 'test-token-base64url-43-chars-abcdefgh',
  title: 'Termo de Consentimento para IA',
  sections: FIXTURE_SECTIONS,
  psychologistName: 'Dr. Teste',
  psychologistCrp: '12345/SP',
  patientName: 'Maria Silva',
  signAction: vi.fn().mockResolvedValue({ ok: true }),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiConsentView', () => {
  it('renders all 8 sections from a snapshot fixture', () => {
    render(<AiConsentView {...DEFAULT_PROPS} />);

    const sectionEls = screen.getAllByTestId('ai-consent-section');
    expect(sectionEls).toHaveLength(8);

    // Verify each section heading is present
    for (const section of FIXTURE_SECTIONS) {
      expect(screen.getByText(section.heading)).toBeInTheDocument();
    }
  });

  it('renders the title and psychologist info', () => {
    render(<AiConsentView {...DEFAULT_PROPS} />);

    expect(screen.getByText('Termo de Consentimento para IA')).toBeInTheDocument();
    expect(screen.getByText(/Psicologo\(a\): Dr\. Teste — CRP 12345\/SP/)).toBeInTheDocument();
  });

  it('submit button is disabled until checkbox is checked', () => {
    render(<AiConsentView {...DEFAULT_PROPS} />);

    const signButton = screen.getByTestId('ai-consent-sign-button');
    expect(signButton).toBeDisabled();

    // Check the checkbox
    const checkbox = screen.getByTestId('ai-consent-checkbox');
    fireEvent.click(checkbox);

    expect(signButton).toBeEnabled();
  });

  it('clicking submit calls the sign action with the token', async () => {
    const signAction = vi.fn().mockResolvedValue({ ok: true });
    render(<AiConsentView {...DEFAULT_PROPS} signAction={signAction} />);

    // Check checkbox
    const checkbox = screen.getByTestId('ai-consent-checkbox');
    fireEvent.click(checkbox);

    // Click sign
    const signButton = screen.getByTestId('ai-consent-sign-button');
    fireEvent.click(signButton);

    await waitFor(() => {
      expect(signAction).toHaveBeenCalledWith(DEFAULT_PROPS.token);
    });
  });

  it('shows success message after successful signing', async () => {
    const signAction = vi.fn().mockResolvedValue({ ok: true });
    render(<AiConsentView {...DEFAULT_PROPS} signAction={signAction} />);

    // Check checkbox and sign
    const checkbox = screen.getByTestId('ai-consent-checkbox');
    fireEvent.click(checkbox);
    const signButton = screen.getByTestId('ai-consent-sign-button');
    fireEvent.click(signButton);

    await waitFor(() => {
      expect(screen.getByTestId('ai-consent-success')).toBeInTheDocument();
    });
    expect(screen.getByText('Termo assinado com sucesso')).toBeInTheDocument();
  });

  it('shows error message when signing fails', async () => {
    const signAction = vi.fn().mockResolvedValue({
      ok: false,
      error: 'unknown',
      message: 'Erro no servidor',
    });
    render(<AiConsentView {...DEFAULT_PROPS} signAction={signAction} />);

    // Check checkbox and sign
    const checkbox = screen.getByTestId('ai-consent-checkbox');
    fireEvent.click(checkbox);
    const signButton = screen.getByTestId('ai-consent-sign-button');
    fireEvent.click(signButton);

    await waitFor(() => {
      expect(screen.getByText('Erro no servidor')).toBeInTheDocument();
    });
  });

  it('renders section body with preserved whitespace', () => {
    render(<AiConsentView {...DEFAULT_PROPS} />);

    // The first section has a newline in its body
    const bodyEl = screen.getByText(/Profissional responsavel: Dr\. Teste/);
    expect(bodyEl).toBeInTheDocument();
    expect(bodyEl.className).toContain('whitespace-pre-wrap');
  });

  it('renders the name confirmation input with patient name as placeholder', () => {
    render(<AiConsentView {...DEFAULT_PROPS} />);

    const nameInput = screen.getByTestId('ai-consent-name-input');
    expect(nameInput).toBeInTheDocument();
    expect(nameInput).toHaveAttribute('placeholder', 'Maria Silva');
  });

  it('unchecking the checkbox re-disables the submit button', async () => {
    const user = userEvent.setup();
    render(<AiConsentView {...DEFAULT_PROPS} />);

    const signButton = screen.getByTestId('ai-consent-sign-button');
    const checkbox = screen.getByTestId('ai-consent-checkbox');

    // Check then uncheck
    await user.click(checkbox);
    expect(signButton).toBeEnabled();

    await user.click(checkbox);
    expect(signButton).toBeDisabled();
  });
});
