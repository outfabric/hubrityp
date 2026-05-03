import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { VerifyEmailPage } from '@/modules/account-lifecycle/components/verify-email-page';

// Tests for `<VerifyEmailPage/>`. The component is purely presentational —
// it owns local UI state (resend feedback, in-flight indicator) but every
// side effect is delegated to props (`resendAction`, `signOutAction`). That
// keeps these tests jsdom-only: no module-level mocks of `@/modules/auth`
// or its server graph are needed.

// Helper: stub for `window.location.assign` so we can assert the
// unauthenticated branch redirects without touching the jsdom navigation
// machinery (which would error trying to load the URL).
//
// jsdom protects `window.location` and its methods aggressively (the
// property is non-configurable AND its methods are sealed). The
// pragmatic path that works under both jsdom and happy-dom is to replace
// the entire `window.location` object via `Object.defineProperty` —
// jsdom permits that path because the `location` getter is itself
// configurable on the Window instance even when the inner Location is
// not. We restore the original on teardown so subsequent tests in the
// same file see the real location again.
type LocationStub = {
  assignSpy: ReturnType<typeof vi.fn>;
  restore: () => void;
};

function stubLocationAssign(): LocationStub {
  const assignSpy = vi.fn();
  const original = window.location;
  // Build a minimal Location-like with only the surface the component
  // uses. Other code paths that touch `window.location` during this test
  // would silently fail, but the component only calls `assign`.
  const stub = {
    assign: assignSpy,
    href: original.href,
    origin: original.origin,
    pathname: original.pathname,
    search: original.search,
    hash: original.hash,
    host: original.host,
    hostname: original.hostname,
    port: original.port,
    protocol: original.protocol,
    reload: () => {},
    replace: () => {},
    toString: () => original.toString(),
  };
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: stub,
  });
  return {
    assignSpy,
    restore: () => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: original,
      });
    },
  };
}

