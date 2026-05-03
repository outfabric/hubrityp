import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
    expect(error).toHaveTextContent('Erro inesperado, tente novamente.');
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
});
