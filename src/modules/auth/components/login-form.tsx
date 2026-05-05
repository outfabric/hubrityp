'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useActionState } from 'react';
import { useForm } from 'react-hook-form';

// The `signIn` Server Action is consumed from the route shell at
// `@/app/(auth)/login/actions`. Client Components MUST import Server Actions
// from a file that carries the `'use server'` directive — only then does
// Next.js compile the import into a client-safe RPC stub. The module barrel
// (`@/modules/auth`) re-exports `signInImpl` for *server-side* consumers
// (e.g. other route shells), but importing it from a Client Component would
// drag the `import 'server-only'` chain (logger, supabase server client) into
// the browser bundle and the RSC boundary checker would (correctly) refuse
// the build. The route shell stays the single client-facing action surface.
import { signIn } from '@/app/(auth)/login/actions';
import { loginInputSchema, type LoginFormInput } from '@/modules/auth/lib/login-input-schema';
import type { SignInResult } from '@/modules/auth/lib/sign-in-result';
import { SIGN_IN_ERROR_MESSAGES } from '@/modules/auth/lib/sign-in-result';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

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

// pt-BR copy sourced from the canonical `SIGN_IN_ERROR_MESSAGES` map in
// `sign-in-result.ts`. This is the single source of truth for error copy;
// the keys match `SignInError` exactly so a new variant forces a compile
// error if the map is not updated.

export function LoginForm({ redirectTo, initialState = null }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(signInAction, initialState);

  const {
    register,
    formState: { errors },
  } = useForm<LoginFormInput>({
    resolver: zodResolver(loginInputSchema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '', keepLoggedIn: false },
  });

  const emailFieldError = errors.email?.message;
  const passwordFieldError = errors.password?.message;

  // Hide the server-side error region whenever a client-side field error is
  // showing. Without this gate, a failed login followed by editing a field
  // leaves both messages stacked — the server "E-mail ou senha incorretos"
  // alongside the field-level "E-mail inválido" — confusing the user about
  // which problem to fix first. The server error remains source-of-truth
  // for the previous attempt; it just yields visual priority to whatever
  // the user is currently typing.
  const hasFieldError = Boolean(emailFieldError ?? passwordFieldError);
  const errorMessage =
    state && !state.ok && !hasFieldError ? SIGN_IN_ERROR_MESSAGES[state.error] : null;

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
