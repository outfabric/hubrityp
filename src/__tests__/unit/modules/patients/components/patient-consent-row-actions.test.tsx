import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GenerateConsentResult } from '@/modules/patients';
import { PatientConsentRowActions } from '@/modules/patients/components/patient-consent-row-actions';

// Mock the toast system so we can assert success/error feedback without
// rendering the Sonner toaster.
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => {
      toastSuccess(...args);
    },
    error: (...args: unknown[]) => {
      toastError(...args);
    },
  },
}));

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';
const TOKEN = 'a'.repeat(64);

function makeGenerateAction(
  result: GenerateConsentResult = { ok: true, consentId: 'consent-1', token: TOKEN },
) {
  return vi.fn<(patientId: string) => Promise<GenerateConsentResult>>().mockResolvedValue(result);
}

function setOrigin(origin: string) {
  // jsdom defaults to http://localhost; pin a deterministic origin.
  Object.defineProperty(window, 'location', {
    value: { ...window.location, origin },
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

beforeEach(() => {
  setOrigin('https://app.hubrity.com.br');
});

describe('PatientConsentRowActions', () => {
  describe('copy link', () => {
    it('resolves the token and writes the /termo/{token} URL to the clipboard, then toasts', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      });
      const generateConsentAction = makeGenerateAction();

      render(
        <PatientConsentRowActions
          patientId={PATIENT_ID}
          sharePhone="+55 11 99999-0000"
          generateConsentAction={generateConsentAction}
        />,
      );

      await user.click(screen.getByTestId('patient-consent-copy-link'));

      await waitFor(() => {
        expect(generateConsentAction).toHaveBeenCalledWith(PATIENT_ID);
        expect(writeText).toHaveBeenCalledWith(`https://app.hubrity.com.br/termo/${TOKEN}`);
      });
      expect(toastSuccess).toHaveBeenCalledWith('Link copiado', expect.objectContaining({}));
    });

    it('reuses the cached token on a second copy instead of generating again', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      });
      const generateConsentAction = makeGenerateAction();

      render(
        <PatientConsentRowActions
          patientId={PATIENT_ID}
          sharePhone="+55 11 99999-0000"
          generateConsentAction={generateConsentAction}
        />,
      );

      await user.click(screen.getByTestId('patient-consent-copy-link'));
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      await user.click(screen.getByTestId('patient-consent-copy-link'));
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

      // Token resolved once; second click reuses the cached value.
      expect(generateConsentAction).toHaveBeenCalledTimes(1);
    });

    it('surfaces a sanitized error toast when the action fails', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      });
      const generateConsentAction = makeGenerateAction({ ok: false, error: 'patient_not_found' });

      render(
        <PatientConsentRowActions
          patientId={PATIENT_ID}
          sharePhone={null}
          generateConsentAction={generateConsentAction}
        />,
      );

      await user.click(screen.getByTestId('patient-consent-copy-link'));

      await waitFor(() => {
        expect(toastError).toHaveBeenCalledWith('Erro ao gerar o termo de consentimento');
      });
      expect(writeText).not.toHaveBeenCalled();
    });
  });

  describe('WhatsApp button', () => {
    it('is disabled and tooltip-wrapped when sharePhone is null', async () => {
      const user = userEvent.setup();
      const generateConsentAction = makeGenerateAction();

      render(
        <PatientConsentRowActions
          patientId={PATIENT_ID}
          sharePhone={null}
          generateConsentAction={generateConsentAction}
        />,
      );

      expect(screen.getByTestId('patient-consent-whatsapp')).toBeDisabled();

      // Tooltip copy is exposed on focus (RF-12.14c).
      await user.hover(screen.getByTestId('patient-consent-whatsapp-tooltip-trigger'));
      await waitFor(() => {
        expect(
          screen.getAllByText('Cadastre um telefone para enviar pelo WhatsApp').length,
        ).toBeGreaterThan(0);
      });
    });

    it('is enabled when sharePhone is present and opens the WhatsApp link with the token URL', async () => {
      const user = userEvent.setup();
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        writable: true,
        configurable: true,
      });
      const openSpy = vi.fn();
      vi.stubGlobal('open', openSpy);
      const generateConsentAction = makeGenerateAction();

      render(
        <PatientConsentRowActions
          patientId={PATIENT_ID}
          sharePhone="+55 11 99999-0000"
          generateConsentAction={generateConsentAction}
        />,
      );

      const whatsappBtn = screen.getByTestId('patient-consent-whatsapp');
      expect(whatsappBtn).not.toBeDisabled();

      await user.click(whatsappBtn);

      await waitFor(() => {
        expect(generateConsentAction).toHaveBeenCalledWith(PATIENT_ID);
        expect(openSpy).toHaveBeenCalledTimes(1);
      });
      const href = openSpy.mock.calls[0]![0] as string;
      expect(href).toContain('https://wa.me/5511999990000');
      expect(href).toContain(encodeURIComponent(`https://app.hubrity.com.br/termo/${TOKEN}`));
    });
  });
});
