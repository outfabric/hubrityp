'use client';

import { Check, Clock, Copy, ExternalLink, Loader2, Monitor } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import type {
  CreateScaleApplicationResult,
  ScaleDefinition,
  ScaleKey,
  SubmitScaleResponsesResult,
} from '@/modules/medical-records';
import { AVAILABLE_SCALES } from '@/modules/medical-records/lib/scales';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { ScaleApplicationForm } from './scale-application-form';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModalStep = 'select-scale' | 'select-mode' | 'in-session' | 'remote-link';

interface ScaleSelectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  /** Server action to create a scale application. */
  createScaleApplication: (input: {
    patientId: string;
    scaleKey: string;
    mode: 'in-session' | 'remote';
    expiresInHours?: number;
  }) => Promise<CreateScaleApplicationResult>;
  /** Server action to submit in-session responses. */
  submitScaleResponses: (input: {
    applicationId: string;
    responses: Record<string, number>;
  }) => Promise<SubmitScaleResponsesResult>;
  /** Called after a scale application is completed (in-session) or created (remote). */
  onCompleted: () => void;
}

// ---------------------------------------------------------------------------
// Expiration options for remote mode
// ---------------------------------------------------------------------------

const EXPIRATION_OPTIONS = [
  { value: '24', label: '24 horas' },
  { value: '48', label: '48 horas' },
  { value: '168', label: '7 dias' },
] as const;

// ---------------------------------------------------------------------------
// Error code -> friendly message mapping
// ---------------------------------------------------------------------------

