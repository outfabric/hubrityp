import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import * as vitestAxeMatchers from 'vitest-axe/matchers';

// Extend Vitest's expect with vitest-axe matchers for toHaveNoViolations().
expect.extend(vitestAxeMatchers);

// Augment vitest's Assertion interface so TypeScript recognizes the matcher.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmentation for vitest-axe matchers
  interface Assertion extends vitestAxeMatchers.AxeMatchers {}
}

// ---------------------------------------------------------------------------
// Mocks: next/navigation (router.push), sonner (toasts)
// ---------------------------------------------------------------------------

const { mockPush, mockRedirect } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  redirect: (url: string) => mockRedirect(url),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockToastInfo = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
    info: (...args: unknown[]) => mockToastInfo(...args) as unknown,
    warning: vi.fn(),
  },
}));

// next/link → plain <a> so the page's status-branch links render in jsdom.
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

// The page reads via the module impl; the route shell (`./actions`) carries a
// `'use server'` directive and pulls server-only deps, so we stub it.
const { mockGetForReview } = vi.hoisted(() => ({ mockGetForReview: vi.fn() }));
vi.mock('@/modules/ai-transcription', async (importOriginal) => {
  const actual = await importOriginal<typeof AiTranscriptionModuleNS>();
  return {
    ...actual,
    getTranscriptionForReviewImpl: (...args: unknown[]) => mockGetForReview(...args) as unknown,
  };
});

vi.mock('@/app/(app)/dashboard/transcricoes/[id]/revisar/actions', () => ({
  updateTranscriptionDraft: vi.fn(),
  saveTranscriptionToProntuario: vi.fn(),
  discardTranscription: vi.fn(),
}));

vi.mock('@/shared/supabase/server', () => ({
  createServerClient: vi.fn().mockResolvedValue({}),
}));

import { TranscriptionReviewForm } from '@/app/(app)/dashboard/transcricoes/[id]/revisar/_components/transcription-review-form';
import RevisarTranscricaoPage from '@/app/(app)/dashboard/transcricoes/[id]/revisar/page';
import type * as AiTranscriptionModuleNS from '@/modules/ai-transcription';
import type { TranscriptionId } from '@/modules/ai-transcription/lib/branded-types';
import type { TranscriptionForReview } from '@/modules/ai-transcription/lib/review-schemas';
import type { GeneratedNote, TranscriptionStatus } from '@/modules/ai-transcription/lib/schemas';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRANSCRIPTION_ID = '11111111-1111-1111-1111-111111111111' as TranscriptionId;
const DISCARD_HREF = '/pacientes/aaaa/prontuario/evolucoes/nova?sessionId=sess-1';
const PRONTUARIO_HREF = '/pacientes/aaaa/prontuario';

const INITIAL_NOTE: GeneratedNote = {
  schemaVersion: 1,
  humorInicial: 'Ansioso',
  humorFinal: 'Mais calmo',
  pauta: ['Trabalho', 'Sono'],
  conteudoTrabalhado: ['Reestruturação cognitiva'],
  tarefaCasa: ['Diário de pensamentos'],
  palavrasRisco: [],
  observacoesExtras: 'Boa adesão',
};

interface RenderOpts {
  updateDraft?: ReturnType<typeof vi.fn>;
  saveToProntuario?: ReturnType<typeof vi.fn>;
  discard?: ReturnType<typeof vi.fn>;
  initialNote?: GeneratedNote | null;
}

