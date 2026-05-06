'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';

import {
  forgotPasswordInputSchema,
  type ForgotPasswordInput,
} from '@/modules/password-recovery/lib/forgot-password-input-schema';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

// ---------------------------------------------------------------------------
// 7.3 — ForgotPasswordForm
//
// Client Component for the `/forgot-password` page. Single email field with
// submit button. On success, replaces the form with a success message that
// gives no indication of whether the email exists (anti-enumeration).
//
// The action is injected via prop so the route shell remains the single
// client-facing Server Action surface — exactly the same pattern used by
// `LoginForm` and `SignupForm`.
// ---------------------------------------------------------------------------

export type RequestPasswordResetResult = { ok: true } | { ok: false; error: 'invalid_input' };

export type ForgotPasswordFormProps = {
  action: (formData: FormData) => Promise<RequestPasswordResetResult>;
};

const SUCCESS_COPY =
  'Se este e-mail estiver cadastrado, enviaremos um link de recuperação em alguns instantes.';

export function ForgotPasswordForm({ action }: ForgotPasswordFormProps) {
  const [isPending, startTransition] = useTransition();
  const [showSuccess, setShowSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordInputSchema),
    mode: 'onBlur',
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit((values) => {
    const formData = new FormData();
    formData.set('email', values.email);

    startTransition(async () => {
      const result = await action(formData);
      // Always show success on { ok: true }. Even on { ok: false, error:
      // 'invalid_input' } the Zod schema should have caught it client-side,
      // so reaching here with an error is a programming bug — we still show
      // the form so the user can retry.
      if (result.ok) {
        setShowSuccess(true);
      }
    });
  });

  if (showSuccess) {
    return (
      <div data-testid="forgot-password-form-success-message" className="space-y-2 text-center">
        <p className="text-sm">{SUCCESS_COPY}</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="space-y-4"
      noValidate
    >
      <div className="space-y-2">
        <Label htmlFor="forgot-password-email">E-mail</Label>
        <Input
          id="forgot-password-email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'forgot-password-email-error' : undefined}
          data-testid="forgot-password-form-email"
          {...register('email')}
        />
        {errors.email?.message ? (
          <p id="forgot-password-email-error" className="text-destructive text-sm">
            {errors.email.message}
          </p>
        ) : null}
      </div>

      <Button
        type="submit"
        disabled={isPending}
        data-testid="forgot-password-form-submit"
        className="w-full"
      >
        {isPending ? 'Enviando...' : 'Enviar link de recuperação'}
      </Button>
    </form>
  );
}
