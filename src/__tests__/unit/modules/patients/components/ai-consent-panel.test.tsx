import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiConsentPanel } from '@/modules/patients/components/ai-consent-panel';
import type {
  AiConsentStatusView,
  GenerateAiConsentResult,
  GetAiConsentStatusResult,
  RevokeAiConsentResult,
} from '@/modules/patients/lib/ai-consent-schemas';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PATIENT_ID = '11111111-1111-1111-1111-111111111111';

const STATUS_NONE: AiConsentStatusView = { state: 'none' };

const STATUS_PENDING: AiConsentStatusView = {
  state: 'pending',
  publicUrl: '/termo/abc123token',
  expiresAt: new Date('2026-06-15T00:00:00Z'),
  createdAt: new Date('2026-06-08T00:00:00Z'),
};

const STATUS_ACTIVE: AiConsentStatusView = {
  state: 'active',
  signedAt: new Date('2026-06-10T14:30:00Z'),
  templateVersion: 1,
};

const STATUS_REVOKED: AiConsentStatusView = {
  state: 'revoked',
  revokedAt: new Date('2026-06-12T09:00:00Z'),
  reason: null,
};

// ---------------------------------------------------------------------------
// Mock action factories
// ---------------------------------------------------------------------------

function makeGetStatusAction(consent: AiConsentStatusView) {
  return vi
    .fn<(patientId: string) => Promise<GetAiConsentStatusResult>>()
    .mockResolvedValue({ ok: true, consent });
}

function makeGenerateAction(
  result: GenerateAiConsentResult = {
    ok: true,
    publicUrl: '/termo/newtoken123',
    expiresAt: new Date('2026-06-22T00:00:00Z'),
  },
) {
  return vi.fn<(patientId: string) => Promise<GenerateAiConsentResult>>().mockResolvedValue(result);
}

