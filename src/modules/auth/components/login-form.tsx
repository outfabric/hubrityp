'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useActionState, useState } from 'react';
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
// Import `GoogleButton` directly from its component file rather than from the
// `@/modules/oauth` barrel. The barrel co-exports Server Action implementations
// that import `'server-only'` / `next/headers`; pulling the barrel into this
// `'use client'` file would drag those server-only modules into the browser
// bundle and break the build.  This follows the same discipline documented in
// `@/modules/auth/index.ts` for `signIn`.
import { GoogleButton } from '@/modules/oauth/components/google-button';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
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

/**
 * Computes the remaining lockout time from the ISO `lockoutUntil` timestamp.
 * Returns a whole number of minutes (ceiled) so the user always sees at least
 * "1 min" while still locked.
 */
function computeRemainingMinutes(lockoutUntil: string | undefined): number {
  if (!lockoutUntil) return 0;
  const remaining = new Date(lockoutUntil).getTime() - Date.now();
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / 60_000);
}

/**
 * Renders the appropriate error region for the current `SignInResult`.
 *
 * `locked_out` and `requires_password_reset` get rich copy with links;
 * the remaining three errors use the static map from `sign-in-result.ts`.
 */
function ErrorRegion({ state, email }: { state: SignInResult; email: string }) {
  if (state.ok) return null;

  switch (state.error) {
    case 'locked_out': {
      const minutes = computeRemainingMinutes(state.lockoutUntil);
      const timeText = minutes > 0 ? `${String(minutes)} min` : 'alguns instantes';
      return (
        <div
          role="alert"
          aria-live="polite"
          data-testid="login-form-error"
          className="text-destructive text-sm"
        >
          <p>
            Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em {timeText}{' '}
            ou{' '}
            <Link href="/forgot-password" className="underline">
              redefina sua senha
            </Link>
            .
          </p>
        </div>
      );
    }

    case 'requires_password_reset': {
      const resetHref = `/forgot-password?email=${encodeURIComponent(email)}`;
      return (
        <div
          role="alert"
          aria-live="polite"
          data-testid="login-form-error"
          className="text-destructive text-sm"
        >
          <p>
            Por segurança,{' '}
            <Link href={resetHref} className="underline">
              redefina sua senha
            </Link>{' '}
            antes de entrar.
          </p>
        </div>
      );
    }

    case 'invalid_credentials':
      return (
        <p
          role="alert"
          aria-live="polite"
          data-testid="login-form-error"
          className="text-destructive text-sm"
        >
          E-mail ou senha incorretos.
        </p>
      );

    case 'account_unavailable':
      return (
        <p
          role="alert"
          aria-live="polite"
          data-testid="login-form-error"
          className="text-destructive text-sm"
        >
          Esta conta não está disponível. Entre em contato com o suporte.
        </p>
      );

    case 'unknown':
      return (
        <p
          role="alert"
          aria-live="polite"
          data-testid="login-form-error"
          className="text-destructive text-sm"
        >
          Algo deu errado. Tente novamente.
        </p>
      );
  }
}

export function LoginForm({ redirectTo, initialState = null }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState(signInAction, initialState);
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);

  // Track the current email value locally so the `requires_password_reset`
  // link can pre-fill `/forgot-password?email=`. We avoid RHF's `watch()`
  // because it returns a non-memoizable function that the React Compiler
  // flags as incompatible. Instead we compose a local `onChange` with
  // RHF's `register().onChange` so both systems stay in sync.
  const [currentEmail, setCurrentEmail] = useState('');

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

  // Destructure RHF's register return so we can compose its onChange with ours.
  const { onChange: rhfEmailOnChange, ...emailRegisterRest } = register('email');

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

      {/* Hidden input to submit keepLoggedIn with FormData */}
      <input type="hidden" name="keepLoggedIn" value={keepLoggedIn ? 'true' : 'false'} />

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
          {...emailRegisterRest}
          onChange={(e) => {
            setCurrentEmail(e.target.value);
            void rhfEmailOnChange(e);
          }}
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

      <div className="flex items-center gap-2">
        <Checkbox
          id="login-keep-logged-in"
          data-testid="login-form-keep-logged-in"
          checked={keepLoggedIn}
          onCheckedChange={(checked) => setKeepLoggedIn(checked === true)}
        />
        <Label htmlFor="login-keep-logged-in" className="cursor-pointer text-sm">
          Manter conectado
        </Label>
      </div>

      {state && !state.ok && !hasFieldError ? (
        <ErrorRegion state={state} email={currentEmail} />
      ) : null}

      <Button type="submit" disabled={isPending} data-testid="login-form-submit" className="w-full">
        {isPending ? 'Entrando...' : 'Entrar'}
      </Button>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card text-muted-foreground px-2">ou</span>
        </div>
      </div>

      <GoogleButton />
    </form>
  );
}
