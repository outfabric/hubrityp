import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PatientTabs } from '@/modules/patients/components/patient-tabs';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Render a plain <a> so we can assert href without the full Next.js router.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PATIENT_ID = 'abc-123';

function renderTabs() {
  return render(
    <PatientTabs patientId={PATIENT_ID} overviewContent={<div />} anamnesisContent={<div />} />,
  );
}

// ---------------------------------------------------------------------------
// Tests — scoped to the three deltas of this change
// ---------------------------------------------------------------------------

describe('PatientTabs — delta (a): "Documentos" tab removed', () => {
  it('does not render a documents tab trigger or content panel', () => {
    renderTabs();

    expect(screen.queryByTestId('patient-tab-documents')).not.toBeInTheDocument();
    expect(screen.queryByTestId('patient-tab-content-documents')).not.toBeInTheDocument();
  });
});

describe('PatientTabs — delta (b): "Financeiro" icon is Receipt', () => {
  it('renders the Receipt icon and not the Wallet icon inside the financial trigger', () => {
    renderTabs();

    const financialTrigger = screen.getByTestId('patient-tab-financial');
    const svg = financialTrigger.querySelector('svg');

    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass('lucide-receipt');
    expect(financialTrigger.querySelector('.lucide-wallet')).not.toBeInTheDocument();
  });
});

describe('PatientTabs — delta (c): "Prontuario" tab redirects', () => {
  it('clicking the records tab shows the redirect panel with a link to the prontuario page', async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByTestId('patient-tab-records'));

    const contentPanel = screen.getByTestId('patient-tab-content-records');
    expect(contentPanel).toBeVisible();

    expect(contentPanel).toHaveTextContent('Prontuário');

    const link = screen.getByTestId('patient-tab-records-open-prontuario');
    expect(link).toHaveAttribute('href', `/pacientes/${PATIENT_ID}/prontuario`);
  });
});