function errorMessage(code: string): string {
  switch (code) {
    case 'INVALID_SCALE':
      return 'Escala invalida. Tente novamente.';
    case 'PATIENT_NOT_FOUND':
      return 'Paciente nao encontrado. Verifique e tente novamente.';
    case 'UNAUTHORIZED':
      return 'Sessao expirada. Faca login novamente.';
    default:
      return 'Erro inesperado. Tente novamente.';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Multi-step Dialog for applying a psychometric scale:
 *
 * Step 1 ("select-scale"): RadioGroup with 5 scale cards
 * Step 2 ("select-mode"): choose "Aplicar agora" vs "Enviar link"
 *   - For remote: expiration Select (24h / 48h / 7 dias)
 * After confirm:
 *   - In-session -> transitions to ScaleApplicationForm ("in-session" step)
 *   - Remote -> shows remote-link display ("remote-link" step)
 *
 * Closing/cancel resets all internal state.
 */
export function ScaleSelectModal({
  open,
  onOpenChange,
  patientId,
  createScaleApplication,
  submitScaleResponses,
  onCompleted,
}: ScaleSelectModalProps) {
  const [step, setStep] = useState<ModalStep>('select-scale');
  const [selectedScaleKey, setSelectedScaleKey] = useState<ScaleKey | ''>('');
  const [mode, setMode] = useState<'in-session' | 'remote'>('in-session');
  const [expiresInHours, setExpiresInHours] = useState('48');
  const [submitting, setSubmitting] = useState(false);

  // Set after createScaleApplication succeeds
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);

  // -- Reset all state when closing --
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setStep('select-scale');
        setSelectedScaleKey('');
        setMode('in-session');
        setExpiresInHours('48');
        setSubmitting(false);
        setApplicationId(null);
        setRemoteUrl(null);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  // -- Step 1 -> Step 2 --
  const handleNext = useCallback(() => {
    if (selectedScaleKey) {
      setStep('select-mode');
    }
  }, [selectedScaleKey]);

  // -- Step 2 -> Confirm (call server action) --
  const handleConfirm = useCallback(async () => {
    if (!selectedScaleKey) return;

    setSubmitting(true);
    try {
      const result = await createScaleApplication({
        patientId,
        scaleKey: selectedScaleKey,
        mode,
        expiresInHours: mode === 'remote' ? Number(expiresInHours) : undefined,
      });

      if (!result.ok) {
        toast.error(errorMessage(result.code));
        setSubmitting(false);
        return;
      }

      setApplicationId(result.id);

      if (mode === 'in-session') {
        setStep('in-session');
      } else {
        // Build the remote URL from the token
        const token = result.remoteToken;
        if (token) {
          const url = `${window.location.origin}/escala/${token}`;
          setRemoteUrl(url);
        }
        setStep('remote-link');
        // Refresh the parent tab since a new application was created
        onCompleted();
      }
    } catch {
      toast.error('Erro ao criar aplicacao de escala. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  }, [selectedScaleKey, patientId, mode, expiresInHours, createScaleApplication, onCompleted]);

  // -- Back button handler --
  const handleBack = useCallback(() => {
    if (step === 'select-mode') {
      setStep('select-scale');
    }
  }, [step]);

  // -- In-session form completed --
  const handleInSessionCompleted = useCallback(() => {
    onCompleted();
    handleOpenChange(false);
  }, [onCompleted, handleOpenChange]);

  // Resolve the selected scale definition for the in-session form
  const selectedScale: ScaleDefinition | undefined = selectedScaleKey
    ? AVAILABLE_SCALES.find((s) => s.key === selectedScaleKey)
    : undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={step === 'in-session' ? 'max-w-[640px]' : undefined}
        data-testid="scale-select-modal"
      >
        {step === 'select-scale' && (
          <ScaleSelectionStep
            selectedScaleKey={selectedScaleKey}
            onSelect={setSelectedScaleKey}
            onNext={handleNext}
            onCancel={() => handleOpenChange(false)}
          />
        )}

        {step === 'select-mode' && (
          <ModeSelectionStep
            scaleName={selectedScale?.label ?? ''}
            mode={mode}
            onModeChange={setMode}
            expiresInHours={expiresInHours}
            onExpiresChange={setExpiresInHours}
            submitting={submitting}
            onConfirm={() => void handleConfirm()}
            onBack={handleBack}
          />
        )}

        {step === 'in-session' && applicationId && selectedScale && (
          <InSessionStep
            scale={selectedScale}
            applicationId={applicationId}
            submitScaleResponses={submitScaleResponses}
            onCompleted={handleInSessionCompleted}
          />
        )}

        {step === 'remote-link' && (
          <RemoteLinkDisplay remoteUrl={remoteUrl} onClose={() => handleOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Scale Selection
// ---------------------------------------------------------------------------

interface ScaleSelectionStepProps {
  selectedScaleKey: ScaleKey | '';
  onSelect: (key: ScaleKey | '') => void;
  onNext: () => void;
  onCancel: () => void;
}

function ScaleSelectionStep({
  selectedScaleKey,
  onSelect,
  onNext,
  onCancel,
}: ScaleSelectionStepProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Selecione uma escala</DialogTitle>
        <DialogDescription>Escolha o instrumento psicometrico a ser aplicado.</DialogDescription>
      </DialogHeader>

      <RadioGroup
        value={selectedScaleKey}
        onValueChange={(value) => onSelect(value as ScaleKey)}
        className="grid gap-3"
        data-testid="scale-selection-radio-group"
      >
        {AVAILABLE_SCALES.map((scale) => {
          const isSelected = selectedScaleKey === scale.key;
          return (
            <Label
              key={scale.key}
              htmlFor={`scale-${scale.key}`}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                isSelected
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-border hover:border-border-strong'
              }`}
              data-testid={`scale-card-${scale.key}`}
            >
              <RadioGroupItem value={scale.key} id={`scale-${scale.key}`} className="mt-0.5" />
              <div className="flex-1">
                <span className="text-text-primary text-sm font-medium">{scale.label}</span>
                <p className="text-text-secondary mt-0.5 text-xs leading-relaxed">
                  {scale.description}
                </p>
                <p className="text-text-tertiary mt-1 flex items-center gap-1 text-xs">
                  <Clock className="h-3 w-3" aria-hidden="true" />~{scale.estimatedMinutes} min
                </p>
              </div>
            </Label>
          );
        })}
      </RadioGroup>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} data-testid="scale-select-cancel">
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={!selectedScaleKey}
          onClick={onNext}
          data-testid="scale-select-next"
        >
          Continuar
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Mode Selection
// ---------------------------------------------------------------------------

interface ModeSelectionStepProps {
  scaleName: string;
  mode: 'in-session' | 'remote';
  onModeChange: (mode: 'in-session' | 'remote') => void;
  expiresInHours: string;
  onExpiresChange: (value: string) => void;
  submitting: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

function ModeSelectionStep({
  scaleName,
  mode,
  onModeChange,
  expiresInHours,
  onExpiresChange,
  submitting,
  onConfirm,
  onBack,
}: ModeSelectionStepProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Como aplicar?</DialogTitle>
        <DialogDescription>{scaleName} — escolha o modo de aplicacao.</DialogDescription>
      </DialogHeader>

      <RadioGroup
        value={mode}
        onValueChange={(v) => onModeChange(v as 'in-session' | 'remote')}
        className="grid gap-3"
        data-testid="mode-selection-radio-group"
      >
        <Label
          htmlFor="mode-in-session"
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
            mode === 'in-session'
              ? 'border-brand-500 bg-brand-50'
              : 'border-border hover:border-border-strong'
          }`}
          data-testid="mode-in-session-card"
        >
          <RadioGroupItem value="in-session" id="mode-in-session" className="mt-0.5" />
          <div className="flex-1">
            <span className="text-text-primary flex items-center gap-2 text-sm font-medium">
              <Monitor className="h-4 w-4" aria-hidden="true" />
              Aplicar agora (na sessao)
            </span>
            <p className="text-text-secondary mt-0.5 text-xs">
              Preencha as respostas junto ao paciente durante a consulta.
            </p>
          </div>
        </Label>

        <Label
          htmlFor="mode-remote"
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
            mode === 'remote'
              ? 'border-brand-500 bg-brand-50'
              : 'border-border hover:border-border-strong'
          }`}
          data-testid="mode-remote-card"
        >
          <RadioGroupItem value="remote" id="mode-remote" className="mt-0.5" />
          <div className="flex-1">
            <span className="text-text-primary flex items-center gap-2 text-sm font-medium">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Enviar link ao paciente
            </span>
            <p className="text-text-secondary mt-0.5 text-xs">
              Gere um link para o paciente responder remotamente.
            </p>
          </div>
        </Label>
      </RadioGroup>

      {/* Expiration select — only shown for remote mode */}
      {mode === 'remote' && (
        <div className="space-y-2">
          <Label htmlFor="expiration-select" className="text-text-primary text-sm font-medium">
            Validade do link
          </Label>
          <Select value={expiresInHours} onValueChange={onExpiresChange}>
            <SelectTrigger id="expiration-select" data-testid="expiration-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPIRATION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onBack} data-testid="mode-select-back">
          Voltar
        </Button>
        <Button
          type="button"
          disabled={submitting}
          onClick={onConfirm}
          data-testid="mode-select-confirm"
        >
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Confirmar
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step: In-Session (delegates to ScaleApplicationForm)
// ---------------------------------------------------------------------------

interface InSessionStepProps {
  scale: ScaleDefinition;
  applicationId: string;
  submitScaleResponses: (input: {
    applicationId: string;
    responses: Record<string, number>;
  }) => Promise<SubmitScaleResponsesResult>;
  onCompleted: () => void;
}

function InSessionStep({
  scale,
  applicationId,
  submitScaleResponses,
  onCompleted,
}: InSessionStepProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{scale.label}</DialogTitle>
        <DialogDescription>Preencha as respostas abaixo junto ao paciente.</DialogDescription>
      </DialogHeader>

      <div className="max-h-[60vh] overflow-y-auto">
        <ScaleApplicationForm
          scale={scale}
          applicationId={applicationId}
          submitScaleResponses={submitScaleResponses}
          onCompleted={onCompleted}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Step: Remote Link Display (11.3)
// ---------------------------------------------------------------------------

interface RemoteLinkDisplayProps {
  remoteUrl: string | null;
  onClose: () => void;
}

/**
 * Displays the generated remote link with copy-to-clipboard functionality.
 *
 * Sub-component of ScaleSelectModal (11.3). Shows:
 * - Read-only URL in a styled input
 * - "Copiar link" button (copies to clipboard + toast)
 * - Muted note about future WhatsApp integration
 */
function RemoteLinkDisplay({ remoteUrl, onClose }: RemoteLinkDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!remoteUrl) return;

    try {
      await navigator.clipboard.writeText(remoteUrl);
      setCopied(true);
      toast.success('Link copiado para a area de transferencia.');
      // Reset the check icon after 2 seconds
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Nao foi possivel copiar. Selecione e copie manualmente.');
    }
  }, [remoteUrl]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Link gerado</DialogTitle>
        <DialogDescription>
          Compartilhe este link com o paciente para que responda a escala remotamente.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {/* URL display + copy button */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={remoteUrl ?? ''}
            className="border-border bg-surface-sunken text-text-primary flex-1 truncate rounded-md border px-3 py-2 text-sm"
            data-testid="remote-link-input"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleCopy()}
            data-testid="remote-link-copy-button"
          >
            {copied ? (
              <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
            ) : (
              <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {copied ? 'Copiado' : 'Copiar link'}
          </Button>
        </div>

        {/* Future feature note */}
        <p className="text-text-tertiary text-xs">Enviar por WhatsApp (em breve)</p>
      </div>

      <DialogFooter>
        <Button type="button" onClick={onClose} data-testid="remote-link-close">
          Fechar
        </Button>
      </DialogFooter>
    </>
  );
}
