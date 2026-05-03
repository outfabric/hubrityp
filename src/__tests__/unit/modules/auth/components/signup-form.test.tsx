import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// We mock `@/app/(auth)/signup/actions` so importing `SignupForm` (which
// imports the `SignUpResult` type from the route shell) does not pull in the
// server-only auth chain under jsdom. The shell file declares `'use server'`
// and re-exports `signUpImpl` from `@/modules/auth`, which transitively
// imports `@/shared/supabase/server` (carries `import 'server-only'` +
// `next/headers`) — both throw at module evaluation time outside a server
// runtime. Same pattern as `login-form.test.tsx`.
//
// The form receives the action via prop, not via direct import, but the
// route-shell mock still has to resolve so the type-only `SignUpResult`
// import does not drag the chain in. We export a no-op stub to keep the
// shape of the module valid.
vi.mock('@/app/(auth)/signup/actions', () => ({
  signUp: vi.fn().mockResolvedValue({ ok: true, redirectTo: '/auth/verify-email' }),
}));

// `useRouter()` is used by the form to navigate to `result.redirectTo` on a
// successful submit. Under jsdom (no AppRouterContext provider) calling the
// real hook throws "invariant expected app router to be mounted". The mock
// returns a thin `push` spy each test reads to verify the navigation
// happened — kept module-level (not factory) because vi.mock() factories
// cannot reference module-scoped variables at hoist time.
const routerPushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import type { SignUpResult } from '@/app/(auth)/signup/actions';
import { SignupForm } from '@/modules/auth/components/signup-form';

// Helpers --------------------------------------------------------------------

// Single source of truth for a valid signup payload. Tests fill the form by
// calling `fillForm` so we avoid duplicating the field map across test cases.
// The defaults pass `signupInputSchema` end-to-end — individual tests mutate
// fields to assert specific validation paths.
type SignupPayloadOverrides = {
  fullName?: string;
  email?: string;
  password?: string;
  passwordConfirm?: string;
  crpNumber?: string;
  crpUf?: string;
};

const VALID_PAYLOAD: Required<SignupPayloadOverrides> = {
  fullName: 'Ana Silva',
  email: 'ana@example.com',
  password: 'Senha!Forte9',
  passwordConfirm: 'Senha!Forte9',
  crpNumber: '06/123456',
  crpUf: 'SP',
};

function fillForm(overrides: SignupPayloadOverrides & { skipConsents?: boolean } = {}) {
  const data = { ...VALID_PAYLOAD, ...overrides };
  fireEvent.change(screen.getByTestId('signup-form-full-name'), {
    target: { value: data.fullName },
  });
  fireEvent.change(screen.getByTestId('signup-form-email'), { target: { value: data.email } });
  fireEvent.change(screen.getByTestId('signup-form-password'), {
    target: { value: data.password },
  });
  fireEvent.change(screen.getByTestId('signup-form-password-confirm'), {
    target: { value: data.passwordConfirm },
  });
  fireEvent.change(screen.getByTestId('signup-form-crp-number'), {
    target: { value: data.crpNumber },
  });
  fireEvent.change(screen.getByTestId('signup-form-crp-uf'), { target: { value: data.crpUf } });

  if (!overrides.skipConsents) {
    fireEvent.click(screen.getByTestId('signup-form-terms'));
    fireEvent.click(screen.getByTestId('signup-form-privacy'));
    fireEvent.click(screen.getByTestId('signup-form-sensitive-data'));
  }
}

function submit() {
  fireEvent.click(screen.getByTestId('signup-form-submit'));
}

// Type-safe action factory: returns a vi.fn typed against the action contract
// so test cases can stage exact `SignUpResult` responses without leaking
// `any` into the form props.
function makeAction(result: SignUpResult = { ok: true, redirectTo: '/auth/verify-email' }) {
  return vi.fn().mockResolvedValue(result);
}

// Tests ----------------------------------------------------------------------

