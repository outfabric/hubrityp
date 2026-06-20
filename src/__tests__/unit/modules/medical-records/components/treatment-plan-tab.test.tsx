import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GetTreatmentPlanResult, UpsertTreatmentPlanResult } from '@/modules/medical-records';
import { TreatmentPlanTab } from '@/modules/medical-records/components/treatment-plan/treatment-plan-tab';
import type { TreatmentPlan } from '@/shared/db/schema/medical-records/tables';

// ---------------------------------------------------------------------------
// Mock sonner — the manual-save validation path surfaces a toast, which we
// assert on. The real toast renderer needs a mounted <Toaster/> portal that
// jsdom does not provide, so a spy keeps the test focused on the call.
// ---------------------------------------------------------------------------
const toastErrorMock = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => {
      toastErrorMock(...args);
    },
    success: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock TiptapEditor — the real editor pulls ProseMirror, which needs DOM APIs
// (ResizeObserver, getClientRects) jsdom lacks. Resources/criteria changes flow
// through onChange exactly like a textarea, so this faithfully drives the same
// dirty/save path while keeping the test focused.
// ---------------------------------------------------------------------------
vi.mock('@/modules/patients/components/tiptap-editor', () => ({
  TiptapEditor: ({
    content,
    onChange,
    'aria-label': ariaLabel,
  }: {
    content: string;
    onChange: (html: string) => void;
    'aria-label'?: string;
  }) => (
    <textarea aria-label={ariaLabel} value={content} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';

const PLAN_ID = '22222222-2222-4222-8222-222222222222';

/** A persisted-but-empty plan so the tab mounts directly into editor mode. */
function emptyPersistedPlan(): TreatmentPlan {
  return {
    id: PLAN_ID,
    userId: '33333333-3333-4333-8333-333333333333',
    patientId: PATIENT_ID,
    goals: [],
    phases: [],
    resources: null,
    successCriteria: null,
    currentVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function renderTab(overrides?: {
  upsert?: (input: unknown) => Promise<UpsertTreatmentPlanResult>;
}) {
  const getTreatmentPlan = vi
    .fn<(input: { patientId: string }) => Promise<GetTreatmentPlanResult>>()
    .mockResolvedValue({ ok: true, plan: emptyPersistedPlan() });

  const upsertTreatmentPlan = vi
    .fn<(input: unknown) => Promise<UpsertTreatmentPlanResult>>()
    .mockImplementation(
      overrides?.upsert ??
        (() => Promise.resolve({ ok: true as const, planId: PLAN_ID, version: 2 })),
    );

  const listTreatmentPlanVersions = vi.fn().mockResolvedValue({ ok: true, versions: [] });

  render(
    <TreatmentPlanTab
      patientId={PATIENT_ID}
      getTreatmentPlan={getTreatmentPlan}
      upsertTreatmentPlan={
        upsertTreatmentPlan as unknown as React.ComponentProps<
          typeof TreatmentPlanTab
        >['upsertTreatmentPlan']
      }
      listTreatmentPlanVersions={listTreatmentPlanVersions}
    />,
  );

  return { getTreatmentPlan, upsertTreatmentPlan, listTreatmentPlanVersions };
}

/** Wait for the async initial load to resolve into editor mode. */
async function waitForEditor() {
  await screen.findByTestId('treatment-plan-editor');
}

beforeEach(() => {
  toastErrorMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TreatmentPlanTab — manual save button', () => {
  it('disables the save button while the plan is unchanged', async () => {
    renderTab();
    await waitForEditor();

    expect(screen.getByTestId('treatment-plan-save-button')).toBeDisabled();
  });

  it('enables the save button after editing a goal description', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitForEditor();

    await user.click(screen.getByTestId('goals-add-button'));
    await user.type(screen.getByLabelText('Descrição do objetivo'), 'Reduzir ansiedade');

    expect(screen.getByTestId('treatment-plan-save-button')).toBeEnabled();
  });

  it('enables the save button after editing a phase title', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitForEditor();

    await user.click(screen.getByTestId('phases-add-button'));
    await user.type(screen.getByLabelText('Título da fase'), 'Estabilização');

    expect(screen.getByTestId('treatment-plan-save-button')).toBeEnabled();
  });

  it('enables the save button after editing the resources field', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitForEditor();

    await user.type(screen.getByLabelText('Recursos terapêuticos'), 'Diário de pensamentos');

    expect(screen.getByTestId('treatment-plan-save-button')).toBeEnabled();
  });

  it('enables the save button after editing the success criteria field', async () => {
    const user = userEvent.setup();
    renderTab();
    await waitForEditor();

    await user.type(screen.getByLabelText('Critérios de sucesso'), 'Redução de 50% no GAD-7');

    expect(screen.getByTestId('treatment-plan-save-button')).toBeEnabled();
  });

  it('persists via upsertTreatmentPlan when clicked with valid content', async () => {
    const user = userEvent.setup();
    const { upsertTreatmentPlan } = renderTab();
    await waitForEditor();

    await user.click(screen.getByTestId('goals-add-button'));
    await user.type(screen.getByLabelText('Descrição do objetivo'), 'Reduzir ansiedade');

    await user.click(screen.getByTestId('treatment-plan-save-button'));

    await waitFor(() => {
      expect(upsertTreatmentPlan).toHaveBeenCalledTimes(1);
    });
    expect(upsertTreatmentPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: PATIENT_ID,
        goals: [expect.objectContaining({ description: 'Reduzir ansiedade' })],
      }),
    );
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('shows a toast and does not persist when a goal description is empty', async () => {
    const user = userEvent.setup();
    const { upsertTreatmentPlan } = renderTab();
    await waitForEditor();

    // Add a goal but leave its description empty, then add a second goal field
    // (which is dirty) so the button enables without satisfying validation.
    await user.click(screen.getByTestId('goals-add-button'));

    const saveButton = screen.getByTestId('treatment-plan-save-button');
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Preencha a descrição de todas as metas antes de salvar.',
      );
    });
    expect(upsertTreatmentPlan).not.toHaveBeenCalled();
  });
});