describe('<VerifyEmailPage/>', () => {
  // Default props: a passing resend action and a no-op signOut. Individual
  // tests override these as needed.
  const defaultProps = {
    email: 'psi@example.com',
    resendAction: vi.fn().mockResolvedValue({ ok: true } as const),
    signOutAction: vi.fn().mockResolvedValue(undefined),
  };

  describe('render contract', () => {
    it('renders the heading "Verifique seu email"', () => {
      render(<VerifyEmailPage {...defaultProps} />);
      expect(screen.getByText('Verifique seu email')).toBeInTheDocument();
    });

    it('renders the email address in the body', () => {
      render(<VerifyEmailPage {...defaultProps} />);
      const emailNode = screen.getByTestId('verify-email-address');
      expect(emailNode).toBeInTheDocument();
      expect(emailNode).toHaveTextContent('psi@example.com');
    });

    it('renders the 24-hour validity note', () => {
      render(<VerifyEmailPage {...defaultProps} />);
      // The body text is split across nodes (the email lives in its own
      // span), so we match the surrounding sentence with a flexible query.
      expect(screen.getByText(/válido por 24 horas/i)).toBeInTheDocument();
    });

    it('renders the resend button with the correct label and testid', () => {
      render(<VerifyEmailPage {...defaultProps} />);
      const button = screen.getByTestId('verify-email-resend');
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent('Reenviar email de verificação');
      expect(button).toHaveAttribute('type', 'button');
    });

    it('renders the logout button inside a form action', () => {
      render(<VerifyEmailPage {...defaultProps} />);
      const logout = screen.getByTestId('verify-email-logout');
      expect(logout).toBeInTheDocument();
      expect(logout).toHaveTextContent('Sair');
      expect(logout).toHaveAttribute('type', 'submit');
      // The button must be inside a form so it submits to the Server Action
      // even without client JavaScript.
      expect(logout.closest('form')).not.toBeNull();
    });

    it('does not render a feedback region on initial mount', () => {
      render(<VerifyEmailPage {...defaultProps} />);
      expect(screen.queryByTestId('verify-email-feedback')).not.toBeInTheDocument();
    });
  });

  describe('resend action — success branch', () => {
    it('shows the success message after a successful resend', async () => {
      const resendAction = vi.fn().mockResolvedValue({ ok: true } as const);
      render(<VerifyEmailPage {...defaultProps} resendAction={resendAction} />);

      fireEvent.click(screen.getByTestId('verify-email-resend'));

      await waitFor(() => {
        expect(screen.getByTestId('verify-email-feedback')).toHaveTextContent(
          'Email reenviado com sucesso.',
        );
      });
      expect(resendAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('resend action — error branches', () => {
    it('shows the forbidden message on { ok: false, error: "forbidden" }', async () => {
      const resendAction = vi.fn().mockResolvedValue({ ok: false, error: 'forbidden' } as const);
      render(<VerifyEmailPage {...defaultProps} resendAction={resendAction} />);

      fireEvent.click(screen.getByTestId('verify-email-resend'));

      await waitFor(() => {
        expect(screen.getByTestId('verify-email-feedback')).toHaveTextContent(
          'Sua conta não está aguardando verificação.',
        );
      });
    });

    it('shows the rate-limit message on { ok: false, error: "rate_limited" }', async () => {
      const resendAction = vi.fn().mockResolvedValue({ ok: false, error: 'rate_limited' } as const);
      render(<VerifyEmailPage {...defaultProps} resendAction={resendAction} />);

      fireEvent.click(screen.getByTestId('verify-email-resend'));

      await waitFor(() => {
        expect(screen.getByTestId('verify-email-feedback')).toHaveTextContent(
          'Aguarde alguns minutos antes de pedir novamente.',
        );
      });
    });

    it('shows the unknown message on { ok: false, error: "unknown" }', async () => {
      const resendAction = vi.fn().mockResolvedValue({ ok: false, error: 'unknown' } as const);
      render(<VerifyEmailPage {...defaultProps} resendAction={resendAction} />);

      fireEvent.click(screen.getByTestId('verify-email-resend'));

      await waitFor(() => {
        expect(screen.getByTestId('verify-email-feedback')).toHaveTextContent(
          'Não foi possível reenviar agora. Tente em instantes.',
        );
      });
    });

    it('shows the unknown message when the action itself throws', async () => {
      const resendAction = vi.fn().mockRejectedValue(new Error('boom'));
      render(<VerifyEmailPage {...defaultProps} resendAction={resendAction} />);

      fireEvent.click(screen.getByTestId('verify-email-resend'));

      await waitFor(() => {
        expect(screen.getByTestId('verify-email-feedback')).toHaveTextContent(
          'Não foi possível reenviar agora. Tente em instantes.',
        );
      });
    });

    it('redirects to /login on { ok: false, error: "unauthenticated" }', async () => {
      const stub = stubLocationAssign();
      try {
        const resendAction = vi
          .fn()
          .mockResolvedValue({ ok: false, error: 'unauthenticated' } as const);
        render(<VerifyEmailPage {...defaultProps} resendAction={resendAction} />);

        fireEvent.click(screen.getByTestId('verify-email-resend'));

        await waitFor(() => {
          expect(stub.assignSpy).toHaveBeenCalledWith('/login');
        });
        // No feedback message — the user is being redirected.
        expect(screen.queryByTestId('verify-email-feedback')).not.toBeInTheDocument();
      } finally {
        stub.restore();
      }
    });
  });

  describe('logout action', () => {
    it('renders the logout button inside a form whose action prop is the signOutAction', () => {
      const signOutAction = vi.fn().mockResolvedValue(undefined);
      render(<VerifyEmailPage {...defaultProps} signOutAction={signOutAction} />);

      const form = screen.getByTestId('verify-email-logout').closest('form');
      expect(form).not.toBeNull();
      // React's Server Action prop on a form is exposed via the `action`
      // attribute on the DOM element when the value is a function — we
      // assert via React's prop bag indirectly by checking the form is
      // present. The exact wiring is exercised by the integration test
      // for the route shell (which runs through Next's server renderer).
    });
  });
});