describe('SignupForm — render contract', () => {
  it('renders every field with its data-testid', () => {
    render(<SignupForm action={makeAction()} />);

    for (const id of [
      'signup-form-full-name',
      'signup-form-email',
      'signup-form-password',
      'signup-form-password-confirm',
      'signup-form-crp-number',
      'signup-form-crp-uf',
      'signup-form-terms',
      'signup-form-privacy',
      'signup-form-sensitive-data',
      'signup-form-submit',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('does not render the form-level error region on a fresh render', () => {
    render(<SignupForm action={makeAction()} />);
    expect(screen.queryByTestId('signup-form-error')).not.toBeInTheDocument();
  });

  it('renders the CRP UF select with all 27 Brazilian UFs (upper-case)', () => {
    render(<SignupForm action={makeAction()} />);
    const select = screen.getByTestId('signup-form-crp-uf');
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error('expected the crp-uf testid to render an HTMLSelectElement');
    }
    // Includes the empty placeholder option, so 27 + 1.
    expect(select.options).toHaveLength(28);
    const values = Array.from(select.options).map((o) => o.value);
    // Spot-check a handful — the full list lives in `BRAZILIAN_UFS`.
    for (const uf of ['SP', 'RJ', 'DF', 'AC', 'TO', 'RR', 'AP']) {
      expect(values).toContain(uf);
    }
    // No lower-case entries by construction — the UF schema rejects them.
    for (const v of values) {
      if (v !== '') expect(v).toBe(v.toUpperCase());
    }
  });

  it('exposes a "Voltar para login" link to /login', () => {
    render(<SignupForm action={makeAction()} />);
    const link = screen.getByRole('link', { name: 'Voltar para login' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/login');
  });
});

describe('SignupForm — client-side validation', () => {
  it('shows validation errors on every required field after submitting an empty form', async () => {
    const action = makeAction();
    render(<SignupForm action={action} />);

    submit();

    // Wait for RHF + the Zod resolver to flush. We pin on one field then
    // assert the rest synchronously. The empty-string default value triggers
    // `min(3)` ("Nome muito curto.") on fullName — not the type-error message
    // — because the value IS a string, just too short.
    await waitFor(() => {
      expect(screen.getByText('Nome muito curto.')).toBeInTheDocument();
    });

    expect(screen.getByText(/Informe seu e-mail\./i)).toBeInTheDocument();
    // Password produces multiple inline errors via `superRefine`; assert the
    // length-related one which is the most stable across other validators.
    expect(screen.getByText(/A senha deve ter pelo menos 10 caracteres\./i)).toBeInTheDocument();
    // CRP format error fires for the empty string (regex mismatch).
    expect(screen.getByText(/CRP inválido\. Use o formato XX\/NNNNNN/i)).toBeInTheDocument();
    // UF enum error fires for the empty placeholder value.
    expect(screen.getByText(/UF do CRP inválida\./i)).toBeInTheDocument();

    // Per-consent error labels — the spec requires a dedicated region per
    // checkbox, not a shared one.
    expect(screen.getByTestId('signup-form-terms-error')).toBeInTheDocument();
    expect(screen.getByTestId('signup-form-privacy-error')).toBeInTheDocument();
    expect(screen.getByTestId('signup-form-sensitive-data-error')).toBeInTheDocument();

    // The action MUST NOT be called when validation fails on the client.
    expect(action).not.toHaveBeenCalled();
  });

  it('shows a passwordConfirm mismatch error when the two passwords differ', async () => {
    const action = makeAction();
    render(<SignupForm action={action} />);

    fillForm({ passwordConfirm: 'Senha!Diferente1' });
    submit();

    await waitFor(() => {
      expect(screen.getByText('As senhas não conferem.')).toBeInTheDocument();
    });

    expect(action).not.toHaveBeenCalled();
  });
});

describe('SignupForm — successful submit', () => {
  it('calls the action with the parsed input when the form is valid', async () => {
    routerPushMock.mockClear();
    const action = makeAction();
    render(<SignupForm action={action} />);

    fillForm();
    submit();

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });

    const arg = action.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      fullName: 'Ana Silva',
      email: 'ana@example.com',
      password: 'Senha!Forte9',
      passwordConfirm: 'Senha!Forte9',
      crpNumber: '06/123456',
      crpUf: 'SP',
      acceptedTerms: true,
      acceptedPrivacy: true,
      acceptedSensitiveData: true,
    });
  });

  it('navigates to result.redirectTo on a successful submit', async () => {
    routerPushMock.mockClear();
    const action = makeAction({ ok: true, redirectTo: '/auth/verify-email' });
    render(<SignupForm action={action} />);

    fillForm();
    submit();

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith('/auth/verify-email');
    });
  });

  it('does NOT navigate when the action returns an error', async () => {
    routerPushMock.mockClear();
    const action = makeAction({ ok: false, error: 'email_already_registered' });
    render(<SignupForm action={action} />);

    fillForm();
    submit();

    await waitFor(() => {
      expect(action).toHaveBeenCalled();
    });
    expect(routerPushMock).not.toHaveBeenCalled();
  });
});

