import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Radix UI Checkbox uses ResizeObserver internally (via `@radix-ui/react-use-size`).
// jsdom does not provide ResizeObserver, so we stub it globally before tests run.
beforeAll(() => {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// We mock `@/app/(auth)/login/actions` so importing `LoginForm` (which
// imports `signIn` from the route shell) does not pull in the server-only
// auth path under jsdom. The shell file declares `'use server'` and
// re-exports `signInImpl` from `@/modules/auth`, which transitively imports
// `@/shared/supabase/server` (carries `import 'server-only'` + `next/headers`)
// — both throw at module evaluation time outside a server runtime. We
// therefore CANNOT use `importOriginal` here (it would still evaluate the
// real chain and trip server-only).
//
// The LoginForm only uses `signIn` from the shell at runtime; `SignInResult`
// is type-only (erased). It imports `loginInputSchema` directly from
// `@/modules/auth/lib/login-input-schema`, which is jsdom-safe and does NOT
// need to be re-supplied by this mock. Tests are render assertions plus
// state-conditional rendering — the action is never actually called.
vi.mock('@/app/(auth)/login/actions', () => ({
  signIn: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock `@/modules/oauth` — GoogleButton imports `@/shared/supabase/client`
// which instantiates a browser Supabase client. Under jsdom this would
// require a full Supabase setup. A lightweight stub is sufficient since
// these tests assert login-form behavior, not OAuth flows.
vi.mock('@/modules/oauth', () => ({
  GoogleButton: () => <button data-testid="login-form-google-button">Entrar com Google</button>,
}));

// Mock `next/link` — in jsdom there is no Next.js router context, so
// the real Link component may fail. We render a plain `<a>` tag instead.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { LoginForm } from '@/modules/auth/components/login-form';

describe('LoginForm', () => {
  it('renders email input with the expected testid, type and autoComplete', () => {
    render(<LoginForm />);
    const email = screen.getByTestId('login-form-email');
    expect(email).toBeInTheDocument();
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autoComplete', 'email');
    expect(email).toBeRequired();
  });

  it('renders password input with the expected testid, type and autoComplete', () => {
    render(<LoginForm />);
    const password = screen.getByTestId('login-form-password');
    expect(password).toBeInTheDocument();
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autoComplete', 'current-password');
    expect(password).toBeRequired();
  });

  it('renders submit button with the expected testid', () => {
    render(<LoginForm />);
    const submit = screen.getByTestId('login-form-submit');
    expect(submit).toBeInTheDocument();
    expect(submit).toHaveAttribute('type', 'submit');
  });

  it('does not render an error region when there is no error state', () => {
    render(<LoginForm />);
    expect(screen.queryByTestId('login-form-error')).not.toBeInTheDocument();
  });

  it('renders the invalid_credentials message when initialState carries that error', () => {
    render(<LoginForm initialState={{ ok: false, error: 'invalid_credentials' }} />);
    const error = screen.getByTestId('login-form-error');
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent('E-mail ou senha incorretos.');
  });

  it('renders the unknown error message when initialState carries `unknown`', () => {
    render(<LoginForm initialState={{ ok: false, error: 'unknown' }} />);
    const error = screen.getByTestId('login-form-error');
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent('Algo deu errado. Tente novamente.');
  });

  it('renders the account_unavailable message when initialState carries that error', () => {
    // `account_unavailable` is the post-status-aware-signIn variant: auth
    // succeeded but the profile is suspended or cancelled. The form MUST
    // surface a generic support-contact message — never leak whether the
    // account is suspended vs. cancelled, since both states route the user
    // to the same support flow.
    render(<LoginForm initialState={{ ok: false, error: 'account_unavailable' }} />);
    const error = screen.getByTestId('login-form-error');
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent(
      'Esta conta não está disponível. Entre em contato com o suporte.',
    );
  });

  it('does not render an error region when initialState is { ok: true }', () => {
    render(<LoginForm initialState={{ ok: true }} />);
    expect(screen.queryByTestId('login-form-error')).not.toBeInTheDocument();
  });

  it('forwards `redirectTo` via a hidden input when the prop is provided', () => {
    const { container } = render(<LoginForm redirectTo="/dashboard/settings" />);
    const hidden = container.querySelector('input[type="hidden"][name="redirectTo"]');
    expect(hidden).toBeInTheDocument();
    expect(hidden).toHaveAttribute('value', '/dashboard/settings');
  });

  it('does not render the redirectTo hidden input when the prop is omitted', () => {
    const { container } = render(<LoginForm />);
    const hidden = container.querySelector('input[name="redirectTo"]');
    expect(hidden).not.toBeInTheDocument();
  });

  it('associates the email Label with the input via htmlFor/id', () => {
    render(<LoginForm />);
    const label = screen.getByText('E-mail');
    expect(label).toHaveAttribute('for', 'login-email');
    const email = screen.getByTestId('login-form-email');
    expect(email).toHaveAttribute('id', 'login-email');
  });

  it('associates the password Label with the input via htmlFor/id', () => {
    render(<LoginForm />);
    const label = screen.getByText('Senha');
    expect(label).toHaveAttribute('for', 'login-password');
    const password = screen.getByTestId('login-form-password');
    expect(password).toHaveAttribute('id', 'login-password');
  });

  it('hides the server-side error region once a client-side field error appears', async () => {
    // Render with a stale server error from a previous failed submit.
    render(<LoginForm initialState={{ ok: false, error: 'invalid_credentials' }} />);

    expect(screen.getByTestId('login-form-error')).toBeInTheDocument();

    // RHF is configured with `mode: 'onBlur'`. Typing an invalid email and
    // blurring the field surfaces the inline pt-BR validation message; at
    // that point the server-error region must hide so the user does not see
    // two competing messages stacked.
    const email = screen.getByTestId('login-form-email');
    fireEvent.change(email, { target: { value: 'not-an-email' } });
    fireEvent.blur(email);

    await waitFor(() => {
      expect(screen.getByText('E-mail inválido.')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('login-form-error')).not.toBeInTheDocument();
  });

  it('keeps the server-side error visible while no client-side field errors are present', () => {
    render(<LoginForm initialState={{ ok: false, error: 'invalid_credentials' }} />);

    // No interaction → no client-side errors → server error stays.
    expect(screen.getByTestId('login-form-error')).toBeInTheDocument();
    expect(screen.queryByText('E-mail inválido.')).not.toBeInTheDocument();
    expect(screen.queryByText('A senha deve ter pelo menos 8 caracteres.')).not.toBeInTheDocument();
  });

  // ---- 9.1: Checkbox "Manter conectado" ----

  it('renders the keep-logged-in checkbox with the expected testid', () => {
    render(<LoginForm />);
    const checkbox = screen.getByTestId('login-form-keep-logged-in');
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).toHaveAttribute('role', 'checkbox');
  });

  it('renders the keep-logged-in checkbox unchecked by default', () => {
    render(<LoginForm />);
    const checkbox = screen.getByTestId('login-form-keep-logged-in');
    expect(checkbox).toHaveAttribute('data-state', 'unchecked');
  });

  it('submits keepLoggedIn=false via a hidden input by default', () => {
    const { container } = render(<LoginForm />);
    const hidden = container.querySelector('input[type="hidden"][name="keepLoggedIn"]');
    expect(hidden).toBeInTheDocument();
    expect(hidden).toHaveAttribute('value', 'false');
  });

  it('toggles the keep-logged-in checkbox and updates hidden input on click', async () => {
    const { container } = render(<LoginForm />);
    const checkbox = screen.getByTestId('login-form-keep-logged-in');
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(checkbox).toHaveAttribute('data-state', 'checked');
    });

    const hidden = container.querySelector('input[type="hidden"][name="keepLoggedIn"]');
    expect(hidden).toHaveAttribute('value', 'true');
  });

  // ---- 9.2: GoogleButton ----

  it('renders the GoogleButton above the credential fields (Google-first)', () => {
    render(<LoginForm />);
    const googleBtn = screen.getByTestId('login-form-google-button');
    const email = screen.getByTestId('login-form-email');
    expect(googleBtn).toBeInTheDocument();

    // Google-first layout: the OAuth button must precede the email/password
    // block in document order. `Node.compareDocumentPosition` returns the
    // `DOCUMENT_POSITION_FOLLOWING` bit when `email` comes after `googleBtn`.
    expect(googleBtn.compareDocumentPosition(email)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  // ---- 9.3: Error copies with links ----

  it('renders locked_out error with remaining time and link to /forgot-password', () => {
    // Lockout expires 10 minutes from now
    const lockoutUntil = new Date(Date.now() + 10 * 60_000).toISOString();
    render(<LoginForm initialState={{ ok: false, error: 'locked_out', lockoutUntil }} />);

    const error = screen.getByTestId('login-form-error');
    expect(error).toBeInTheDocument();
    expect(error).toHaveTextContent(/Conta temporariamente bloqueada/);
    expect(error).toHaveTextContent(/10 min/);

    const link = error.querySelector('a');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/forgot-password');
    expect(link).toHaveTextContent('redefina sua senha');
  });

  it('renders locked_out error with fallback text when lockoutUntil is missing', () => {
    render(<LoginForm initialState={{ ok: false, error: 'locked_out' }} />);

    const error = screen.getByTestId('login-form-error');
    expect(error).toHaveTextContent(/alguns instantes/);
    expect(error).toHaveTextContent(/redefina sua senha/);
  });

  it('renders requires_password_reset error with link prefilled with email', async () => {
    render(<LoginForm initialState={{ ok: false, error: 'requires_password_reset' }} />);

    // Type an email first so the link uses it
    const emailInput = screen.getByTestId('login-form-email');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    await waitFor(() => {
      const error = screen.getByTestId('login-form-error');
      const link = error.querySelector('a');
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute(
        'href',
        `/forgot-password?email=${encodeURIComponent('test@example.com')}`,
      );
      expect(link).toHaveTextContent('redefina sua senha');
    });
  });

  // ---- 8.1: Confirm-email state (email_not_confirmed) ----

  it('renders the confirm-email region (non-danger) with a link to /verifique-email for email_not_confirmed', () => {
    render(<LoginForm initialState={{ ok: false, error: 'email_not_confirmed' }} />);

    const region = screen.getByTestId('login-confirm-email');
    expect(region).toBeInTheDocument();

    // Informational, not a danger error: it must NOT carry the destructive
    // styling reserved for `login-form-error`, and the generic error region
    // must not appear.
    expect(region).not.toHaveClass('text-destructive');
    expect(screen.queryByTestId('login-form-error')).not.toBeInTheDocument();

    const link = region.querySelector('a');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/verifique-email');
  });

  it('renders the shared confirm-email copy for email_not_confirmed', () => {
    render(<LoginForm initialState={{ ok: false, error: 'email_not_confirmed' }} />);

    const region = screen.getByTestId('login-confirm-email');
    expect(region).toHaveTextContent('Confirme seu cadastro');
    expect(region).toHaveTextContent(/busque na caixa de Spam ou Lixeira/);
  });

  it('does NOT reveal the confirm-email state for invalid_credentials', () => {
    render(<LoginForm initialState={{ ok: false, error: 'invalid_credentials' }} />);

    expect(screen.getByTestId('login-form-error')).toBeInTheDocument();
    expect(screen.queryByTestId('login-confirm-email')).not.toBeInTheDocument();
  });

  it('does NOT reveal the confirm-email state for any other error result', () => {
    for (const error of ['unknown', 'account_unavailable', 'locked_out'] as const) {
      const { unmount } = render(<LoginForm initialState={{ ok: false, error }} />);
      expect(screen.queryByTestId('login-confirm-email')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('renders requires_password_reset error with link even when email is empty', () => {
    render(<LoginForm initialState={{ ok: false, error: 'requires_password_reset' }} />);

    const error = screen.getByTestId('login-form-error');
    expect(error).toHaveTextContent(/Por segurança/);
    expect(error).toHaveTextContent(/redefina sua senha/);

    const link = error.querySelector('a');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/forgot-password?email=');
    expect(link).toHaveTextContent('redefina sua senha');
  });
});
