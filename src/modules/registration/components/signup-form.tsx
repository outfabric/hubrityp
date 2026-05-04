'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { type z } from 'zod';

import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { PASSWORD_MIN_LENGTH, passwordPolicy, type PasswordRule } from '../lib/password-validators';
import { signupInputSchema, type SignupInput } from '../lib/signup-input-schema';
import { UFS } from '../lib/uf-table';

/**
 * Form values held by RHF must match the schema's **input** shape so
 * `zodResolver(signupInputSchema)` types check against `useForm`'s
 * `TFieldValues`. The input shape narrows `crpUf` to a free-form
 * string and the three consent flags to literal `true` (Zod's
 * `z.literal(true)` does not widen on input). We accept this typing
 * and pair it with `false as true` casts at the single
 * `defaultValues` boundary — the runtime invariant is preserved by
 * the resolver, which rejects `false` at parse time.
 *
 * The third generic of `useForm` declares the **transformed** values
 * (the schema's output) so the submit handler receives a refined
 * `SignupInput` (with `crpUf: UfCode` and consents as `true`).
 */
type SignupFormValues = z.input<typeof signupInputSchema>;

/**
 * Result shape returned by the `signUp` Server Action. Mirrors
 * `SignUpResult` from `@/modules/registration/server/sign-up`. The form
 * accepts the action via prop (rather than importing the route shell
 * directly) so unit tests can inject a stub and the route shell remains
 * the single client-facing action surface — exactly the same pattern the
 * existing `LoginForm` follows.
 */
export type SignUpResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'duplicate_email' | 'duplicate_crp' | 'unknown' };

export type SignupFormProps = {
  /**
   * The Server Action that performs the signup. The route shell at
   * `app/(auth)/signup/actions.ts` provides the production wiring; tests
   * pass a Promise-returning stub. On success the action redirects, so the
   * Promise effectively never resolves with `{ ok: true }` in production —
   * the form handles both shapes gracefully.
   */
  action: (formData: FormData) => Promise<SignUpResult>;
};

/**
 * Top-level pt-BR copy for non-field errors returned by the action.
 */
const TOP_LEVEL_ERROR_COPY: Record<Extract<SignUpResult, { ok: false }>['error'], string> = {
  invalid_input: '', // never surfaced top-level — `invalid_input` is mapped to per-field errors
  duplicate_email: 'Este email já está cadastrado.',
  duplicate_crp: 'Este CRP já está cadastrado.',
  unknown: 'Ocorreu um erro. Tente novamente.',
};

/**
 * pt-BR labels for each `PasswordRule`. Used by the live criteria list.
 */
const PASSWORD_RULE_COPY: Record<PasswordRule, string> = {
  length: `Pelo menos ${PASSWORD_MIN_LENGTH} caracteres`,
  uppercase: 'Pelo menos uma letra maiúscula',
  lowercase: 'Pelo menos uma letra minúscula',
  digit: 'Pelo menos um número',
  special: 'Pelo menos um caractere especial',
};

const PASSWORD_RULES_ORDER: readonly PasswordRule[] = [
  'length',
  'uppercase',
  'lowercase',
  'digit',
  'special',
];

/**
 * SignupForm — `'use client'` leaf for `/signup`.
 *
 * Behavior contract enforced by the spec:
 *   - Per-field validation runs after **blur**, then re-validates on
 *     change (`mode: 'onTouched'`).
 *   - The password criteria list updates live as the user types but does
 *     NOT prevent typing.
 *   - Submission is delegated to the Server Action passed via `action`.
 *     On `invalid_input` the action's `fieldErrors` are mirrored into
 *     RHF via `setError`. On other typed errors, the top-level
 *     `signup-form-error` region renders the canonical copy.
 *   - Every field exposes its `data-testid` and a per-field error region
 *     `signup-form-error-<field>` linked via `aria-describedby`.
 */
