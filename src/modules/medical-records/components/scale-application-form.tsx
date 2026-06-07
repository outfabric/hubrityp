'use client';

import { CheckCircle2, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import type {
  ClassificationResult,
  ScaleDefinition,
  SubmitScaleResponsesResult,
} from '@/modules/medical-records';
import { severityToBadgeVariant } from '@/modules/medical-records/lib/scales/severity-tokens';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScaleApplicationFormProps {
  /** The scale definition (questions, scoring, classification). */
  scale: ScaleDefinition;
  /** The application ID returned by createScaleApplication. */
  applicationId: string;
  /** Server action to submit responses. */
  submitScaleResponses: (input: {
    applicationId: string;
    responses: Record<string, number>;
  }) => Promise<SubmitScaleResponsesResult>;
  /** Called after successful submission — triggers parent data refresh. */
  onCompleted: () => void;
}

type FormState =
  | { status: 'answering' }
  | { status: 'submitting' }
  | {
      status: 'completed';
      totalScore: number | null;
      classification: ClassificationResult;
    }
  | { status: 'error'; message: string };

// ---------------------------------------------------------------------------
// WHOQOL-Bref domain labels
// ---------------------------------------------------------------------------

const DOMAIN_LABELS: Record<string, string> = {
  physical: 'Físico',
  psychological: 'Psicológico',
  social: 'Relações Sociais',
  environmental: 'Meio Ambiente',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * In-session scale application form.
 *
 * Renders all questions as RadioGroups. The submit button ("Salvar no
 * prontuario") is disabled until every question has been answered.
 *
 * After successful submission, shows the result: total score + classification
 * Badge (colored by severity via the section-10 severity-tokens mapping).
 *
 * For WHOQOL-Bref (severity === 'domains', totalScore === null), the result
 * shows 4 domain values instead of a single score.
 *
 * Design system alignment:
 * - Each question in a Card
 * - RadioGroup with accessible labels, keyboard nav
 * - Primary button with loading state
 * - Result uses Badge with severity color mapping
 */
export function ScaleApplicationForm({
  scale,
  applicationId,
  submitScaleResponses,
  onCompleted,
}: ScaleApplicationFormProps) {
  const [responses, setResponses] = useState<Record<string, number>>({});
  const [formState, setFormState] = useState<FormState>({ status: 'answering' });

  const allAnswered = scale.questions.length > 0 && scale.questions.every((q) => q.id in responses);

  const handleOptionChange = useCallback((questionId: string, value: string) => {
    setResponses((prev) => ({ ...prev, [questionId]: Number(value) }));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!allAnswered) return;

    setFormState({ status: 'submitting' });

    try {
      const result = await submitScaleResponses({
        applicationId,
        responses,
      });

      if (!result.ok) {
        if (result.code === 'ALREADY_COMPLETED') {
          toast.info('Esta escala já foi respondida anteriormente.');
          onCompleted();
          return;
        }
        setFormState({
          status: 'error',
          message: 'Erro ao salvar respostas. Tente novamente.',
        });
        return;
      }

      setFormState({
        status: 'completed',
        totalScore: result.totalScore,
        classification: result.classification,
      });
    } catch {
      setFormState({
        status: 'error',
        message: 'Erro de conexão. Tente novamente.',
      });
    }
  }, [allAnswered, applicationId, responses, submitScaleResponses, onCompleted]);

  // -- Completed result display --
  if (formState.status === 'completed') {
    return (
      <ScaleResultDisplay
        totalScore={formState.totalScore}
        classification={formState.classification}
        scaleName={scale.label}
        onDone={onCompleted}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="scale-application-form">
      {/* Error feedback */}
      {formState.status === 'error' && (
        <div role="alert" aria-live="assertive" data-testid="scale-form-error">
          <p className="text-danger-700 text-sm">{formState.message}</p>
        </div>
      )}

      {/* Questions */}
      {scale.questions.map((question, index) => (
        <Card key={question.id}>
          <CardContent className="p-4">
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

      {/* Submit button */}
      <Button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!allAnswered || formState.status === 'submitting'}
        aria-label="Salvar no prontuário"
        data-testid="scale-form-submit"
        className="w-full"
      >
        {formState.status === 'submitting' ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            Salvando...
          </>
        ) : (
          'Salvar no prontuário'
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result display after submission
// ---------------------------------------------------------------------------

interface ScaleResultDisplayProps {
  totalScore: number | null;
  classification: ClassificationResult;
  scaleName: string;
  onDone: () => void;
}

/**
 * Shows the score + classification after a successful in-session submission.
 *
 * For most scales: "Pontuacao: X" + classification Badge colored by severity.
 * For WHOQOL-Bref (severity === 'domains'): shows 4 domain values.
 */
function ScaleResultDisplay({
  totalScore,
  classification,
  scaleName,
  onDone,
}: ScaleResultDisplayProps) {
  const isWhoqol = classification.severity === 'domains';
  const badgeVariant = severityToBadgeVariant(classification.severity);

  // Parse WHOQOL-Bref domain scores from the JSON-stringified label
  let domainScores: Record<string, number> | null = null;
  if (isWhoqol) {
    try {
      domainScores = JSON.parse(classification.label) as Record<string, number>;
    } catch {
      // Defensive: if parse fails, show raw label
      domainScores = null;
    }
  }

  return (
    <div
      className="flex flex-col items-center gap-4 py-4 text-center"
      role="status"
      aria-live="polite"
      data-testid="scale-result-display"
    >
      <CheckCircle2 className="text-success-500 h-10 w-10" aria-hidden="true" />
      <h3 className="text-text-primary text-lg font-semibold">Escala salva no prontuário</h3>
      <p className="text-text-secondary text-sm">{scaleName}</p>

      {isWhoqol && domainScores ? (
        <div className="grid w-full max-w-xs grid-cols-2 gap-2" data-testid="whoqol-domain-scores">
          {Object.entries(domainScores).map(([key, value]) => (
            <div key={key} className="bg-surface-muted flex flex-col items-center rounded-lg p-3">
              <span className="text-text-secondary text-xs">{DOMAIN_LABELS[key] ?? key}</span>
              <span className="text-text-primary text-lg font-semibold">{value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          {totalScore !== null && (
            <p className="text-text-primary text-2xl font-bold" data-testid="scale-total-score">
              {totalScore}
            </p>
          )}
          <Badge variant={badgeVariant} data-testid="scale-classification-badge">
            {classification.label}
          </Badge>
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        onClick={onDone}
        data-testid="scale-result-done"
        className="mt-2"
      >
        Fechar
      </Button>
    </div>
  );
}
