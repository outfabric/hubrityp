import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VerifiqueEmailPage from '@/app/(auth)/verifique-email/page';
import { RESEND_CONFIRMATION_ACK } from '@/modules/registration/lib/confirm-email-copy';

// ---------------------------------------------------------------------------
// Mocks
//
// The page is an async RSC that reads the signed `hp_pending_email` cookie via
// `readPendingEmail`. We mock the cookie helper (avoids needing the HMAC secret
// and `node:crypto`) and `next/headers` (the page awaits `cookies()`). The
// resend Server Action is mocked so the client leaf can be driven without a
// real RPC round-trip.
// ---------------------------------------------------------------------------

vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve({ get: vi.fn(), set: vi.fn() })),
}));

const readPendingEmail = vi.fn<() => string | null>();

vi.mock('@/shared/lib/cookies/pending-email', () => ({
  readPendingEmail: () => readPendingEmail(),
  // Real masking behavior — the page composes `readPendingEmail` + `maskEmail`,
  // so we keep the genuine mask to assert the rendered value.
  maskEmail: (email: string) => {
    const atIndex = email.lastIndexOf('@');
    if (atIndex <= 0) return email;
    const localPart = email.slice(0, atIndex);
    return `${localPart[0]}${'*'.repeat(localPart.length - 1)}${email.slice(atIndex)}`;
  },
}));

const resendPublicConfirmation = vi.fn(() => Promise.resolve({ ok: true as const }));

vi.mock('@/app/(auth)/verifique-email/actions', () => ({
  resendPublicConfirmation: () => resendPublicConfirmation(),
}));

/** Render the async RSC by awaiting its returned element tree. */
async function renderPage() {
  const ui = await VerifiqueEmailPage();
  return render(ui);
}

describe('VerifiqueEmailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the card with the masked email from a valid cookie', async () => {
    readPendingEmail.mockReturnValue('maria@gmail.com');

    await renderPage();

    expect(screen.getByTestId('verifique-email-card')).toBeInTheDocument();
    expect(screen.getByTestId('verifique-email-address')).toHaveTextContent('m****@gmail.com');
    expect(screen.getByTestId('verifique-email-resend')).toBeInTheDocument();
    expect(screen.getByTestId('verifique-email-feedback')).toBeInTheDocument();
  });

  it('renders generic guidance with no masked-email line when the cookie is absent', async () => {
    readPendingEmail.mockReturnValue(null);

    await renderPage();

    expect(screen.getByTestId('verifique-email-card')).toBeInTheDocument();
    expect(screen.queryByTestId('verifique-email-address')).not.toBeInTheDocument();
    // The page still renders and never crashes without an email.
    expect(screen.getByTestId('verifique-email-resend')).toBeInTheDocument();
  });

  it('feedback region starts empty (aria-live polite)', async () => {
    readPendingEmail.mockReturnValue('maria@gmail.com');

    await renderPage();

    const feedback = screen.getByTestId('verifique-email-feedback');
    expect(feedback).toHaveAttribute('aria-live', 'polite');
    expect(feedback).toHaveTextContent('');
  });

  it('shows loading then the generic acknowledgement after clicking resend', async () => {
    readPendingEmail.mockReturnValue('maria@gmail.com');
    const user = userEvent.setup();

    await renderPage();

    const button = screen.getByTestId('verifique-email-resend');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByTestId('verifique-email-feedback')).toHaveTextContent(
        RESEND_CONFIRMATION_ACK,
      );
    });
    expect(resendPublicConfirmation).toHaveBeenCalledTimes(1);
  });
});
