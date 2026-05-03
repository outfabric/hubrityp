'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { useForm } from 'react-hook-form';

// `signUp` is consumed from the route shell at `@/app/(auth)/signup/actions`.
// Client Components MUST import Server Actions from a file carrying the
// `'use server'` directive — only then does Next.js compile the import into a
// client-safe RPC stub. The module barrel (`@/modules/auth`) re-exports
// `signUpImpl` for *server-side* consumers (other route shells, server
// tests), but importing it from a Client Component would drag the
// `import 'server-only'` chain (logger, supabase server client, account
// lifecycle helpers) into the browser bundle and the RSC boundary checker
// would (correctly) refuse the build. Same pattern as `<LoginForm/>`.
import { type SignUpResult } from '@/app/(auth)/signup/actions';
import { signupInputSchema, type SignupInput } from '@/modules/auth/lib/signup-input-schema';
// Import `BRAZILIAN_UFS` from the pure-helpers path rather than the
// `@/modules/crp-validation` barrel: the barrel re-exports server-only
// actions (`approveCrpValidation`, `rejectCrpValidation`) which would drag
// the `import 'server-only'` chain into this Client Component bundle. The
// barrel doc comment in `src/modules/crp-validation/index.ts` calls out the
// trap; this matches the established pattern in `signup-input-schema.ts`.
import { BRAZILIAN_UFS } from '@/modules/crp-validation/lib/regional-codes';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

// Keep the action contract explicit and decoupled from the page wiring: the
// page passes the action down as a prop, the form invokes it via React Hook
// Form's submit handler. We deliberately accept FormData OR SignupInput so
// tests can call the form's submit path without round-tripping through a
// FormData synthesis step.
export type SignUpAction = (input: FormData | SignupInput) => Promise<SignUpResult>;

// Top-level error messages keyed by the typed `error` variant returned by the
// `signUp` Server Action. Matches the spec one-for-one — adding a new variant
// requires both the action and this map to update so the exhaustive narrowing
// keeps compiling. `validation_failed` is intentionally NOT in this map:
// validation errors are surfaced inline per field via `setError`, never as a
// banner.
const FORM_LEVEL_ERROR_MESSAGES = {
  email_already_registered: 'Este email já está cadastrado.',
  crp_already_registered: 'Este CRP já está cadastrado.',
  unknown: 'Não foi possível concluir o cadastro. Tente novamente em instantes.',
} as const;

type FormLevelErrorKey = keyof typeof FORM_LEVEL_ERROR_MESSAGES;

export type SignupFormProps = {
  /**
   * The signup Server Action wired from the route shell. Required so the form
   * stays decoupled from the action import path (and so unit tests can stub
   * it without driving Next's transition machinery).
   */
  action: SignUpAction;
  /**
   * Optional initial result, used by tests to assert error rendering without
   * having to drive the action through React state machinery. Production
   * callers (the signup page) leave this undefined.
   */
  initialResult?: SignUpResult;
};

