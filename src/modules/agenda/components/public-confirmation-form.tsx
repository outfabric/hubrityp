'use client';

import { CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import type { PublicConfirmSessionResult, PublicDeclineSessionResult } from '@/modules/agenda';
import { Button } from '@/shared/ui/button';
import { Textarea } from '@/shared/ui/textarea';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PublicConfirmationFormProps {
  token: string;
  confirmAction: (token: string) => Promise<PublicConfirmSessionResult>;
  declineAction: (token: string, reason?: string) => Promise<PublicDeclineSessionResult>;
}

type FormState =
  | { kind: 'idle' }
  | { kind: 'declining' }
  | { kind: 'confirming' }
  | { kind: 'submitting-decline' }
  | { kind: 'confirmed' }
  | { kind: 'declined' }
  | { kind: 'error'; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Public confirmation form — Client Component.
 *
 * Two-phase interaction:
 *   1. Initial: "Confirmar presenca" (primary) + "Nao posso comparecer" (secondary)
 *   2. If declining: expands Textarea + "Confirmar cancelamento" (danger)
 *
 * After action: renders success/decline result message with aria-live.
 *
 * Design system alignment:
 *   - Buttons: full-width, with Lucide icons, loading states
 *   - Touch targets: min 44x44px (h-12 buttons = 48px)
 *   - Accessibility: aria-live polite on result, focus management
 *   - prefers-reduced-motion: respected via CSS tokens (duration-fast)
 */
export function PublicConfirmationForm({
  token,
  confirmAction,
  declineAction,
}: PublicConfirmationFormProps) {
  const [formState, setFormState] = useState<FormState>({ kind: 'idle' });
  const resultRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const focusResult = useCallback(() => {
    // After state transition, move focus to result region for screen readers
    setTimeout(() => {
      resultRef.current?.focus();
    }, 100);
  }, []);

  const handleConfirm = useCallback(() => {
    void (async () => {
      setFormState({ kind: 'confirming' });
      try {
        const result = await confirmAction(token);
        if (result.ok) {
          setFormState({ kind: 'confirmed' });
        } else {
          setFormState({
            kind: 'error',
            message: 'Não foi possível confirmar. Tente novamente.',
          });
        }
      } catch {
        setFormState({
          kind: 'error',
          message: 'Erro inesperado. Tente novamente.',
        });
      }
      focusResult();
    })();
  }, [token, confirmAction, focusResult]);

  const handleDeclineSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      void (async () => {
        const reason = reasonRef.current?.value ?? '';
        setFormState({ kind: 'submitting-decline' });
        try {
          const result = await declineAction(token, reason || undefined);
          if (result.ok) {
            setFormState({ kind: 'declined' });
          } else {
            setFormState({
              kind: 'error',
              message: 'Não foi possível registrar o cancelamento. Tente novamente.',
            });
          }
        } catch {
          setFormState({
            kind: 'error',
            message: 'Erro inesperado. Tente novamente.',
          });
        }
        focusResult();
      })();
    },
    [token, declineAction, focusResult],
  );

  // ---- Result states --------------------------------------------------------

  if (formState.kind === 'confirmed') {
    return (
      <div
        ref={resultRef}
        className="flex flex-col items-center gap-3 py-8 text-center"
        role="status"
        aria-live="polite"
        tabIndex={-1}
        data-testid="confirmation-success"
      >
        <CheckCircle2 className="text-success-500 h-12 w-12" aria-hidden="true" />
        <h3 className="text-text-primary text-lg leading-tight font-semibold">
          Presença confirmada
        </h3>
        <p className="text-text-secondary text-[15px]">Sua psicóloga foi notificada. Até lá!</p>
      </div>
    );
  }

  if (formState.kind === 'declined') {
    return (
      <div
        ref={resultRef}
        className="flex flex-col items-center gap-3 py-8 text-center"
        role="status"
        aria-live="polite"
        tabIndex={-1}
        data-testid="confirmation-declined"
      >
        <Info className="text-info-500 h-12 w-12" aria-hidden="true" />
        <h3 className="text-text-primary text-lg leading-tight font-semibold">
          Cancelamento registrado
        </h3>
        <p className="text-text-secondary text-[15px]">
          Sua psicóloga foi notificada sobre o cancelamento.
        </p>
      </div>
    );
  }

  if (formState.kind === 'error') {
    return (
      <div
        ref={resultRef}
        className="flex flex-col items-center gap-3 py-8 text-center"
        role="alert"
        aria-live="assertive"
        tabIndex={-1}
        data-testid="confirmation-error"
      >
        <XCircle className="text-danger-500 h-12 w-12" aria-hidden="true" />
        <h3 className="text-text-primary text-lg leading-tight font-semibold">Erro</h3>
        <p className="text-text-secondary text-[15px]">{formState.message}</p>
      </div>
    );
  }

  // ---- Interactive form -----------------------------------------------------

  const isLoading = formState.kind === 'confirming' || formState.kind === 'submitting-decline';
  const showDeclineForm = formState.kind === 'declining' || formState.kind === 'submitting-decline';

  return (
    <div className="flex flex-col gap-3" data-testid="confirmation-form">
      {/* Confirm button */}
      <Button
        size="lg"
        className="w-full"
        onClick={handleConfirm}
        disabled={isLoading}
        data-testid="confirm-button"
      >
        {formState.kind === 'confirming' ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
        )}
        Confirmar presença
      </Button>

      {/* Decline flow */}
      {!showDeclineForm ? (
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => setFormState({ kind: 'declining' })}
          disabled={isLoading}
          data-testid="decline-button"
        >
          <XCircle className="h-5 w-5" aria-hidden="true" />
          Não posso comparecer
        </Button>
      ) : (
        <form
          onSubmit={handleDeclineSubmit}
          className="flex flex-col gap-3"
          data-testid="decline-form"
        >
          <Textarea
            ref={reasonRef}
            name="reason"
            placeholder="Motivo (opcional)"
            aria-label="Motivo do cancelamento"
            data-testid="decline-reason"
          />
          <Button
            type="submit"
            variant="destructive"
            size="lg"
            className="w-full"
            disabled={formState.kind === 'submitting-decline'}
            data-testid="confirm-decline-button"
          >
            {formState.kind === 'submitting-decline' ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            ) : (
              <XCircle className="h-5 w-5" aria-hidden="true" />
            )}
            Confirmar cancelamento
          </Button>
        </form>
      )}
    </div>
  );
}
