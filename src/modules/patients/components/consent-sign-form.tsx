'use client';

import { CheckCircle2 } from 'lucide-react';
import { useCallback, useState, useTransition } from 'react';

import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Label } from '@/shared/ui/label';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SignConsentAction = (
  token: string,
) => Promise<{ ok: true } | { ok: false; error: string; message?: string }>;

interface ConsentSignFormProps {
  token: string;
  signAction: SignConsentAction;
}

type FormState =
  | { status: 'idle' }
  | { status: 'success' }
  | { status: 'refused' }
  | { status: 'error'; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client Component for the public consent signing form.
 *
 * Design system alignment:
 *   - Checkbox: shadcn `Checkbox` (checked state uses `brand-500`)
 *   - "Assinar" button: `Button` primary (default variant) with loading state
 *   - "Recusar" button: `Button` secondary
 *   - Gap `space-4` between checkbox and buttons
 *   - Success: `CheckCircle2` icon in `success-500` + h3 + body-sm
 *   - Accessibility: visible focus, `aria-label` on buttons, WCAG AA contrast
 */
export function ConsentSignForm({ token, signAction }: ConsentSignFormProps) {
  const [accepted, setAccepted] = useState(false);
  const [formState, setFormState] = useState<FormState>({ status: 'idle' });
  const [isPending, startTransition] = useTransition();

  const handleSign = useCallback(() => {
    startTransition(async () => {
      const result = await signAction(token);
      if (result.ok) {
        setFormState({ status: 'success' });
      } else {
        const message =
          'message' in result && result.message
            ? result.message
            : 'Erro inesperado ao assinar o termo. Tente novamente.';
        setFormState({ status: 'error', message });
      }
    });
  }, [signAction, token]);

  const handleRefuse = useCallback(() => {
    setFormState({ status: 'refused' });
  }, []);

  // Success state
  if (formState.status === 'success') {
    return (
      <div
        className="flex flex-col items-center gap-3 py-8 text-center"
        data-testid="consent-success"
      >
        <CheckCircle2 className="text-success-500 h-12 w-12" aria-hidden="true" />
        <h3 className="text-text-primary text-lg leading-tight font-semibold">
          Termo assinado com sucesso
        </h3>
        <p className="text-text-secondary text-[13px]">Uma copia sera enviada por email.</p>
      </div>
    );
  }

  // Refused state
  if (formState.status === 'refused') {
    return (
      <div
        className="flex flex-col items-center gap-3 py-8 text-center"
        data-testid="consent-refused"
      >
        <p className="text-text-secondary text-[15px]">
          Termo recusado. Caso tenha duvidas, entre em contato com seu psicologo.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="consent-sign-form">
      {/* Error feedback */}
      {formState.status === 'error' && (
        <p className="text-danger-700 text-sm" role="alert">
          {formState.message}
        </p>
      )}

      {/* Checkbox */}
      <div className="flex items-start gap-3">
        <Checkbox
          id="consent-accept"
          checked={accepted}
          onCheckedChange={(checked) => setAccepted(checked === true)}
          data-testid="consent-checkbox"
        />
        <Label
          htmlFor="consent-accept"
          className="cursor-pointer text-[15px] leading-snug font-normal"
        >
          Li e aceito os termos acima
        </Label>
      </div>

      {/* Buttons */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          onClick={handleSign}
          disabled={!accepted || isPending}
          aria-label="Assinar termo de consentimento"
          data-testid="consent-sign-button"
          className="w-full sm:w-auto"
        >
          {isPending ? 'Assinando...' : 'Assinar'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={handleRefuse}
          disabled={isPending}
          aria-label="Recusar termo de consentimento"
          data-testid="consent-refuse-button"
          className="w-full sm:w-auto"
        >
          Recusar
        </Button>
      </div>
    </div>
  );
}
