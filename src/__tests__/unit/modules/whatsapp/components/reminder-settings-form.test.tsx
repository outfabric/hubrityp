import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReminderSettingsForm } from '@/modules/whatsapp/components/reminder-settings-form';
import type { ReminderSettingsData } from '@/modules/whatsapp/server/reminders/get-reminder-settings';

// The form imports the Server Action from the route shell; stub it so the RTL
// render never touches the network and we can assert whether a submit reached it.
// `vi.hoisted` so the mock fn exists before the hoisted `vi.mock` factory runs.
const { saveReminderSettingsMock } = vi.hoisted(() => ({ saveReminderSettingsMock: vi.fn() }));
vi.mock('@/app/(app)/configuracoes/lembretes/actions', () => ({
  saveReminderSettings: saveReminderSettingsMock,
}));

// Sonner toasts have no jsdom-renderable surface we assert on; stub them.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: ReminderSettingsData = {
  earlyReminderHours: 24,
  finalReminderHours: 2,
  videoLinkMinutes: 30,
  sendDuringNight: false,
};

function renderForm(hasWhatsappAccount: boolean) {
  render(
    <ReminderSettingsForm settings={DEFAULT_SETTINGS} hasWhatsappAccount={hasWhatsappAccount} />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReminderSettingsForm — LGPD consent gate', () => {
  beforeEach(() => {
    saveReminderSettingsMock.mockReset();
    saveReminderSettingsMock.mockResolvedValue({ ok: true });
  });

  it('renders the consent checkbox in the "no account" state', () => {
    renderForm(false);

    const checkbox = screen.getByTestId('reminder-consent-checkbox');
    expect(checkbox).toBeInTheDocument();
    // Copy must cover both lawful bases: platform WhatsApp use + patient consent.
    expect(screen.getByText(/número de WhatsApp da plataforma/i)).toBeInTheDocument();
    expect(screen.getByText(/responsável por obter o consentimento/i)).toBeInTheDocument();
  });

  it('blocks submit when consent is not given (no account yet)', async () => {
    const user = userEvent.setup();
    renderForm(false);

    await user.click(screen.getByTestId('reminder-settings-save'));

    // The consent literal fails validation → the Server Action must never fire.
    const error = await screen.findByTestId('reminder-consent-error');
    expect(error).toHaveTextContent(
      'Você precisa aceitar o termo de consentimento para ativar os lembretes no WhatsApp.',
    );
    expect(saveReminderSettingsMock).not.toHaveBeenCalled();
  });

  it('submits once consent is checked (no account yet)', async () => {
    const user = userEvent.setup();
    renderForm(false);

    await user.click(screen.getByTestId('reminder-consent-checkbox'));
    await user.click(screen.getByTestId('reminder-settings-save'));

    await waitFor(() => {
      expect(saveReminderSettingsMock).toHaveBeenCalledTimes(1);
    });
    expect(saveReminderSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ consent: true }),
    );
  });

  it('hides the consent checkbox when the account already exists and submits directly', async () => {
    const user = userEvent.setup();
    renderForm(true);

    expect(screen.queryByTestId('reminder-consent-checkbox')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reminder-consent-section')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('reminder-settings-save'));

    await waitFor(() => {
      expect(saveReminderSettingsMock).toHaveBeenCalledTimes(1);
    });
  });
});
