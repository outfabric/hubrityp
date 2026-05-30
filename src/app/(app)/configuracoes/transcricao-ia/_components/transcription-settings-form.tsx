'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { updateTranscriptionSettings } from '@/app/(app)/configuracoes/transcricao-ia/actions';
import type {
  TranscriptionSettingsView,
  UpdateTranscriptionSettingsInput,
} from '@/modules/ai-transcription';
// The runtime Zod schema is imported from the pure `lib/` module directly,
// NOT from the module barrel. The barrel re-exports the Server Action impls
// (which transitively pull `server-only` / `db/client` / `next/headers`), so a
// `'use client'` component importing a *runtime value* from it drags the entire
// server graph into the browser bundle and breaks the Turbopack build. Types
// above are erased at compile time and are safe to take from the barrel; this
// value import must come from the client-safe leaf. (`lib/settings-schemas`
// only imports `zod` and the pure domain enums.)
import { UpdateTranscriptionSettingsInputSchema } from '@/modules/ai-transcription/lib/settings-schemas';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Separator } from '@/shared/ui/separator';
import { Switch } from '@/shared/ui/switch';

// ---------------------------------------------------------------------------
// Static option metadata (microcopy + Sálvia glossary)
// ---------------------------------------------------------------------------

const TEMPLATE_OPTIONS = [
  { value: 'tcc', label: 'TCC' },
  { value: 'psicanalise', label: 'Psicanálise' },
  { value: 'sistemica', label: 'Sistêmica' },
  { value: 'aba', label: 'ABA' },
  { value: 'livre', label: 'Livre' },
] as const;