function makeRevokeAction(result: RevokeAiConsentResult = { ok: true }) {
  return vi
    .fn<(patientId: string, reason: string | null) => Promise<RevokeAiConsentResult>>()
    .mockResolvedValue(result);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

interface RenderOptions {
  consent?: AiConsentStatusView;
  generateResult?: GenerateAiConsentResult;
  revokeResult?: RevokeAiConsentResult;
  getStatusOverride?: (patientId: string) => Promise<GetAiConsentStatusResult>;
}

function renderPanel(opts: RenderOptions = {}) {
  const { consent = STATUS_NONE, generateResult, revokeResult, getStatusOverride } = opts;

  const getStatusAction = getStatusOverride ?? makeGetStatusAction(consent);
  const generateAction = makeGenerateAction(generateResult);
  const revokeAction = makeRevokeAction(revokeResult);

  const result = render(
    <AiConsentPanel
      patientId={PATIENT_ID}
      getStatusAction={getStatusAction}
      generateAction={generateAction}
      revokeAction={revokeAction}
    />,
  );

  return { ...result, getStatusAction, generateAction, revokeAction };
}

// ---------------------------------------------------------------------------
// Tests: State rendering (7.1 + 7.2)
// ---------------------------------------------------------------------------

describe('AiConsentPanel', () => {
  describe('state: none', () => {
    it('renders the card with heading, description, and generate button', async () => {
      renderPanel({ consent: STATUS_NONE });

      // Wait for the generate button — it only appears after the query resolves
      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-generate-btn')).toBeInTheDocument();
      });

      // Heading with Sparkles icon
      expect(screen.getByText('Transcrição IA')).toBeInTheDocument();

      // Description text (use a function matcher to handle split text nodes)
      expect(screen.getByTestId('ai-consent-generate-btn')).toHaveTextContent(
        'Gerar termo de consentimento',
      );

      // No badge in none state
      expect(screen.queryByTestId('ai-consent-badge')).not.toBeInTheDocument();
    });
  });

  describe('state: pending', () => {
    it('renders pending state with expiry date, link input, copy and resend buttons', async () => {
      renderPanel({ consent: STATUS_PENDING });

      // Wait for pending-specific content
      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-copy-btn')).toBeInTheDocument();
      });

      // Expiry text (DD/MM/YYYY format)
      expect(screen.getByText(/expira em 15\/06\/2026/)).toBeInTheDocument();

      // Read-only input with URL
      const linkInput = screen.getByTestId('ai-consent-link-input');
      expect(linkInput).toBeInTheDocument();
      expect(linkInput).toHaveAttribute('readonly');

      // Copy button
      const copyBtn = screen.getByTestId('ai-consent-copy-btn');
      expect(copyBtn).toHaveTextContent('Copiar link');

      // Resend button
      const resendBtn = screen.getByTestId('ai-consent-resend-btn');
      expect(resendBtn).toHaveTextContent('Reenviar');
    });
  });

  describe('state: active', () => {
    it('renders active state with Vigente badge, signed date, and revoke button', async () => {
      renderPanel({ consent: STATUS_ACTIVE });

      // Wait for the revoke button — it only appears after the query resolves
      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-revoke-btn')).toBeInTheDocument();
      });

      // Badge
      const badge = screen.getByTestId('ai-consent-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('Vigente');

      // Signed date
      expect(screen.getByText(/Assinado em 10\/06\/2026/)).toBeInTheDocument();

      // Revoke button
      const revokeBtn = screen.getByTestId('ai-consent-revoke-btn');
      expect(revokeBtn).toHaveTextContent('Revogar termo');
    });
  });

  describe('state: revoked', () => {
    it('renders revoked state with warning badge, revoked date, and generate new button', async () => {
      renderPanel({ consent: STATUS_REVOKED });

      // Wait for the generate button — it only appears after the query resolves
      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-generate-btn')).toBeInTheDocument();
      });

      // Badge
      const badge = screen.getByTestId('ai-consent-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent(/Revogado em 12\/06\/2026/);

      // Revoked date in content
      expect(screen.getByText(/Termo revogado em 12\/06\/2026/)).toBeInTheDocument();

      // Generate new button
      const generateBtn = screen.getByTestId('ai-consent-generate-btn');
      expect(generateBtn).toHaveTextContent('Gerar novo termo');
    });
  });

  // -----------------------------------------------------------------------
  // Revoke confirmation dialog (7.1 + 7.4)
  // -----------------------------------------------------------------------

  describe('revoke confirmation dialog', () => {
    it('opens the revoke dialog when revoke button is clicked', async () => {
      const user = userEvent.setup();
      renderPanel({ consent: STATUS_ACTIVE });

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-revoke-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('ai-consent-revoke-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-revoke-dialog')).toBeInTheDocument();
      });

      expect(screen.getByText(/Revogar termo de consentimento\?/)).toBeInTheDocument();
      expect(screen.getByTestId('ai-consent-revoke-input')).toBeInTheDocument();
    });

    it('keeps confirm button disabled until REVOGAR is typed', async () => {
      const user = userEvent.setup();
      renderPanel({ consent: STATUS_ACTIVE });

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-revoke-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('ai-consent-revoke-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-revoke-dialog')).toBeInTheDocument();
      });

      const confirmBtn = screen.getByTestId('ai-consent-revoke-confirm');
      expect(confirmBtn).toBeDisabled();

      // Type partial word
      const input = screen.getByTestId('ai-consent-revoke-input');
      await user.type(input, 'REVOG');
      expect(confirmBtn).toBeDisabled();

      // Type remaining characters
      await user.type(input, 'AR');
      expect(confirmBtn).toBeEnabled();
    });

    it('calls revoke action when REVOGAR is typed and confirm is clicked', async () => {
      const user = userEvent.setup();
      let callCount = 0;
      const getStatusOverride = vi
        .fn<(patientId: string) => Promise<GetAiConsentStatusResult>>()
        .mockImplementation(() => {
          callCount++;
          if (callCount <= 1) {
            return Promise.resolve({ ok: true, consent: STATUS_ACTIVE });
          }
          return Promise.resolve({ ok: true, consent: STATUS_REVOKED });
        });

      const { revokeAction } = renderPanel({
        consent: STATUS_ACTIVE,
        getStatusOverride,
      });

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-revoke-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('ai-consent-revoke-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-revoke-dialog')).toBeInTheDocument();
      });

      const input = screen.getByTestId('ai-consent-revoke-input');
      await user.type(input, 'revogar'); // lowercase — component uppercases
      await user.click(screen.getByTestId('ai-consent-revoke-confirm'));

      await waitFor(() => {
        expect(revokeAction).toHaveBeenCalled();
      });
    });
  });

  // -----------------------------------------------------------------------
  // Mutations (7.1 + 7.4)
  // -----------------------------------------------------------------------

  describe('generate mutation', () => {
    it('calls generate action when button is clicked', async () => {
      const user = userEvent.setup();

      let callCount = 0;
      const getStatusOverride = vi
        .fn<(patientId: string) => Promise<GetAiConsentStatusResult>>()
        .mockImplementation(() => {
          callCount++;
          if (callCount <= 1) {
            return Promise.resolve({ ok: true, consent: STATUS_NONE });
          }
          return Promise.resolve({ ok: true, consent: STATUS_PENDING });
        });

      const { generateAction } = renderPanel({
        consent: STATUS_NONE,
        getStatusOverride,
      });

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-generate-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('ai-consent-generate-btn'));

      await waitFor(() => {
        expect(generateAction).toHaveBeenCalled();
      });
    });

    it('handles generate failure gracefully', async () => {
      const user = userEvent.setup();
      const getStatusOverride = makeGetStatusAction(STATUS_NONE);

      const { generateAction } = renderPanel({
        consent: STATUS_NONE,
        generateResult: { ok: false, error: 'INTERNAL_ERROR' },
        getStatusOverride,
      });

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-generate-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('ai-consent-generate-btn'));

      await waitFor(() => {
        expect(generateAction).toHaveBeenCalled();
      });

      // Panel remains in the same state (button still visible)
      expect(screen.getByTestId('ai-consent-generate-btn')).toBeInTheDocument();
    });
  });

  describe('copy link', () => {
    it('copies the public URL to clipboard when copy button is clicked', async () => {
      const user = userEvent.setup();

      // Mock clipboard — navigator.clipboard is a getter in jsdom
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });

      renderPanel({ consent: STATUS_PENDING });

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-copy-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('ai-consent-copy-btn'));

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('/termo/abc123token'));
      });
    });
  });

  // -----------------------------------------------------------------------
  // TanStack Query revalidation (7.4)
  // -----------------------------------------------------------------------

  describe('query revalidation', () => {
    it('fetches AI consent status on mount', async () => {
      const getStatusOverride = makeGetStatusAction(STATUS_NONE);

      renderPanel({ getStatusOverride });

      await waitFor(() => {
        expect(getStatusOverride).toHaveBeenCalledWith(PATIENT_ID);
      });
    });

    it('refetches after generate mutation settles', async () => {
      const user = userEvent.setup();

      let callCount = 0;
      const getStatusOverride = vi
        .fn<(patientId: string) => Promise<GetAiConsentStatusResult>>()
        .mockImplementation(() => {
          callCount++;
          if (callCount <= 1) {
            return Promise.resolve({ ok: true, consent: STATUS_NONE });
          }
          return Promise.resolve({ ok: true, consent: STATUS_PENDING });
        });

      const { generateAction } = renderPanel({
        consent: STATUS_NONE,
        getStatusOverride,
      });

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-generate-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('ai-consent-generate-btn'));

      await waitFor(() => {
        expect(generateAction).toHaveBeenCalled();
      });

      // After mutation settles, query should be invalidated and refetched
      await waitFor(
        () => {
          expect(getStatusOverride).toHaveBeenCalledTimes(2);
        },
        { timeout: 5000 },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Loading and error states
  // -----------------------------------------------------------------------

  describe('loading and error states', () => {
    it('shows loading state while fetching', () => {
      const getStatusOverride = vi
        .fn<(patientId: string) => Promise<GetAiConsentStatusResult>>()
        .mockReturnValue(new Promise(() => {}));

      renderPanel({ getStatusOverride });

      expect(screen.getByText('Carregando...')).toBeInTheDocument();
    });

    it('shows error state when fetch fails', async () => {
      const getStatusOverride = vi
        .fn<(patientId: string) => Promise<GetAiConsentStatusResult>>()
        .mockRejectedValue(new Error('Network error'));

      renderPanel({ getStatusOverride });

      // TanStack Query retries once (retry: 1) with back-off, so allow extra time
      await waitFor(
        () => {
          expect(
            screen.getByText('Erro ao carregar o status do consentimento.'),
          ).toBeInTheDocument();
        },
        { timeout: 5000 },
      );
    });
  });

  // -----------------------------------------------------------------------
  // Accessibility (7.5)
  // -----------------------------------------------------------------------

  describe('accessibility', () => {
    it('has aria-label on buttons with icons in pending state', async () => {
      renderPanel({ consent: STATUS_PENDING });

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-copy-btn')).toBeInTheDocument();
      });

      const copyBtn = screen.getByTestId('ai-consent-copy-btn');
      expect(copyBtn).toHaveAttribute('aria-label');

      const resendBtn = screen.getByTestId('ai-consent-resend-btn');
      expect(resendBtn).toHaveAttribute('aria-label');
    });

    it('has aria-label on the link input', async () => {
      renderPanel({ consent: STATUS_PENDING });

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-link-input')).toBeInTheDocument();
      });

      const linkInput = screen.getByTestId('ai-consent-link-input');
      expect(linkInput).toHaveAttribute('aria-label');
    });

    it('marks decorative icons with aria-hidden', async () => {
      renderPanel({ consent: STATUS_NONE });

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-generate-btn')).toBeInTheDocument();
      });

      // All SVG icons in the panel should be aria-hidden
      const panel = screen.getByTestId('ai-consent-panel');
      const svgs = panel.querySelectorAll('svg');
      for (const svg of svgs) {
        expect(svg).toHaveAttribute('aria-hidden', 'true');
      }
    });

    it('has aria-label on the revoke confirmation input', async () => {
      const user = userEvent.setup();
      renderPanel({ consent: STATUS_ACTIVE });

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-revoke-btn')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('ai-consent-revoke-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('ai-consent-revoke-input')).toBeInTheDocument();
      });

      expect(screen.getByTestId('ai-consent-revoke-input')).toHaveAttribute('aria-label');
    });

    describe('keyboard navigation', () => {
      it('allows Tab to traverse the panel in none state', async () => {
        const user = userEvent.setup();
        renderPanel({ consent: STATUS_NONE });

        await waitFor(() => {
          expect(screen.getByTestId('ai-consent-generate-btn')).toBeInTheDocument();
        });

        // Tab should reach the generate button
        await user.tab();
        expect(screen.getByTestId('ai-consent-generate-btn')).toHaveFocus();
      });

      it('allows Tab to traverse buttons in pending state', async () => {
        const user = userEvent.setup();
        renderPanel({ consent: STATUS_PENDING });

        await waitFor(() => {
          expect(screen.getByTestId('ai-consent-copy-btn')).toBeInTheDocument();
        });

        // Tab through: link input -> copy button -> resend button
        await user.tab();
        expect(screen.getByTestId('ai-consent-link-input')).toHaveFocus();

        await user.tab();
        expect(screen.getByTestId('ai-consent-copy-btn')).toHaveFocus();

        await user.tab();
        expect(screen.getByTestId('ai-consent-resend-btn')).toHaveFocus();
      });

      it('allows Enter to trigger the primary button in none state', async () => {
        const user = userEvent.setup();
        const getStatusOverride = makeGetStatusAction(STATUS_NONE);
        const { generateAction } = renderPanel({
          consent: STATUS_NONE,
          getStatusOverride,
        });

        await waitFor(() => {
          expect(screen.getByTestId('ai-consent-generate-btn')).toBeInTheDocument();
        });

        await user.tab();
        await user.keyboard('{Enter}');

        await waitFor(() => {
          expect(generateAction).toHaveBeenCalled();
        });
      });

      it('allows Escape to close the revoke AlertDialog', async () => {
        const user = userEvent.setup();
        renderPanel({ consent: STATUS_ACTIVE });

        await waitFor(() => {
          expect(screen.getByTestId('ai-consent-revoke-btn')).toBeInTheDocument();
        });

        await user.click(screen.getByTestId('ai-consent-revoke-btn'));

        await waitFor(() => {
          expect(screen.getByTestId('ai-consent-revoke-dialog')).toBeInTheDocument();
        });

        await user.keyboard('{Escape}');

        await waitFor(() => {
          expect(screen.queryByTestId('ai-consent-revoke-dialog')).not.toBeInTheDocument();
        });
      });
    });
  });
});