export function SignupForm({ action, initialResult }: SignupFormProps) {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupInputSchema),
    mode: 'onSubmit',
    reValidateMode: 'onBlur',
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      passwordConfirm: '',
      crpNumber: '',
      // Default crpUf is intentionally an empty string — the Zod enum will
      // reject it and produce the inline error if the user submits without
      // picking a UF. The select renders an empty placeholder option so this
      // initial value is reachable in the UI.
      crpUf: '' as SignupInput['crpUf'],
      acceptedTerms: false as unknown as true,
      acceptedPrivacy: false as unknown as true,
      acceptedSensitiveData: false as unknown as true,
    },
  });

  // Form-level error state. Initialised from `initialResult` so the very
  // first render already reflects a previous attempt's failure (used by unit
  // tests to assert error rendering without driving a submit). Cleared on
  // every successful submit.
  const [formErrorKey, setFormErrorKey] = useState<FormLevelErrorKey | null>(() =>
    pickFormLevelKey(initialResult),
  );

  const submitHandler = handleSubmit(async (data) => {
    const result = await action(data);
    applyResultToFormState({
      result,
      setError,
      setFormErrorKey,
    });
    // Successful signup navigates to the bloqueante page so the user can
    // open their email client and click the verification link. The action
    // does NOT call `redirect()` itself — it returns `{ ok: true,
    // redirectTo }` because returning a structured result keeps the
    // Server Action contract serializable and lets the form share its
    // success path with future entry points (e.g. an admin-driven
    // create-user). The router push is the form's responsibility.
    if (result.ok) {
      router.push(result.redirectTo);
    }
  });

  // `handleSubmit` returns a `Promise<void>`-returning function, but JSX's
  // `onSubmit` expects a `void`-returning event handler. We wrap to swallow
  // the promise (RHF already manages the async lifecycle internally via
  // `isSubmitting`); leaving it unwrapped trips
  // `@typescript-eslint/no-misused-promises`.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    void submitHandler(event);
  };

  const formErrorMessage = formErrorKey ? FORM_LEVEL_ERROR_MESSAGES[formErrorKey] : null;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="signup-full-name">Nome completo</Label>
        <Input
          id="signup-full-name"
          type="text"
          autoComplete="name"
          required
          aria-invalid={errors.fullName ? true : undefined}
          aria-describedby={errors.fullName ? 'signup-full-name-error' : undefined}
          data-testid="signup-form-full-name"
          {...register('fullName')}
        />
        {errors.fullName?.message ? (
          <p id="signup-full-name-error" className="text-destructive text-sm">
            {errors.fullName.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-email">E-mail</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'signup-email-error' : undefined}
          data-testid="signup-form-email"
          {...register('email')}
        />
        {errors.email?.message ? (
          <p id="signup-email-error" className="text-destructive text-sm">
            {errors.email.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-password">Senha</Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'signup-password-error' : undefined}
          data-testid="signup-form-password"
          {...register('password')}
        />
        {errors.password?.message ? (
          <p id="signup-password-error" className="text-destructive text-sm">
            {errors.password.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-password-confirm">Confirmação de senha</Label>
        <Input
          id="signup-password-confirm"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.passwordConfirm ? true : undefined}
          aria-describedby={errors.passwordConfirm ? 'signup-password-confirm-error' : undefined}
          data-testid="signup-form-password-confirm"
          {...register('passwordConfirm')}
        />
        {errors.passwordConfirm?.message ? (
          <p id="signup-password-confirm-error" className="text-destructive text-sm">
            {errors.passwordConfirm.message}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div className="space-y-2">
          <Label htmlFor="signup-crp-number">CRP</Label>
          <Input
            id="signup-crp-number"
            type="text"
            inputMode="text"
            autoComplete="off"
            placeholder="06/123456"
            required
            aria-invalid={errors.crpNumber ? true : undefined}
            aria-describedby={errors.crpNumber ? 'signup-crp-number-error' : undefined}
            data-testid="signup-form-crp-number"
            {...register('crpNumber')}
          />
          {errors.crpNumber?.message ? (
            <p id="signup-crp-number-error" className="text-destructive text-sm">
              {errors.crpNumber.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="signup-crp-uf">UF</Label>
          {/*
            Native <select> rather than a custom Combobox: the spec mandates a
            plain dropdown of all 27 UFs and the value MUST be upper-case at
            submit time. Rendering only upper-case option values guarantees
            the constraint by construction (the user cannot type a lowercase
            value), which is exactly what `crpUfSchema` expects.
          */}
          <select
            id="signup-crp-uf"
            required
            aria-invalid={errors.crpUf ? true : undefined}
            aria-describedby={errors.crpUf ? 'signup-crp-uf-error' : undefined}
            data-testid="signup-form-crp-uf"
            className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-20 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            {...register('crpUf')}
          >
            <option value="">--</option>
            {BRAZILIAN_UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
          {errors.crpUf?.message ? (
            <p id="signup-crp-uf-error" className="text-destructive text-sm">
              {errors.crpUf.message}
            </p>
          ) : null}
        </div>
      </div>

      <fieldset className="space-y-3 border-t pt-4">
        <legend className="sr-only">Consentimentos obrigatórios</legend>

        <div className="space-y-1">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              required
              aria-invalid={errors.acceptedTerms ? true : undefined}
              aria-describedby={errors.acceptedTerms ? 'signup-terms-error' : undefined}
              data-testid="signup-form-terms"
              className="mt-0.5"
              {...register('acceptedTerms')}
            />
            <span>Eu li e aceito os Termos de Uso.</span>
          </label>
          {errors.acceptedTerms?.message ? (
            <p
              id="signup-terms-error"
              data-testid="signup-form-terms-error"
              className="text-destructive text-sm"
            >
              {errors.acceptedTerms.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              required
              aria-invalid={errors.acceptedPrivacy ? true : undefined}
              aria-describedby={errors.acceptedPrivacy ? 'signup-privacy-error' : undefined}
              data-testid="signup-form-privacy"
              className="mt-0.5"
              {...register('acceptedPrivacy')}
            />
            <span>Eu li e aceito a Política de Privacidade.</span>
          </label>
          {errors.acceptedPrivacy?.message ? (
            <p
              id="signup-privacy-error"
              data-testid="signup-form-privacy-error"
              className="text-destructive text-sm"
            >
              {errors.acceptedPrivacy.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              required
              aria-invalid={errors.acceptedSensitiveData ? true : undefined}
              aria-describedby={
                errors.acceptedSensitiveData ? 'signup-sensitive-data-error' : undefined
              }
              data-testid="signup-form-sensitive-data"
              className="mt-0.5"
              {...register('acceptedSensitiveData')}
            />
            <span>
              Eu autorizo o tratamento dos meus dados sensíveis (e dos meus pacientes) conforme a
              Política de Privacidade.
            </span>
          </label>
          {errors.acceptedSensitiveData?.message ? (
            <p
              id="signup-sensitive-data-error"
              data-testid="signup-form-sensitive-data-error"
              className="text-destructive text-sm"
            >
              {errors.acceptedSensitiveData.message}
            </p>
          ) : null}
        </div>
      </fieldset>

      {formErrorMessage ? (
        <p
          role="alert"
          aria-live="polite"
          data-testid="signup-form-error"
          className="text-destructive text-sm"
        >
          {formErrorMessage}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={isSubmitting}
        data-testid="signup-form-submit"
        className="w-full"
      >
        {isSubmitting ? 'Criando conta...' : 'Criar conta'}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        Já tem uma conta?{' '}
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          Voltar para login
        </Link>
      </p>
    </form>
  );
}

// Pull the form-level error key from a `SignUpResult`. `validation_failed`
// resolves to `null` because validation errors are surfaced inline per field,
// never as a banner.
function pickFormLevelKey(result: SignUpResult | undefined): FormLevelErrorKey | null {
  if (!result || result.ok) return null;
  if (result.error === 'validation_failed') return null;
  return result.error;
}

// Apply a `SignUpResult` to React Hook Form's error state. Shared by the
// submit handler and any future mount-time effect. Fans out:
//   • email_already_registered  → email field error + form-level banner
//   • crp_already_registered    → crpNumber field error + form-level banner
//   • validation_failed         → per-field errors only (no banner)
//   • unknown                   → form-level banner only
function applyResultToFormState({
  result,
  setError,
  setFormErrorKey,
}: {
  result: SignUpResult;
  setError: (name: keyof SignupInput, error: { type: 'server'; message: string }) => void;
  setFormErrorKey: (next: FormLevelErrorKey | null) => void;
}): void {
  if (result.ok) {
    setFormErrorKey(null);
    return;
  }

  switch (result.error) {
    case 'email_already_registered':
      setError('email', {
        type: 'server',
        message: FORM_LEVEL_ERROR_MESSAGES.email_already_registered,
      });
      setFormErrorKey('email_already_registered');
      return;
    case 'crp_already_registered':
      setError('crpNumber', {
        type: 'server',
        message: FORM_LEVEL_ERROR_MESSAGES.crp_already_registered,
      });
      setFormErrorKey('crp_already_registered');
      return;
    case 'validation_failed': {
      // Server returned per-field validation errors. Surface each inline; do
      // NOT raise the form-level banner — the user can iterate field-by-field.
      const fieldErrors = result.fieldErrors;
      if (fieldErrors) {
        for (const [key, message] of Object.entries(fieldErrors)) {
          if (message) {
            setError(key as keyof SignupInput, { type: 'server', message });
          }
        }
      }
      setFormErrorKey(null);
      return;
    }
    case 'unknown':
      setFormErrorKey('unknown');
      return;
  }
}
