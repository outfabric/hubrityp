import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionFormModal } from '@/modules/agenda/components/session-form-modal';
import type { SessionEditData } from '@/modules/agenda/components/session-form-modal';

// Capture the exact arguments passed to `toast.success` so we can assert
// whether the post-scheduling toast carries the "Copiar link" copy action.
const successToast = vi.fn();
const errorToast = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => {
      successToast(...args);
    },
    error: (...args: unknown[]) => {
      errorToast(...args);
    },
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENT = {
  id: '00000000-0000-4000-8000-0000000000bb',
  fullName: 'Maria Teste',
  phone: null,
  whatsappOptOut: false,
};

const VIDEO_URL = 'https://app.hubrityp.com/sessao/abc-123-token/paciente';

const LOCATIONS = [
  {
    id: '00000000-0000-4000-8000-0000000000cc',
    name: 'Consultório',
    type: 'office',
    isDefault: true,
  },
];

function buildEditSession(overrides: Partial<SessionEditData> = {}): SessionEditData {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    patientId: PATIENT.id,
    patientName: PATIENT.fullName,
    isBlocking: false,
    blockingTitle: null,
    startAt: new Date('2026-07-01T13:00:00.000Z'),
    durationMinutes: 50,
    locationId: LOCATIONS[0]!.id,
    modality: 'online',
    amount: null,
    notes: null,
    color: null,
    remindersDisabled: false,
    patientPhone: null,
    patientWhatsappOptOut: false,
    ...overrides,
  };
}

type Mutation = ReturnType<typeof vi.fn>;

interface RenderOpts {
  session?: SessionEditData | null;
  onCreate?: Mutation;
  onUpdate?: Mutation;
}

function renderModal({ session = null, onCreate, onUpdate }: RenderOpts = {}) {
  const create = onCreate ?? vi.fn().mockResolvedValue({ ok: true, sessionId: 'new-id' });
  const update = onUpdate ?? vi.fn().mockResolvedValue({ ok: true, sessionId: session?.id });

  render(
    <SessionFormModal
      open
      onOpenChange={() => {}}
      session={session}
      locations={LOCATIONS}
      defaultDurationMinutes={50}
      onCreate={create}
      onUpdate={update}
      onSearchPatients={vi.fn().mockResolvedValue({ ok: true, patients: [PATIENT] })}
      onSuccess={() => {}}
    />,
  );

  return { create, update };
}

/** Selects the seed patient through the combobox (type → debounce → click option). */
async function selectPatient(user: ReturnType<typeof userEvent.setup>) {
  const searchInput = screen.getByTestId('session-form-patient-search');
  await user.type(searchInput, 'Maria');
  const option = await screen.findByTestId(`patient-option-${PATIENT.id}`);
  await user.click(option);
}

async function submitForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('session-form-save'));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  successToast.mockClear();
  errorToast.mockClear();
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

describe('SessionFormModal — post-scheduling copy toast', () => {
  it('shows a toast with the "Copiar link" action when an online session is created with a patient video URL', async () => {
    const user = userEvent.setup();
    const onCreate = vi
      .fn()
      .mockResolvedValue({ ok: true, sessionId: 'new-id', patientVideoUrl: VIDEO_URL });

    renderModal({ onCreate });

    await selectPatient(user);
    await submitForm(user);

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(successToast).toHaveBeenCalledTimes(1);
    });

    const [title, options] = successToast.mock.calls[0] as [string, Record<string, unknown>];
    expect(title).toBe('Sessão agendada com sucesso.');
    expect(options).toMatchObject({
      description: 'Link do paciente disponível para cópia.',
      duration: 8000,
    });
    const action = options.action as { label: string; onClick: () => void };
    expect(action.label).toBe('Copiar link');

    // The action copies the patient URL to the clipboard.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    action.onClick();
    expect(writeText).toHaveBeenCalledWith(VIDEO_URL);
  });

  it('shows the simple toast without a copy action when the create result has no patient video URL', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue({ ok: true, sessionId: 'new-id' });

    renderModal({ onCreate });

    await selectPatient(user);
    await submitForm(user);

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(successToast).toHaveBeenCalledTimes(1);
    });

    const call = successToast.mock.calls[0] as unknown[];
    expect(call[0]).toBe('Sessao agendada com sucesso.');
    // No options object → no copy action, default auto-dismiss.
    expect(call[1]).toBeUndefined();
  });

  it('shows the "Sessao atualizada" toast without a copy action when editing a session', async () => {
    const user = userEvent.setup();
    const onUpdate = vi
      .fn()
      .mockResolvedValue({ ok: true, sessionId: '00000000-0000-4000-8000-000000000001' });

    renderModal({ session: buildEditSession(), onUpdate });

    // Edit mode pre-fills the patient; submit straight away.
    await submitForm(user);

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(successToast).toHaveBeenCalledTimes(1);
    });

    const call = successToast.mock.calls[0] as unknown[];
    expect(call[0]).toBe('Sessao atualizada com sucesso.');
    expect(call[1]).toBeUndefined();
  });
});