const SENSITIVITY_OPTIONS = [
  {
    value: 'low',
    label: 'Baixa',
    helper: 'Sinaliza apenas indicações explícitas de risco. Menos alertas, menos ruído.',
  },
  {
    value: 'medium',
    label: 'Média',
    helper: 'Equilíbrio entre cobertura e ruído. Recomendado para a maioria dos casos.',
  },
  {
    value: 'high',
    label: 'Alta',
    helper: 'Sinaliza indícios sutis de risco. Mais alertas, exige mais revisão.',
  },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TranscriptionSettingsFormProps {
  initial: TranscriptionSettingsView;
}

/**
 * Client form for editing the per-psychologist AI-transcription preferences.
 *
 * Design decisions:
 *   - D1: explicit save (a primary button), never auto-save.
 *   - D3: RadioGroup for risk sensitivity, with inline per-option explanations.
 *
 * Disabling guard: when the user turns `enabled` from on -> off, the submit is
 * intercepted and a confirmation `AlertDialog` is shown; the Server Action only
 * runs once the user confirms. Every other change saves directly.
 *
 * The submit payload is validated client-side via the same Zod schema the
 * Server Action parses (`UpdateTranscriptionSettingsInputSchema`), so the form
 * and the action stay in lockstep — but the action re-validates regardless;
 * client validation is convenience, not a trust boundary.
 */
export function TranscriptionSettingsForm({ initial }: TranscriptionSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Holds the validated payload while the disable-confirmation dialog is open.
  const [pendingValues, setPendingValues] = useState<UpdateTranscriptionSettingsInput | null>(null);

  const form = useForm<UpdateTranscriptionSettingsInput>({
    resolver: zodResolver(UpdateTranscriptionSettingsInputSchema),
    defaultValues: {
      enabled: initial.enabled,
      defaultTemplate: initial.defaultTemplate,
      riskDetectionSensitivity: initial.riskDetectionSensitivity,
      keepAudioHours: initial.keepAudioHours,
      keepTranscription: initial.keepTranscription,
    },
  });

  function persist(values: UpdateTranscriptionSettingsInput) {
    startTransition(async () => {
      const result = await updateTranscriptionSettings(values);

      if (result.ok) {
        toast.success('Configurações salvas');
        // Re-fetch the Server Component stats panel (and re-sync defaults).
        router.refresh();
        form.reset(values);
      } else if (result.code === 'INVALID_INPUT') {
        toast.error('Verifique os campos e tente novamente.');
      } else {
        toast.error('Algo deu errado. Tente novamente.');
      }
    });
  }

  function handleValidSubmit(values: UpdateTranscriptionSettingsInput) {
    // Disable guard: enabled true -> false requires explicit confirmation.
    if (initial.enabled && !values.enabled) {
      setPendingValues(values);
      setConfirmOpen(true);
      return;
    }
    persist(values);
  }

  function confirmDisable() {
    setConfirmOpen(false);
    if (pendingValues) {
      persist(pendingValues);
      setPendingValues(null);
    }
  }

  function cancelDisable() {
    setConfirmOpen(false);
    setPendingValues(null);
  }

  const enabled = form.watch('enabled');
  const defaultTemplate = form.watch('defaultTemplate');
  const riskSensitivity = form.watch('riskDetectionSensitivity');
  const keepTranscription = form.watch('keepTranscription');

  return (
    <>
      <Card data-testid="transcription-settings-card">
        <CardContent className="p-4 md:p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit(handleValidSubmit)();
            }}
            className="space-y-6"
            noValidate
            data-testid="transcription-settings-form"
          >
            {/* ---- Enable AI transcription ---- */}
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="enabled" className="text-[15px] font-normal">
                  Ativar Transcrição IA
                </Label>
                <p className="text-text-tertiary text-xs">
                  Quando ligada, novas sessões com termo de gravação assinado serão processadas
                  automaticamente.
                </p>
              </div>
              <Switch
                id="enabled"
                checked={enabled}
                onCheckedChange={(checked) =>
                  form.setValue('enabled', checked, { shouldDirty: true })
                }
                aria-label="Ativar Transcrição IA"
                data-testid="transcription-settings-enabled"
              />
            </div>

            <Separator />

            {/* ---- Default note template ---- */}
            <div className="space-y-2">
              <Label htmlFor="default-template" className="text-[15px] font-normal">
                Template padrão da nota
              </Label>
              <Select
                value={defaultTemplate}
                onValueChange={(value) =>
                  form.setValue(
                    'defaultTemplate',
                    value as UpdateTranscriptionSettingsInput['defaultTemplate'],
                    { shouldDirty: true },
                  )
                }
              >
                <SelectTrigger
                  id="default-template"
                  data-testid="transcription-settings-template"
                  className="max-w-xs"
                >
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-text-tertiary text-xs">Aplica-se apenas a novas transcrições.</p>
            </div>

            <Separator />

            {/* ---- Risk detection sensitivity (D3) ---- */}
            <fieldset className="space-y-3">
              <legend className="text-[15px] font-normal">
                Sensibilidade de detecção de risco
              </legend>
              <RadioGroup
                value={riskSensitivity}
                onValueChange={(value) =>
                  form.setValue(
                    'riskDetectionSensitivity',
                    value as UpdateTranscriptionSettingsInput['riskDetectionSensitivity'],
                    { shouldDirty: true },
                  )
                }
                data-testid="transcription-settings-sensitivity"
              >
                {SENSITIVITY_OPTIONS.map((opt) => (
                  <div key={opt.value} className="flex items-start gap-3">
                    <RadioGroupItem
                      id={`sensitivity-${opt.value}`}
                      value={opt.value}
                      className="mt-0.5"
                    />
                    <div className="space-y-0.5">
                      <Label
                        htmlFor={`sensitivity-${opt.value}`}
                        className="text-[15px] font-normal"
                      >
                        {opt.label}
                      </Label>
                      <p className="text-text-tertiary text-xs">{opt.helper}</p>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>

            <Separator />

            {/* ---- Audio retention (MVP-locked to 24h) ---- */}
            <div className="space-y-2">
              <Label htmlFor="keep-audio-hours" className="text-[15px] font-normal">
                Reter áudio por
              </Label>
              <Select value="24" disabled>
                <SelectTrigger
                  id="keep-audio-hours"
                  data-testid="transcription-settings-retention"
                  className="max-w-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">24 horas</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-text-tertiary text-xs">
                Configurações acima de 24h exigem registro adicional e ajuste do termo de
                consentimento. No momento, apenas 24h está disponível.
              </p>
            </div>

            <Separator />

            {/* ---- Keep textual transcription ---- */}
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="keep-transcription" className="text-[15px] font-normal">
                  Manter transcrição textual
                </Label>
                <p className="text-text-tertiary text-xs">
                  Por padrão, apenas a nota estruturada é mantida. Mantenha a transcrição apenas com
                  razão clínica documentada.
                </p>
              </div>
              <Switch
                id="keep-transcription"
                checked={keepTranscription}
                onCheckedChange={(checked) =>
                  form.setValue('keepTranscription', checked, { shouldDirty: true })
                }
                aria-label="Manter transcrição textual"
                data-testid="transcription-settings-keep-transcription"
              />
            </div>

            <Separator />

            {/* ---- Footer ---- */}
            <div className="flex justify-end">
              <Button type="submit" disabled={isPending} data-testid="transcription-settings-save">
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Salvando...
                  </>
                ) : (
                  'Salvar configurações'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ---- Disable-confirmation dialog ---- */}
      <AlertDialog open={confirmOpen} onOpenChange={(open) => !open && cancelDisable()}>
        <AlertDialogContent data-testid="transcription-disable-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar a Transcrição IA?</AlertDialogTitle>
            <AlertDialogDescription>
              Novas sessões não serão processadas. Transcrições em andamento concluirão normalmente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDisable} data-testid="transcription-disable-cancel">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDisable} data-testid="transcription-disable-confirm">
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
