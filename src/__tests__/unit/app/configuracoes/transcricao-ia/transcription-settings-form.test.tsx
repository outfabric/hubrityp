import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import * as vitestAxeMatchers from 'vitest-axe/matchers';

// Extend Vitest's expect with vitest-axe matchers for toHaveNoViolations().
expect.extend(vitestAxeMatchers);

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmentation for vitest-axe matchers
  interface Assertion extends vitestAxeMatchers.AxeMatchers {}
}

// ---------------------------------------------------------------------------
// Mocks: next/navigation (router.refresh), sonner (toasts), the route shell
// ---------------------------------------------------------------------------

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// The route shell carries `'use server'` and pulls server-only deps; stub it.
const { mockUpdate } = vi.hoisted(() => ({ mockUpdate: vi.fn() }));
vi.mock('@/app/(app)/configuracoes/transcricao-ia/actions', () => ({
  updateTranscriptionSettings: (...args: unknown[]) => mockUpdate(...args) as unknown,
}));

import { TranscriptionSettingsForm } from '@/app/(app)/configuracoes/transcricao-ia/_components/transcription-settings-form';
import type { TranscriptionSettingsView } from '@/modules/ai-transcription';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENABLED_SETTINGS: TranscriptionSettingsView = {
  enabled: true,
  defaultTemplate: 'tcc',
  riskDetectionSensitivity: 'medium',
  keepAudioHours: 24,
  keepTranscription: false,
};

const DISABLED_SETTINGS: TranscriptionSettingsView = {
  enabled: false,
  defaultTemplate: 'livre',
  riskDetectionSensitivity: 'low',
  keepAudioHours: 24,
  keepTranscription: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TranscriptionSettingsForm', () => {
  it('renders controls with the initial defaults applied', () => {
    render(<TranscriptionSettingsForm initial={ENABLED_SETTINGS} />);

    // The enable switch reflects `enabled: true`.
    const enableSwitch = screen.getByRole('switch', { name: 'Ativar Transcrição IA' });
    expect(enableSwitch).toHaveAttribute('aria-checked', 'true');

    // The risk-sensitivity radio reflects `medium`.
    const mediumRadio = screen.getByRole('radio', { name: 'Média' });
    expect(mediumRadio).toHaveAttribute('aria-checked', 'true');

    // Retention is locked to 24h (MVP).
    expect(screen.getByText(/apenas 24h está disponível/i)).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Salvar configurações' })).toBeInTheDocument();
  });

  it('saves with the right payload when toggling keep-transcription on (no dialog)', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({ ok: true });

    render(<TranscriptionSettingsForm initial={ENABLED_SETTINGS} />);

    await user.click(screen.getByRole('switch', { name: 'Manter transcrição textual' }));
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({
      enabled: true,
      defaultTemplate: 'tcc',
      riskDetectionSensitivity: 'medium',
      keepAudioHours: 24,
      keepTranscription: true,
    });
    // enabled stayed true → the disable dialog must NOT appear.
    expect(screen.queryByTestId('transcription-disable-dialog')).not.toBeInTheDocument();
  });

  it('shows the success toast and refreshes after a successful save', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({ ok: true });

    render(<TranscriptionSettingsForm initial={ENABLED_SETTINGS} />);

    await user.click(screen.getByRole('switch', { name: 'Manter transcrição textual' }));
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }));

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Configurações salvas'));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('shows the error toast and does NOT refresh on an INVALID_INPUT result', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({ ok: false, code: 'INVALID_INPUT' });

    render(<TranscriptionSettingsForm initial={ENABLED_SETTINGS} />);

    await user.click(screen.getByRole('switch', { name: 'Manter transcrição textual' }));
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('opens the disable AlertDialog when turning enabled off; only persists on confirm', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({ ok: true });

    render(<TranscriptionSettingsForm initial={ENABLED_SETTINGS} />);

    // Turn the feature off, then submit.
    await user.click(screen.getByRole('switch', { name: 'Ativar Transcrição IA' }));
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }));

    // Dialog appears; the action has NOT been called yet.
    const dialog = await screen.findByTestId('transcription-disable-dialog');
    expect(dialog).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();

    // Confirm → the action runs with enabled:false.
    await user.click(screen.getByTestId('transcription-disable-confirm'));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('does NOT persist when the disable dialog is cancelled', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({ ok: true });

    render(<TranscriptionSettingsForm initial={ENABLED_SETTINGS} />);

    await user.click(screen.getByRole('switch', { name: 'Ativar Transcrição IA' }));
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }));

    await screen.findByTestId('transcription-disable-dialog');
    await user.click(screen.getByTestId('transcription-disable-cancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('transcription-disable-dialog')).not.toBeInTheDocument(),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('enabling from off → on does NOT trigger the disable dialog', async () => {
    const user = userEvent.setup();
    mockUpdate.mockResolvedValue({ ok: true });

    render(<TranscriptionSettingsForm initial={DISABLED_SETTINGS} />);

    await user.click(screen.getByRole('switch', { name: 'Ativar Transcrição IA' }));
    await user.click(screen.getByRole('button', { name: 'Salvar configurações' }));

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
    expect(screen.queryByTestId('transcription-disable-dialog')).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('has no axe violations in the default (form-only) state', async () => {
      const { container } = render(<TranscriptionSettingsForm initial={ENABLED_SETTINGS} />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