function renderForm(opts: RenderOpts = {}) {
  const updateDraftAction =
    opts.updateDraft ??
    vi.fn().mockResolvedValue({ ok: true, savedAt: new Date('2026-05-29T14:32:00Z') });
  const saveToProntuarioAction =
    opts.saveToProntuario ?? vi.fn().mockResolvedValue({ ok: true, evolutionId: 'evo-99' });
  const discardAction = opts.discard ?? vi.fn().mockResolvedValue({ ok: true });

  render(
    <TranscriptionReviewForm
      transcriptionId={TRANSCRIPTION_ID}
      initialNote={opts.initialNote === undefined ? INITIAL_NOTE : opts.initialNote}
      discardRedirectHref={DISCARD_HREF}
      prontuarioHref={PRONTUARIO_HREF}
      updateDraftAction={updateDraftAction}
      saveToProntuarioAction={saveToProntuarioAction}
      discardAction={discardAction}
    />,
  );

  return { updateDraftAction, saveToProntuarioAction, discardAction };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 8.4 (a) — fields render with initial values
// ---------------------------------------------------------------------------

describe('TranscriptionReviewForm — rendering (8.4a)', () => {
  it('renders all note fields populated with the initial values', () => {
    renderForm();

    expect(screen.getByTestId('field-humorInicial')).toHaveValue('Ansioso');
    expect(screen.getByTestId('field-humorFinal')).toHaveValue('Mais calmo');
    // Array fields are rendered one item per line.
    expect(screen.getByTestId('field-pauta')).toHaveValue('Trabalho\nSono');
    expect(screen.getByTestId('field-conteudoTrabalhado')).toHaveValue('Reestruturação cognitiva');
    expect(screen.getByTestId('field-tarefaCasa')).toHaveValue('Diário de pensamentos');
    expect(screen.getByTestId('field-palavrasRisco')).toHaveValue('');
    expect(screen.getByTestId('field-observacoesExtras')).toHaveValue('Boa adesão');
  });

  it('renders empty fields when the note drifted to null', () => {
    renderForm({ initialNote: null });

    expect(screen.getByTestId('field-humorInicial')).toHaveValue('');
    expect(screen.getByTestId('field-pauta')).toHaveValue('');
  });
});

// ---------------------------------------------------------------------------
// 8.4 (b) — checkbox gates the save button
// ---------------------------------------------------------------------------

describe('TranscriptionReviewForm — review checkbox (8.4b)', () => {
  it('disables the save button until the checkbox is checked', async () => {
    const user = userEvent.setup();
    renderForm();

    const saveBtn = screen.getByTestId('save-to-prontuario-btn');
    expect(saveBtn).toBeDisabled();

    await user.click(screen.getByTestId('reviewed-checkbox'));

    expect(saveBtn).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// 8.4 (c) — auto-save fires after 10s (fake timers)
// ---------------------------------------------------------------------------

describe('TranscriptionReviewForm — auto-save interval (8.4c)', () => {
  it('calls updateDraft after the 10s interval elapses', async () => {
    vi.useFakeTimers();
    const updateDraft = vi.fn().mockResolvedValue({ ok: true, savedAt: new Date() });
    renderForm({ updateDraft });

    expect(updateDraft).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(updateDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptionId: TRANSCRIPTION_ID,
        generatedNote: expect.objectContaining({ schemaVersion: 1, humorInicial: 'Ansioso' }),
      }),
    );
  });

  it('stops auto-saving after "Editar mais" is clicked', async () => {
    const user = userEvent.setup();
    const updateDraft = vi.fn().mockResolvedValue({ ok: true, savedAt: new Date() });
    renderForm({ updateDraft });

    await user.click(screen.getByTestId('edit-more-btn'));
    expect(mockToastInfo).toHaveBeenCalled();

    // Switch to fake timers AFTER the click so the interval (re-armed via state)
    // is observed as paused.
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(updateDraft).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8.4 (d) — successful save shows toast and navigates
// ---------------------------------------------------------------------------

describe('TranscriptionReviewForm — save to prontuário (8.4d)', () => {
  it('shows a success toast and navigates to the created evolution on save', async () => {
    const user = userEvent.setup();
    const saveToProntuario = vi.fn().mockResolvedValue({ ok: true, evolutionId: 'evo-99' });
    renderForm({ saveToProntuario });

    await user.click(screen.getByTestId('reviewed-checkbox'));
    await user.click(screen.getByTestId('save-to-prontuario-btn'));

    await waitFor(() => {
      expect(saveToProntuario).toHaveBeenCalledWith({
        transcriptionId: TRANSCRIPTION_ID,
        reviewedChecked: true,
      });
    });

    expect(mockToastSuccess).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/pacientes/aaaa/prontuario/evolucoes/evo-99');
  });

  it('shows an error toast and does not navigate when save fails', async () => {
    const user = userEvent.setup();
    const saveToProntuario = vi.fn().mockResolvedValue({ ok: false, code: 'ALREADY_SAVED' });
    renderForm({ saveToProntuario });

    await user.click(screen.getByTestId('reviewed-checkbox'));
    await user.click(screen.getByTestId('save-to-prontuario-btn'));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8.4 (e) — discard confirmation requires typed input
// ---------------------------------------------------------------------------

describe('TranscriptionReviewForm — discard flow (8.4e)', () => {
  it('keeps the confirm button disabled until "DESCARTAR" is typed', async () => {
    const user = userEvent.setup();
    const discard = vi.fn().mockResolvedValue({ ok: true });
    renderForm({ discard });

    await user.click(screen.getByTestId('discard-btn'));

    const dialog = screen.getByTestId('discard-dialog');
    const confirmBtn = within(dialog).getByTestId('discard-confirm-btn');
    expect(confirmBtn).toBeDisabled();

    const input = within(dialog).getByTestId('discard-confirm-input');
    await user.type(input, 'wrong');
    expect(confirmBtn).toBeDisabled();

    await user.clear(input);
    await user.type(input, 'DESCARTAR');
    expect(confirmBtn).toBeEnabled();

    await user.click(confirmBtn);

    await waitFor(() => {
      expect(discard).toHaveBeenCalledWith({ transcriptionId: TRANSCRIPTION_ID });
    });
    expect(mockToastSuccess).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith(DISCARD_HREF);
  });
});

// ---------------------------------------------------------------------------
// 8.4 (f) — failed-status branch renders a retry button (page-level)
// ---------------------------------------------------------------------------

function makeReviewResult(
  status: TranscriptionStatus,
  overrides: Partial<TranscriptionForReview> = {},
): { ok: true } & TranscriptionForReview {
  return {
    ok: true,
    transcriptionId: TRANSCRIPTION_ID,
    status,
    source: 'manual_upload',
    templateUsed: 'tcc',
    patientFirstName: 'Ana',
    patientId: 'aaaa',
    sessionId: 'sess-1',
    sessionDate: new Date('2026-05-20T14:00:00Z'),
    generatedNote: INITIAL_NOTE,
    riskAlerts: [],
    savedToProntuario: false,
    evolutionId: null,
    errorCode: null,
    createdAt: new Date('2026-05-20T15:00:00Z'),
    completedAt: null,
    ...overrides,
  };
}

async function renderPage() {
  const ui = await RevisarTranscricaoPage({ params: Promise.resolve({ id: TRANSCRIPTION_ID }) });
  return render(ui);
}

describe('RevisarTranscricaoPage — failed/cancelled branch (8.4f)', () => {
  it('renders the retry button (no form) when status is failed', async () => {
    mockGetForReview.mockResolvedValue(makeReviewResult('failed', { errorCode: 'gemini_429' }));

    await renderPage();

    expect(screen.queryByTestId('transcription-review-form')).not.toBeInTheDocument();
    const retry = screen.getByTestId('retry-transcription-btn');
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveAttribute('href', '/pacientes/aaaa/prontuario');
    // The pt-BR reason for the error code is shown.
    expect(screen.getByTestId('transcription-error-state')).toHaveTextContent(
      /IA está sobrecarregado/,
    );
  });

  it('renders the cancelled state without a retry button', async () => {
    mockGetForReview.mockResolvedValue(makeReviewResult('cancelled'));

    await renderPage();

    expect(screen.queryByTestId('transcription-review-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('retry-transcription-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('transcription-error-state')).toBeInTheDocument();
  });

  it('renders the review form when status is ready', async () => {
    mockGetForReview.mockResolvedValue(makeReviewResult('ready'));

    await renderPage();

    expect(screen.getByTestId('transcription-review-form')).toBeInTheDocument();
    expect(screen.getByTestId('draft-warning-banner')).toBeInTheDocument();
  });

  it('renders a neutral not-found state without leaking data on NOT_FOUND', async () => {
    mockGetForReview.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });

    await renderPage();

    expect(screen.getByTestId('transcription-not-found')).toBeInTheDocument();
    expect(screen.queryByTestId('transcription-review-form')).not.toBeInTheDocument();
    // No patient name is rendered for an inaccessible row.
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  });

  it('redirects to /login on UNAUTHORIZED (defense-in-depth)', async () => {
    mockGetForReview.mockResolvedValue({ ok: false, code: 'UNAUTHORIZED' });

    await expect(renderPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });
});

// ---------------------------------------------------------------------------
// 8.5 — accessibility
// ---------------------------------------------------------------------------

describe('TranscriptionReviewForm — accessibility (8.5)', () => {
  it('every field has an associated label and is keyboard reachable', async () => {
    const user = userEvent.setup();
    renderForm();

    // Labels are associated via htmlFor/id, so getByLabelText resolves them.
    expect(screen.getByLabelText('Humor inicial')).toBe(screen.getByTestId('field-humorInicial'));
    expect(screen.getByLabelText('Pauta')).toBe(screen.getByTestId('field-pauta'));
    expect(screen.getByLabelText('Revisei a nota e confirmo que reflete a sessão.')).toBe(
      screen.getByTestId('reviewed-checkbox'),
    );

    // Tab order reaches the first text field.
    await user.tab();
    expect(screen.getByTestId('field-humorInicial')).toHaveFocus();
  });

  it('closes the discard AlertDialog when Escape is pressed', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByTestId('discard-btn'));
    expect(screen.getByTestId('discard-dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByTestId('discard-dialog')).not.toBeInTheDocument();
    });
  });

  it('has no axe-core violations', async () => {
    const { container } = render(
      <TranscriptionReviewForm
        transcriptionId={TRANSCRIPTION_ID}
        initialNote={INITIAL_NOTE}
        discardRedirectHref={DISCARD_HREF}
        prontuarioHref={PRONTUARIO_HREF}
        updateDraftAction={vi.fn().mockResolvedValue({ ok: true, savedAt: new Date() })}
        saveToProntuarioAction={vi.fn().mockResolvedValue({ ok: true, evolutionId: 'evo-1' })}
        discardAction={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
