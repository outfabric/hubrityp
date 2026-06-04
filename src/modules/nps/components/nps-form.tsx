'use client';

import { useState, useTransition } from 'react';

import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';

import type { SubmitNpsResult } from '../server/submit-nps';

/**
 * The 0–10 NPS scale rendered as a row of selectable score buttons.
 */
const NPS_SCORES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

const FEEDBACK_MAX_LENGTH = 2000;

export interface NpsFormProps {
  /**
   * Persists an NPS *answer*. The callback is a Server Action wrapper supplied
   * by the parent — this client leaf never touches the DB or `db` client
   * directly, so no server graph leaks into the client bundle. `feedback` is
   * omitted when the open field is left blank.
   */
  onSubmit: (input: { score: number; feedback?: string }) => Promise<SubmitNpsResult>;
  /**
   * Optional "answer later / não responder agora" control. When provided, a
   * ghost button is rendered that invokes this callback (the parent maps it to
   * the dismissal Server Action). Omitted in the Configurações entry, where
   * there is nothing to defer.
   */
  onDismiss?: () => void;
  /** Disable while a parent-driven dismissal is in flight. */
  dismissPending?: boolean;
  /** Called after a successful answer submission (e.g., close the modal). */
  onSubmitted?: () => void;
}

/**
 * Shared NPS answer form — the single submit surface reused by both the
 * day-7 modal ({@link NpsModal}) and the Configurações > Feedback entry.
 *
 * Behavior:
 *   - A 0–10 score selector (required to submit).
 *   - An optional open feedback field, "O que faria você dar nota mais alta?".
 *   - "Enviar" submits the answer; disabled until a score is picked.
 *   - "Não responder agora" (rendered only when {@link NpsFormProps.onDismiss}
 *     is supplied) defers the survey.
 *
 * The form holds NO server-authoritative state: the parent decides whether the
 * survey should appear at all (server-computed eligibility) and owns the
 * Server Action callbacks. Validation here is a UX affordance only — the
 * authoritative validation is the Zod `npsAnswerSchema` inside `submitNpsImpl`.
 *
 * Design System Sálvia:
 *   - Score buttons: outline idle, brand-500 fill when selected (the only
 *     brand usage — an "active state" indicator).
 *   - Textarea primitive for feedback, Label associated via `for`/`id`.
 *   - "Enviar" primary Button with loading state; "Não responder agora" ghost.
 */
export function NpsForm({
  onSubmit,
  onDismiss,
  dismissPending = false,
  onSubmitted,
}: NpsFormProps) {
  const [score, setScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    if (score === null) {
      setError('Selecione uma nota de 0 a 10.');
      return;
    }
    setError(null);

    startTransition(async () => {
      const trimmed = feedback.trim();
      const result = await onSubmit({
        score,
        ...(trimmed.length > 0 ? { feedback: trimmed } : {}),
      });

      if (result.ok) {
        onSubmitted?.();
      } else {
        // Sanitized, human copy — never surface the result `code` verbatim.
        setError('Não foi possível enviar sua resposta. Tente novamente.');
      }
    });
  }

  const submitDisabled = isPending || dismissPending;

  return (
    <div className="space-y-6" data-testid="nps-form">
      <div className="space-y-3">
        <Label id="nps-score-label" className="text-text-primary text-[15px]">
          Em uma escala de 0 a 10, qual a chance de você recomendar o sistema a uma colega?
        </Label>
        <div
          role="radiogroup"
          aria-labelledby="nps-score-label"
          className="flex flex-wrap gap-2"
          data-testid="nps-score-options"
        >
          {NPS_SCORES.map((value) => {
            const selected = score === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`Nota ${value}`}
                onClick={() => {
                  setScore(value);
                  setError(null);
                }}
                disabled={submitDisabled}
                data-testid={`nps-score-${value}`}
                className={cn(
                  'duration-fast flex h-10 w-10 items-center justify-center rounded-md border text-[15px] font-medium transition-colors',
                  'focus-visible:shadow-focus focus-visible:outline-none',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  selected
                    ? 'border-brand-500 bg-brand-500 text-text-inverse'
                    : 'border-border-strong text-text-primary hover:bg-surface-muted',
                )}
              >
                {value}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nps-feedback" className="text-text-primary text-[15px]">
          O que faria você dar nota mais alta?
        </Label>
        <Textarea
          id="nps-feedback"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          maxLength={FEEDBACK_MAX_LENGTH}
          disabled={submitDisabled}
          placeholder="Opcional"
          data-testid="nps-feedback"
        />
      </div>

      {error ? (
        <p className="text-danger-700 text-[13px]" role="alert" data-testid="nps-error">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        {onDismiss ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onDismiss}
            disabled={submitDisabled}
            data-testid="nps-dismiss"
          >
            Não responder agora
          </Button>
        ) : null}
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={submitDisabled || score === null}
          data-testid="nps-submit"
        >
          {isPending ? 'Enviando...' : 'Enviar'}
        </Button>
      </div>
    </div>
  );
}
