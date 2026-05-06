'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

// Result shape matching `LinkOAuthIdentityResult`.
export type LinkAccountResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input'; fieldErrors: Record<string, string[]> }
  | { ok: false; error: 'invalid_credentials' | 'invalid_link_request' | 'unknown' };

export type LinkAccountFormProps = {
  /** The pending OAuth user ID, passed from the URL query parameter. */
  pendingUserId: string;
  /** Server Action to submit the form. */
  action: (formData: FormData) => Promise<LinkAccountResult>;
};

const FALLBACK_ERROR_COPY = 'Ocorreu um erro. Tente novamente.';
const ERROR_COPY: Record<string, string> = {
  invalid_credentials: 'Senha incorreta. Tente novamente.',
  invalid_link_request: 'Solicitacao invalida ou expirada. Tente novamente.',
  unknown: FALLBACK_ERROR_COPY,
};

export function LinkAccountForm({ pendingUserId, action }: LinkAccountFormProps) {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    formData.set('pendingUserId', pendingUserId);

    startTransition(async () => {
      const result = await action(formData);

      if (result.ok) {
        // On success the action redirects — this line is a safety net for
        // tests or if the redirect somehow doesn't fire.
        setErrorMessage(null);
        return;
      }

      const copy =
        result.error === 'invalid_input'
          ? 'Informe sua senha.'
          : (ERROR_COPY[result.error] ?? FALLBACK_ERROR_COPY);
      setErrorMessage(copy);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="link-account-password">Senha da conta existente</Label>
        <Input
          id="link-account-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          data-testid="link-account-form-password"
        />
      </div>

      {errorMessage ? (
        <p
          role="alert"
          aria-live="polite"
          data-testid="link-account-form-error"
          className="text-destructive text-sm"
        >
          {errorMessage}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={isPending}
        data-testid="link-account-form-submit"
        className="w-full"
      >
        {isPending ? 'Vinculando...' : 'Vincular conta'}
      </Button>
    </form>
  );
}
