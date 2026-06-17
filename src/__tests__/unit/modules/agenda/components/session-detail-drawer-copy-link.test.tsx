import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionDetailDrawer } from '@/modules/agenda/components/session-detail-drawer';
import type { SessionWithDetails } from '@/modules/agenda/server/list-sessions';

// The drawer dynamically imports the page-level Server Actions module to fetch
// session history when it opens. That module carries `'use server'` and pulls
// server-only code, so we stub it to keep this a pure component unit test.
vi.mock('@/app/(app)/agenda/actions', () => ({
  getSessionHistory: vi.fn().mockResolvedValue({ ok: true, history: [] }),
  deleteSession: vi.fn(),
  confirmSession: vi.fn(),
  markSessionDone: vi.fn(),
  markSessionNoShow: vi.fn(),
  reactivateSession: vi.fn(),
  cancelSession: vi.fn(),
  softDeleteSession: vi.fn(),
}));

const errorToast = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => {
      errorToast(...args);
    },
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VIDEO_URL = 'https://app.hubrity.com/sessao/abc-123-token/paciente';

function buildSession(overrides: Partial<SessionWithDetails> = {}): SessionWithDetails {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    psychologistId: '00000000-0000-4000-8000-0000000000aa',
    patientIds: ['00000000-0000-4000-8000-0000000000bb'],
    locationId: null,
    recurrenceId: null,
    startAt: new Date('2026-07-01T13:00:00.000Z'),
    durationMinutes: 50,
    status: 'scheduled',
    modality: 'online',
    amount: null,
    notes: null,
    isBlocking: false,
    blockingTitle: null,
    deletedAt: null,
    createdAt: new Date('2026-06-01T13:00:00.000Z'),
    updatedAt: new Date('2026-06-01T13:00:00.000Z'),
    patientName: 'Maria Teste',
    patientPhone: null,
    patientWhatsappOptOut: false,
    locationName: null,
    locationType: null,
    locationAddress: null,
    coupleDisplayName: null,
    patientVideoUrl: VIDEO_URL,
  } as unknown as SessionWithDetails;

  return { ...base, ...overrides };
}

function renderDrawer(session: SessionWithDetails) {
  return render(
    <SessionDetailDrawer
      session={session}
      open
      onOpenChange={() => {}}
      onSessionMutated={() => {}}
    />,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  errorToast.mockClear();
  // matchMedia is consumed by the drawer's responsive hook.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionDetailDrawer — "Link do paciente" copy section', () => {
  it('renders the section for an online scheduled session with a patient video URL', () => {
    renderDrawer(buildSession());

    const section = screen.getByTestId('patient-video-link-section');
    expect(section).toBeInTheDocument();
    expect(section).toHaveTextContent('Link do paciente');
    expect(screen.getByText(VIDEO_URL)).toHaveAttribute('title', VIDEO_URL);
    expect(screen.getByTestId('copy-patient-link-button')).toHaveTextContent('Copiar link');
  });

  it('renders the section for an online confirmed session with a patient video URL', () => {
    renderDrawer(buildSession({ status: 'confirmed' }));

    expect(screen.getByTestId('patient-video-link-section')).toBeInTheDocument();
  });

  it('does NOT render the section for in-person sessions', () => {
    renderDrawer(buildSession({ modality: 'in_person' }));

    expect(screen.queryByTestId('patient-video-link-section')).not.toBeInTheDocument();
  });

  it('does NOT render the section for blocking slots', () => {
    renderDrawer(
      buildSession({ isBlocking: true, blockingTitle: 'Almoco', patientVideoUrl: null }),
    );

    expect(screen.queryByTestId('patient-video-link-section')).not.toBeInTheDocument();
  });

  it('does NOT render the section when the patient video URL is null', () => {
    renderDrawer(buildSession({ patientVideoUrl: null }));

    expect(screen.queryByTestId('patient-video-link-section')).not.toBeInTheDocument();
  });

  it('does NOT render the section for cancelled online sessions', () => {
    renderDrawer(buildSession({ status: 'cancelled' }));

    expect(screen.queryByTestId('patient-video-link-section')).not.toBeInTheDocument();
  });

  it('copies the full URL to the clipboard when "Copiar link" is clicked', async () => {
    const user = userEvent.setup();

    // navigator.clipboard is a getter in jsdom — override it explicitly.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    renderDrawer(buildSession());

    const button = screen.getByTestId('copy-patient-link-button');
    await user.click(button);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(VIDEO_URL);
    });
    // Inline confirmation: text flips to "Copiado!" (no success toast).
    await waitFor(() => {
      expect(button).toHaveTextContent('Copiado!');
    });
  });

  it('shows an error toast when the clipboard write fails', async () => {
    const user = userEvent.setup();

    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    renderDrawer(buildSession());

    await user.click(screen.getByTestId('copy-patient-link-button'));

    await waitFor(() => {
      expect(errorToast).toHaveBeenCalledTimes(1);
    });
  });
});
