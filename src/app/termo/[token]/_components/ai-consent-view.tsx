'use client';

import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useCallback, useState, useTransition } from 'react';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiConsentSection {
  heading: string;
  body: string;
}

type SignAiConsentAction = (
  token: string,
) => Promise<{ ok: true } | { ok: false; error: string; message?: string }>;

interface AiConsentViewProps {
  token: string;
  title: string;
  sections: AiConsentSection[];
  psychologistName: string;
  psychologistCrp: string;
  patientName: string;
  signAction: SignAiConsentAction;
}

type FormState = { status: 'idle' } | { status: 'success' } | { status: 'error'; message: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client component for the public AI consent signing page.
 *
 * Renders the structured consent template sections from the JSONB snapshot.
 * Includes an acceptance checkbox, a name confirmation input (informational,
 * NOT used for auth), and a submit button.
 *
 * No `dangerouslySetInnerHTML` is used -- all text is rendered via React
 * text nodes.
 */
export function AiConsentView({
  token,
  title,
  sections,
  psychologistName,
  psychologistCrp,
  patientName,
  signAction,
}: AiConsentViewProps) {
  const [accepted, setAccepted] = useState(false);
  const [confirmedName, setConfirmedName] = useState('');
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

  // Success state
  if (formState.status === 'success') {
    return (
      <div
        className="flex flex-col items-center gap-3 py-8 text-center"
        data-testid="ai-consent-success"
      >
        <CheckCircle2 className="text-success-500 h-12 w-12" aria-hidden="true" />
        <h3 className="text-text-primary text-lg leading-tight font-semibold">
          Termo assinado com sucesso
        </h3>
        <p className="text-text-secondary text-[13px]">
          O consentimento para gravacao e transcricao por IA foi registrado.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="ai-consent-view">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-text-primary text-[22px] leading-tight font-semibold">{title}</h1>
        <p className="text-text-secondary mt-2 text-[15px]">
          Psicologo(a): {psychologistName} — CRP {psychologistCrp}
        </p>
      </div>

      {/* Template sections */}
      <Card>
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col gap-6">
            {sections.map((section) => (
              <div key={section.heading} data-testid="ai-consent-section">
                <h2 className="text-text-primary mb-2 text-[17px] font-semibold">
                  {section.heading}
                </h2>
                <p className="text-text-primary text-[15px] leading-[1.65] font-normal whitespace-pre-wrap">
                  {section.body}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Signing form */}
      <div className="flex flex-col gap-4" data-testid="ai-consent-sign-form">
        {/* Error feedback */}
        {formState.status === 'error' && (
          <div className="flex items-center gap-2" role="alert">
            <AlertCircle className="text-danger-500 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="text-danger-700 text-sm">{formState.message}</p>
          </div>
        )}

        {/* Name confirmation (informational, NOT auth) */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-consent-name" className="text-[15px] font-normal">
            Confirme seu nome completo
          </Label>
          <Input
            id="ai-consent-name"
            type="text"
            value={confirmedName}
            onChange={(e) => setConfirmedName(e.target.value)}
            placeholder={patientName}
            data-testid="ai-consent-name-input"
            autoComplete="name"
          />
        </div>

        {/* Acceptance checkbox */}
        <div className="flex items-start gap-3">
          <Checkbox
            id="ai-consent-accept"
            checked={accepted}
            onCheckedChange={(checked) => setAccepted(checked === true)}
            data-testid="ai-consent-checkbox"
          />
          <Label
            htmlFor="ai-consent-accept"
            className="cursor-pointer text-[15px] leading-snug font-normal"
          >
            Eu li e concordo com os termos acima
          </Label>
        </div>

        {/* Submit */}
        <Button
          type="button"
          onClick={handleSign}
          disabled={!accepted || isPending}
          aria-label="Assinar termo de consentimento para IA"
          data-testid="ai-consent-sign-button"
          className="w-full sm:w-auto"
        >
          {isPending ? 'Assinando...' : 'Assinar'}
        </Button>
      </div>
    </div>
  );
}
