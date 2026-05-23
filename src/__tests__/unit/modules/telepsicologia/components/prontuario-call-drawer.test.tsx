import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted by Vitest before the component import.
// ---------------------------------------------------------------------------

// Mock the EvolutionEditor (heavy component with Tiptap) to avoid pulling
// in the full rich-text dependency tree in unit tests.
vi.mock('@/modules/medical-records/components/evolution-editor', () => ({
  EvolutionEditor: () => <div data-testid="mock-evolution-editor">Editor</div>,
}));

// Mock the TemplateSelector to avoid importing shadcn Select internals.
vi.mock('@/modules/medical-records/components/template-selector', () => ({
  TemplateSelector: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select
      data-testid="mock-template-selector"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="livre">Livre</option>
      <option value="tcc">TCC</option>
    </select>
  ),
}));

// Mock the AutoSaveIndicator to avoid importing date-fns in the test.
vi.mock('@/modules/medical-records/components/auto-save-indicator', () => ({
  AutoSaveIndicator: () => <div data-testid="mock-auto-save-indicator">Auto Save</div>,
}));

// Mock next/link to render a plain anchor tag.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

import type { EvolutionSummary } from '@/modules/medical-records';
import { ProntuarioCallDrawer } from '@/modules/telepsicologia/components/prontuario-call-drawer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const defaultProps = {
  open: true as boolean,
  onOpenChange: vi.fn() as (open: boolean) => void,
  patientId: 'patient-uuid-123',
  patientName: 'Maria Silva',
  recentEvolutions: [] as EvolutionSummary[],
  onCreateEvolution: vi.fn().mockResolvedValue({ ok: true, id: 'evo-1' }),
  onUpdateEvolution: vi.fn().mockResolvedValue({ ok: true }),
};

function renderDrawer(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<ProntuarioCallDrawer {...props} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProntuarioCallDrawer', () => {
  it('renders when open and shows patient name in header', () => {
    renderDrawer();

    expect(screen.getByTestId('prontuario-drawer')).toBeInTheDocument();
    expect(screen.getByText('Prontuario de Maria Silva')).toBeInTheDocument();
  });

  it('does not render content when closed', () => {
    renderDrawer({ open: false });

    expect(screen.queryByTestId('prontuario-drawer')).not.toBeInTheDocument();
  });

  it('toggles open/close via rerender', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ProntuarioCallDrawer {...defaultProps} open={true} onOpenChange={onOpenChange} />,
    );

    expect(screen.getByTestId('prontuario-drawer')).toBeInTheDocument();

    rerender(<ProntuarioCallDrawer {...defaultProps} open={false} onOpenChange={onOpenChange} />);

    expect(screen.queryByTestId('prontuario-drawer')).not.toBeInTheDocument();
  });

  it('renders "Abrir prontuario completo" link with correct href', () => {
    renderDrawer({ patientId: 'patient-abc-456' });

    const link = screen.getByTestId('open-full-prontuario-link');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/pacientes/patient-abc-456/prontuario');
    expect(link).toHaveTextContent('Abrir prontuario completo');
  });

  it('shows empty state when there are no recent evolutions', () => {
    renderDrawer({ recentEvolutions: [] });

    expect(screen.getByText('Nenhuma evolucao registrada.')).toBeInTheDocument();
  });

  it('renders recent evolutions list when evolutions exist', () => {
    const evolutions: EvolutionSummary[] = [
      {
        id: 'evo-1',
        patientId: 'patient-uuid-123',
        sessionId: null,
        templateType: 'livre',
        currentVersion: 1,
        createdAt: new Date('2026-05-23T10:00:00Z'),
        updatedAt: new Date('2026-05-23T10:00:00Z'),
        finalizedAt: null,
      },
      {
        id: 'evo-2',
        patientId: 'patient-uuid-123',
        sessionId: null,
        templateType: 'tcc',
        currentVersion: 1,
        createdAt: new Date('2026-05-22T14:00:00Z'),
        updatedAt: new Date('2026-05-22T14:00:00Z'),
        finalizedAt: new Date('2026-05-22T15:00:00Z'),
      },
    ];

    renderDrawer({ recentEvolutions: evolutions });

    expect(screen.getByTestId('recent-evolutions-list')).toBeInTheDocument();
    expect(screen.getByText('Evolucoes recentes (2)')).toBeInTheDocument();
    // Finalized evolution shows indicator
    expect(screen.getByText('Finalizada')).toBeInTheDocument();
  });

  it('calls onCreateEvolution when create button is clicked', async () => {
    const user = userEvent.setup();
    const onCreateEvolution = vi.fn().mockResolvedValue({ ok: true, id: 'new-evo' });
    renderDrawer({ onCreateEvolution });

    const createButton = screen.getByTestId('create-evolution-button');
    await user.click(createButton);

    expect(onCreateEvolution).toHaveBeenCalledWith({
      patientId: 'patient-uuid-123',
      templateType: 'livre',
      content: { conteudo: '' },
    });
  });
});
