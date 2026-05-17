'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';

import type { ScaleQuestion } from '../lib/scales/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScalePublicFormProps {
  questions: ScaleQuestion[];
  token: string;
}

type FormState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success' }
  | { status: 'error'; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client Component for the public patient-facing scale questionnaire.
 *
 * All questions are rendered at once (scrollable), each with a shadcn
 * RadioGroup. The submit button is disabled until every question has been
 * answered. On submit, POSTs to `/api/scales/${token}` with `{ responses }`.
 *
 * Design system alignment:
 *   - Each question in a Card with body text
 *   - RadioGroup with options displayed horizontally on desktop, stacked on mobile
 *   - Submit button: full-width on mobile, primary variant, loading state
 *   - Success: CheckCircle2 icon, success message (no score/classification)
 *   - Accessibility: labels per question, keyboard nav, aria-live on result
 */
export function ScalePublicForm({ questions, token }: ScalePublicFormProps) {
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [formState, setFormState] = useState<FormState>({ status: 'idle' });

  const allAnswered = questions.length > 0 && questions.every((q) => q.id in responses);

  const handleOptionChange = useCallback((questionId: string, value: string) => {
    setResponses((prev) => ({ ...prev, [questionId]: Number(value) }));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!allAnswered) return;

    setFormState({ status: 'submitting' });

    fetch(`/api/scales/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ responses }),
    })
      .then(async (res) => {
        const data = (await res.json()) as { ok?: boolean };

        if (res.ok && data.ok) {
          setFormState({ status: 'success' });
        } else {
          setFormState({
            status: 'error',
            message: 'Nao foi possivel enviar suas respostas. Tente novamente.',
          });
        }
      })
      .catch(() => {
        setFormState({
          status: 'error',
          message: 'Erro de conexao. Verifique sua internet e tente novamente.',
        });
      });
  }, [allAnswered, token, responses]);

  // Success state
  if (formState.status === 'success') {
    return (
      <div
        className="flex flex-col items-center gap-3 py-8 text-center"
        role="status"
        aria-live="polite"
        data-testid="scale-submit-success"
      >
        <CheckCircle2 className="text-success-500 h-12 w-12" aria-hidden="true" />
        <h2 className="text-text-primary text-lg leading-tight font-semibold">Obrigado!</h2>
        <p className="text-text-secondary text-[15px]">
          Suas respostas foram enviadas ao seu psicologo.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="scale-public-form">
      {/* Error feedback */}
      {formState.status === 'error' && (
        <div role="alert" aria-live="assertive" data-testid="scale-submit-error">
          <p className="text-danger-700 text-sm">{formState.message}</p>
        </div>
      )}

      {/* Questions */}
      {questions.map((question, index) => (
        <Card key={question.id}>
          <CardContent className="p-4 md:p-6">
            <fieldset>
              <legend className="text-text-primary mb-3 text-[15px] leading-snug font-medium">
                {index + 1}. {question.prompt}
              </legend>
              <RadioGroup
                value={responses[question.id] !== undefined ? String(responses[question.id]) : ''}
                onValueChange={(value) => handleOptionChange(question.id, value)}
                aria-label={question.prompt}
                data-testid={`scale-question-${question.id}`}
              >
                {question.options.map((option) => {
                  const optionId = `${question.id}-${option.value}`;
                  return (
                    <div key={optionId} className="flex items-center gap-3">
                      <RadioGroupItem value={String(option.value)} id={optionId} />
                      <Label
                        htmlFor={optionId}
                        className="cursor-pointer text-[14px] leading-snug font-normal"
                      >
                        {option.label}
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>
            </fieldset>
          </CardContent>
        </Card>
      ))}

      {/* Submit button — full-width on mobile */}
      <Button
        type="button"
        size="lg"
        onClick={handleSubmit}
        disabled={!allAnswered || formState.status === 'submitting'}
        aria-label="Enviar respostas"
        data-testid="scale-submit-button"
        className="w-full"
      >
        {formState.status === 'submitting' ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Enviando...
          </>
        ) : (
          'Enviar respostas'
        )}
      </Button>
    </div>
  );
}