export function SignupForm({ action }: SignupFormProps) {
  const [isPending, startTransition] = useTransition();
  const [topLevelError, setTopLevelError] = useState<string | null>(null);
  // Live mirror of the password input value, used to drive the criteria
  // list. RHF's `watch()` would also work, but a local string keeps the
  // criteria recomputation cheap and isolated from the rest of the form.
  const [passwordValue, setPasswordValue] = useState('');

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<SignupFormValues, unknown, SignupInput>({
    resolver: zodResolver(signupInputSchema),
    // `onTouched` validates on the FIRST blur of a field, then re-validates
    // on subsequent changes. This matches the spec's requirement that
    // per-field feedback appear in blur, never on every keystroke.
    mode: 'onTouched',
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      passwordConfirm: '',
      crpNumber: '',
      crpUf: '',
      // The literal-`true` schema fields force `false as true` casts
      // at this single boundary. Zod still rejects an unsubmitted
      // checkbox at parse time, so the runtime contract holds.
      acceptedTerms: false as true,
      acceptedPrivacy: false as true,
      acceptedSensitiveData: false as true,
    },
  });

  // Live evaluation of the strong-password policy — the missing rules
  // render in red; the satisfied ones in success colour. The list itself
  // uses `aria-live="polite"` so a screen reader announces progress
  // without interrupting the user.
  const policy = passwordPolicy(passwordValue);
  const missingSet = new Set<PasswordRule>(policy.missing);

  // RHF requires its own `register` reference for the password input so
  // form state stays in sync — but we ALSO want to mirror the value into
  // local state to drive the criteria list. The wrapper merges both.
  const passwordRegister = register('password');

  // The Select primitive exposes value via callback rather than a native
  // `<input>` event, so we register `crpUf` with RHF and drive it via
  // `setValue`. The hidden `<input>` ensures a `name=crpUf` field is
  // present in the submitted FormData, which the Server Action reads.
  const crpUfRegister = register('crpUf');

  // Stable IDs for `htmlFor`/`aria-describedby` association.
  const ids = {
    fullName: useId(),
    email: useId(),
    password: useId(),
    passwordConfirm: useId(),
    crpNumber: useId(),
    crpUf: useId(),
    terms: useId(),
    privacy: useId(),
    sensitive: useId(),
    passwordRules: useId(),
  } as const;

  const errorIds = {
    fullName: `signup-form-error-fullName-${ids.fullName}`,
    email: `signup-form-error-email-${ids.email}`,
    password: `signup-form-error-password-${ids.password}`,
    passwordConfirm: `signup-form-error-passwordConfirm-${ids.passwordConfirm}`,
    crpNumber: `signup-form-error-crpNumber-${ids.crpNumber}`,
    crpUf: `signup-form-error-crpUf-${ids.crpUf}`,
    terms: `signup-form-error-acceptedTerms-${ids.terms}`,
    privacy: `signup-form-error-acceptedPrivacy-${ids.privacy}`,
    sensitive: `signup-form-error-acceptedSensitiveData-${ids.sensitive}`,
  } as const;

  const onSubmit = handleSubmit((values) => {
    setTopLevelError(null);

    // Hand the raw FormData to the Server Action. We re-build it from the
    // RHF-validated values so the boolean checkboxes serialize as `'on'`
    // (the canonical browser shape the action's `coerceCheckbox` helper
    // already understands). Each `String(...)` cast is a typing no-op at
    // runtime — Zod's narrowed refinements (`z.literal(true)`,
    // UF-narrowing `refine`) widen RHF's inferred field types in ways
    // that confuse TS' assignability check on `FormData.set`.
    const formData = new FormData();
    formData.set('fullName', String(values.fullName));
    formData.set('email', String(values.email));
    formData.set('password', String(values.password));
    formData.set('passwordConfirm', String(values.passwordConfirm));
    formData.set('crpNumber', String(values.crpNumber));
    formData.set('crpUf', String(values.crpUf));
    if (values.acceptedTerms) formData.set('acceptedTerms', 'on');
    if (values.acceptedPrivacy) formData.set('acceptedPrivacy', 'on');
    if (values.acceptedSensitiveData) formData.set('acceptedSensitiveData', 'on');

    startTransition(async () => {
      const result = await action(formData);

      // The action redirects on success — in production the Promise
      // never resolves with `ok: true` (Next.js throws a redirect
      // error). We nonetheless handle the shape defensively for tests
      // and for `next-action`-aware mocks.
      if (result.ok) {
        setTopLevelError(null);
        return;
      }

      if (result.error === 'invalid_input') {
        // Mirror server-side field errors into RHF so the inline
        // regions render uniformly. We only set the FIRST message per
        // field — RHF only renders one error per field anyway.
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages.length > 0) {
            setError(field as keyof SignupFormValues, {
              type: 'server',
              message: messages[0],
            });
          }
        }
        setTopLevelError(null);
        return;
      }

      setTopLevelError(TOP_LEVEL_ERROR_COPY[result.error]);
    });
  });

  return (
    <form
      onSubmit={(event) => {
        // `handleSubmit` returns a Promise we deliberately do not await
        // — RHF dispatches state updates internally and our submit
        // logic pushes its own state via `useTransition`. Wrapping
        // here keeps the JSX type `(e) => void` instead of leaking a
        // promise into the DOM event surface (the lint rule the repo
        // enforces refuses promise-returning attribute callbacks).
        void onSubmit(event);
      }}
      className="space-y-5"
      noValidate
    >
      {/* Nome completo */}
      <div className="space-y-2">
        <Label htmlFor={ids.fullName}>Nome completo</Label>
        <Input
          id={ids.fullName}
          type="text"
          autoComplete="name"
          required
          aria-invalid={errors.fullName ? true : undefined}
          aria-describedby={errors.fullName ? errorIds.fullName : undefined}
          data-testid="signup-form-name"
          {...register('fullName')}
        />
        {errors.fullName?.message ? (
          <p
            id={errorIds.fullName}
            data-testid="signup-form-error-fullName"
            className="text-danger-700 text-sm"
          >
            {errors.fullName.message}
          </p>
        ) : null}
      </div>

      {/* E-mail */}
      <div className="space-y-2">
        <Label htmlFor={ids.email}>E-mail</Label>
        <Input
          id={ids.email}
          type="email"
          autoComplete="email"
          required
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? errorIds.email : undefined}
          data-testid="signup-form-email"
          {...register('email')}
        />
        {errors.email?.message ? (
          <p
            id={errorIds.email}
            data-testid="signup-form-error-email"
            className="text-danger-700 text-sm"
          >
            {errors.email.message}
          </p>
        ) : null}
      </div>

      {/* Senha + lista de critérios em tempo real */}
      <div className="space-y-2">
        <Label htmlFor={ids.password}>Senha</Label>
        <Input
          id={ids.password}
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={
            // Always link the rules list; conditionally append the
            // error message id when an error is present.
            errors.password ? `${ids.passwordRules} ${errorIds.password}` : ids.passwordRules
          }
          data-testid="signup-form-password"
          {...passwordRegister}
          onChange={(event) => {
            // Forward to RHF first so validation state is correct,
            // then mirror into local state for the criteria list.
            void passwordRegister.onChange(event);
            setPasswordValue(event.target.value);
          }}
        />
        <ul
          id={ids.passwordRules}
          aria-live="polite"
          className="text-text-tertiary space-y-1 text-xs"
        >
          {PASSWORD_RULES_ORDER.map((rule) => {
            const satisfied = passwordValue.length > 0 && !missingSet.has(rule);
            const className = satisfied
              ? 'text-success-700'
              : passwordValue.length === 0
                ? 'text-text-tertiary'
                : 'text-danger-700';
            return (
              <li key={rule} className={className}>
                <span aria-hidden="true">{satisfied ? '✓' : '•'}</span> {PASSWORD_RULE_COPY[rule]}
              </li>
            );
          })}
        </ul>
        {errors.password?.message ? (
          <p
            id={errorIds.password}
            data-testid="signup-form-error-password"
            className="text-danger-700 text-sm"
          >
            {errors.password.message}
          </p>
        ) : null}
      </div>

      {/* Confirmação de senha */}
      <div className="space-y-2">
        <Label htmlFor={ids.passwordConfirm}>Confirme a senha</Label>
        <Input
          id={ids.passwordConfirm}
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.passwordConfirm ? true : undefined}
          aria-describedby={errors.passwordConfirm ? errorIds.passwordConfirm : undefined}
          data-testid="signup-form-password-confirm"
          {...register('passwordConfirm')}
        />
        {errors.passwordConfirm?.message ? (
          <p
            id={errorIds.passwordConfirm}
            data-testid="signup-form-error-passwordConfirm"
            className="text-danger-700 text-sm"
          >
            {errors.passwordConfirm.message}
          </p>
        ) : null}
      </div>

      {/* CRP — número + UF lado a lado em desktop, empilhados em mobile */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
        <div className="space-y-2">
          <Label htmlFor={ids.crpNumber}>Número do CRP</Label>
          <Input
            id={ids.crpNumber}
            type="text"
            inputMode="numeric"
            placeholder="06/123456"
            required
            aria-invalid={errors.crpNumber ? true : undefined}
            aria-describedby={errors.crpNumber ? errorIds.crpNumber : undefined}
            data-testid="signup-form-crp-number"
            {...register('crpNumber')}
          />
          {errors.crpNumber?.message ? (
            <p
              id={errorIds.crpNumber}
              data-testid="signup-form-error-crpNumber"
              className="text-danger-700 text-sm"
            >
              {errors.crpNumber.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor={ids.crpUf}>UF</Label>
          {/* Hidden RHF-managed input keeps `name=crpUf` in the submitted
              FormData so the action can read it uniformly. The visible
              Radix Select drives both `setValue` and the hidden input. */}
          <input type="hidden" {...crpUfRegister} />
          <Select
            onValueChange={(value) => {
              setValue('crpUf', value, {
                shouldValidate: true,
                shouldTouch: true,
                shouldDirty: true,
              });
            }}
          >
            <SelectTrigger
              id={ids.crpUf}
              aria-invalid={errors.crpUf ? true : undefined}
              aria-describedby={errors.crpUf ? errorIds.crpUf : undefined}
              data-testid="signup-form-crp-uf"
            >
              <SelectValue placeholder="UF" />
            </SelectTrigger>
            <SelectContent>
              {UFS.map((uf) => (
                <SelectItem key={uf} value={uf}>
                  {uf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.crpUf?.message ? (
            <p
              id={errorIds.crpUf}
              data-testid="signup-form-error-crpUf"
              className="text-danger-700 text-sm"
            >
              {errors.crpUf.message}
            </p>
          ) : null}
        </div>
      </div>

      {/* Consentimentos LGPD */}
      <div className="space-y-3">
        <ConsentRow
          inputId={ids.terms}
          errorId={errorIds.terms}
          testId="signup-form-terms"
          errorTestId="signup-form-error-acceptedTerms"
          label="Aceito os Termos de Uso"
          register={register('acceptedTerms')}
          setValue={(checked) =>
            // The schema field is typed `true`; Zod will reject `false`
            // at parse time, so the cast is honest at this single
            // assignment site rather than spreading the literal-vs-
            // boolean asymmetry through the component.
            setValue('acceptedTerms', checked as true, {
              shouldValidate: true,
              shouldTouch: true,
              shouldDirty: true,
            })
          }
          errorMessage={errors.acceptedTerms?.message}
        />
        <ConsentRow
          inputId={ids.privacy}
          errorId={errorIds.privacy}
          testId="signup-form-privacy"
          errorTestId="signup-form-error-acceptedPrivacy"
          label="Aceito a Política de Privacidade"
          register={register('acceptedPrivacy')}
          setValue={(checked) =>
            setValue('acceptedPrivacy', checked as true, {
              shouldValidate: true,
              shouldTouch: true,
              shouldDirty: true,
            })
          }
          errorMessage={errors.acceptedPrivacy?.message}
        />
        <ConsentRow
          inputId={ids.sensitive}
          errorId={errorIds.sensitive}
          testId="signup-form-sensitive-data"
          errorTestId="signup-form-error-acceptedSensitiveData"
          label="Aceito o Tratamento de Dados Sensíveis (LGPD)"
          register={register('acceptedSensitiveData')}
          setValue={(checked) =>
            setValue('acceptedSensitiveData', checked as true, {
              shouldValidate: true,
              shouldTouch: true,
              shouldDirty: true,
            })
          }
          errorMessage={errors.acceptedSensitiveData?.message}
        />
      </div>

      {/* Erro top-level (duplicate_email, duplicate_crp, unknown) */}
      {topLevelError ? (
        <p
          role="alert"
          aria-live="polite"
          data-testid="signup-form-error"
          className="text-danger-700 text-sm"
        >
          {topLevelError}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={isPending}
        data-testid="signup-form-submit"
        className="w-full"
      >
        {isPending ? 'Criando conta...' : 'Criar conta'}
      </Button>
    </form>
  );
}

/**
 * Single consent row — checkbox + label + per-field error region.
 *
 * The Radix Checkbox primitive emits a `boolean | 'indeterminate'`
 * change event rather than a native `<input>` event, so we register the
 * field with RHF for the hidden `name` and bridge the click via
 * `setValue`. A hidden `<input>` shadows the checkbox to ensure the
 * form's submitted FormData carries `acceptedTerms=on` (etc.) when the
 * box is checked, matching the wire format the action expects.
 */
type RegisterReturn = ReturnType<ReturnType<typeof useForm<SignupFormValues>>['register']>;

function ConsentRow({
  inputId,
  errorId,
  testId,
  errorTestId,
  label,
  register,
  setValue,
  errorMessage,
}: {
  inputId: string;
  errorId: string;
  testId: string;
  errorTestId: string;
  label: string;
  register: RegisterReturn;
  setValue: (checked: boolean) => void;
  errorMessage: string | undefined;
}) {
  return (
    <div>
      <div className="flex items-start gap-3">
        <Checkbox
          id={inputId}
          data-testid={testId}
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={errorMessage ? errorId : undefined}
          onCheckedChange={(checked) => setValue(checked === true)}
        />
        <input type="hidden" {...register} />
        <Label htmlFor={inputId} className="cursor-pointer text-sm leading-snug">
          {label}
        </Label>
      </div>
      {errorMessage ? (
        <p id={errorId} data-testid={errorTestId} className="text-danger-700 mt-1 ml-7 text-sm">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
