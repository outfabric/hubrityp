import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// We mock the Server Action module so importing `LoginForm` (which imports
// `signIn`) does not pull in the server-only auth path under jsdom. The
// component itself is a pure client component; the action is only invoked
// when the user submits, which we do not exercise here — these tests are
// render assertions plus state-conditional rendering.
vi.mock('./actions', () => ({
  signIn: vi.fn().mockResolvedValue({ ok: true }),
}));

import { LoginForm } from './login-form';

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
});
