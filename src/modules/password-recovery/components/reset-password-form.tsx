'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';

import {
  resetPasswordInputSchema,
  type ResetPasswordInput,
} from '@/modules/password-recovery/lib/reset-password-input-schema';
import {
  passwordPolicy,
  PASSWORD_MIN_LENGTH,
  type PasswordRule,
} from '@/modules/registration/lib/password-validators';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

// ---------------------------------------------------------------------------
// 7.4 — ResetPasswordForm
//
// Client Component for the `/reset-password` page. Password + confirm fields
// with live password policy feedback (reuses `passwordPolicy` from the
// registration module). On success, the Server Action redirects to
// `/login?banner=password_changed`.
//
// The action is injected via prop so the route shell remains the single
// client-facing Server Action surface.
// ---------------------------------------------------------------------------

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'invalid_session' | 'update_failed' | 'unknown' };

export type ResetPasswordFormProps = {
  action: (formData: FormData) => Promise<ResetPasswordResult>;
};

const ERROR_MESSAGES: Record<Extract<ResetPasswordResult, { ok: false }>['error'], string> = {
  invalid_input: 'Dados inválidos. Verifique os campos e tente novamente.',
  invalid_session:
    'Sessão de recuperação inválida ou expirada. Solicite um novo link de recuperação.',
  update_failed: 'Não foi possível atualizar a senha. Tente novamente.',
  unknown: 'Ocorreu um erro. Tente novamente.',
};

/**
 * pt-BR labels for each `PasswordRule`. Mirrors the signup form copy.
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

export function ResetPasswordForm({ action }: ResetPasswordFormProps) {
  const [isPending, startTransition] = useTransition();
  const [topLevelError, setTopLevelError] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState('');

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordInputSchema),
    mode: 'onTouched',
    defaultValues: { password: '', passwordConfirm: '' },
  });

  // Live evaluation of the strong-password policy.
  const policy = passwordPolicy(passwordValue);
  const missingSet = new Set<PasswordRule>(policy.missing);

  const passwordRegister = register('password');
  const passwordConfirmRegister = register('passwordConfirm');

  const onSubmit = handleSubmit((values) => {
    setTopLevelError(null);

    const formData = new FormData();
    formData.set('password', String(values.password));
    formData.set('passwordConfirm', String(values.passwordConfirm));

    startTransition(async () => {
      const result = await action(formData);

      // The action redirects on success — the Promise effectively never
      // resolves with `{ ok: true }` in production.
      if (result.ok) {
        setTopLevelError(null);
        return;
      }

      setTopLevelError(ERROR_MESSAGES[result.error]);
    });
  });

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="space-y-4"
      noValidate
    >
      {/* Nova senha + lista de critérios em tempo real */}
      <div className="space-y-2">
        <Label htmlFor="reset-password-password">Nova senha</Label>
        <Input
          id="reset-password-password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={
            errors.password
              ? 'reset-password-rules reset-password-password-error'
              : 'reset-password-rules'
          }
          data-testid="reset-password-form-password"
          {...passwordRegister}
          onChange={(event) => {
            void passwordRegister.onChange(event);
            setPasswordValue(event.target.value);
          }}
          onBlur={(event) => {
            void passwordRegister.onBlur(event);
            void trigger(['password', 'passwordConfirm']);
          }}
        />
        <ul
          id="reset-password-rules"
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
          <p id="reset-password-password-error" className="text-destructive text-sm">
            {errors.password.message}
          </p>
        ) : null}
      </div>

      {/* Confirmação de senha */}
      <div className="space-y-2">
        <Label htmlFor="reset-password-confirm">Confirme a nova senha</Label>
        <Input
          id="reset-password-confirm"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={errors.passwordConfirm ? true : undefined}
          aria-describedby={errors.passwordConfirm ? 'reset-password-confirm-error' : undefined}
          data-testid="reset-password-form-confirm"
          {...passwordConfirmRegister}
          onBlur={(event) => {
            void passwordConfirmRegister.onBlur(event);
            void trigger(['password', 'passwordConfirm']);
          }}
        />
        {errors.passwordConfirm?.message ? (
          <p id="reset-password-confirm-error" className="text-destructive text-sm">
            {errors.passwordConfirm.message}
          </p>
        ) : null}
      </div>

      {/* Erro top-level (invalid_session, update_failed, unknown) */}
      {topLevelError ? (
        <p
          role="alert"
          aria-live="polite"
          data-testid="reset-password-form-error"
          className="text-destructive text-sm"
        >
          {topLevelError}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={isPending}
        data-testid="reset-password-form-submit"
        className="w-full"
      >
        {isPending ? 'Redefinindo...' : 'Redefinir senha'}
      </Button>
    </form>
  );
}
