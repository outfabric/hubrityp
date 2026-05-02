'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useActionState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginInputSchema, type LoginInput } from '@/lib/auth/login-input-schema';

import { type SignInResult, signIn } from './actions';

// `useActionState` (React 19) needs an action that takes `(prevState, formData)`.
// `signIn` itself only needs the FormData, so we adapt the signature here.
async function signInAction(_prevState: SignInResult | null, formData: FormData) {
  return signIn(formData);
}

// `initialState` is exposed as a prop purely for testability: unit tests can
// render the form with a non-null state to assert error rendering without
// having to drive the action through React's transition machinery. Production
// callers (the login page) leave it as `null`.
export type LoginFormProps = {
  redirectTo?: string;
  initialState?: SignInResult | null;
};

const ERROR_MESSAGES = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  unknown: 'Erro inesperado, tente novamente.',
} as const;

export function LoginForm({ redirectTo, initialState = null }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(signInAction, initialState);

  const {
    register,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '' },
  });

  const errorMessage = state && !state.ok ? ERROR_MESSAGES[state.error] : null;
  const emailFieldError = errors.email?.message;
  const passwordFieldError = errors.password?.message;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

      <div className="space-y-2">
        <Label htmlFor="login-email">E-mail</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={emailFieldError ? true : undefined}
          aria-describedby={emailFieldError ? 'login-email-error' : undefined}
          data-testid="login-form-email"
          {...register('email')}
        />
        {emailFieldError ? (
          <p id="login-email-error" className="text-destructive text-sm">
            {emailFieldError}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="login-password">Senha</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={passwordFieldError ? true : undefined}
          aria-describedby={passwordFieldError ? 'login-password-error' : undefined}
          data-testid="login-form-password"
          {...register('password')}
        />
        {passwordFieldError ? (
          <p id="login-password-error" className="text-destructive text-sm">
            {passwordFieldError}
          </p>
        ) : null}
      </div>

      {errorMessage ? (
        <p
          role="alert"
          aria-live="polite"
          data-testid="login-form-error"
          className="text-destructive text-sm"
        >
          {errorMessage}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} data-testid="login-form-submit" className="w-full">
        {isPending ? 'Entrando...' : 'Entrar'}
      </Button>
    </form>
  );
}