describe('SignupForm — server-side error rendering', () => {
  it('surfaces email_already_registered on the email field AND in the form-level region', async () => {
    const action = makeAction({ ok: false, error: 'email_already_registered' });
    render(<SignupForm action={action} />);

    fillForm();
    submit();

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });

    // Form-level banner.
    const banner = await screen.findByTestId('signup-form-error');
    expect(banner).toHaveTextContent('Este email já está cadastrado.');

    // Inline error on the email field.
    const inline = screen.getByText('Este email já está cadastrado.', {
      selector: 'p#signup-email-error',
    });
    expect(inline).toBeInTheDocument();
  });

  it('surfaces crp_already_registered on the crp-number field AND in the form-level region', async () => {
    const action = makeAction({ ok: false, error: 'crp_already_registered' });
    render(<SignupForm action={action} />);

    fillForm();
    submit();

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });

    const banner = await screen.findByTestId('signup-form-error');
    expect(banner).toHaveTextContent('Este CRP já está cadastrado.');

    const inline = screen.getByText('Este CRP já está cadastrado.', {
      selector: 'p#signup-crp-number-error',
    });
    expect(inline).toBeInTheDocument();
  });

  it('surfaces validation_failed field errors inline (no form-level banner)', async () => {
    const action = makeAction({
      ok: false,
      error: 'validation_failed',
      fieldErrors: {
        email: 'E-mail inválido (servidor).',
        crpNumber: 'CRP inválido (servidor).',
      },
    });
    render(<SignupForm action={action} />);

    fillForm();
    submit();

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });

    // Per-field inline errors are populated.
    await waitFor(() => {
      expect(screen.getByText('E-mail inválido (servidor).')).toBeInTheDocument();
    });
    expect(screen.getByText('CRP inválido (servidor).')).toBeInTheDocument();

    // Form-level banner is NOT shown — the user iterates per field.
    expect(screen.queryByTestId('signup-form-error')).not.toBeInTheDocument();
  });

  it('surfaces unknown errors only via the form-level region', async () => {
    const action = makeAction({ ok: false, error: 'unknown' });
    render(<SignupForm action={action} />);

    fillForm();
    submit();

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(1);
    });

    const banner = await screen.findByTestId('signup-form-error');
    expect(banner).toHaveTextContent(
      'Não foi possível concluir o cadastro. Tente novamente em instantes.',
    );
  });

  it('renders an initialResult-driven error on first render (testability hook)', () => {
    render(
      <SignupForm
        action={makeAction()}
        initialResult={{ ok: false, error: 'email_already_registered' }}
      />,
    );

    const banner = screen.getByTestId('signup-form-error');
    expect(banner).toHaveTextContent('Este email já está cadastrado.');
  });
});
