'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { Loader2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import type {
  DiscardTranscriptionResult,
  GeneratedNote,
  SaveTranscriptionToProntuarioResult,
  TranscriptionId,
  UpdateTranscriptionDraftResult,
} from '@/modules/ai-transcription';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';

// ---------------------------------------------------------------------------
// Server Action prop types (dependency injection — same pattern as
// AudioUploadSheet). The page wires the `'use server'` wrappers in; the
// component stays unit-testable with plain mock functions.
// ---------------------------------------------------------------------------

type UpdateDraftFn = (input: {
  transcriptionId: string;
  generatedNote: GeneratedNote;
}) => Promise<UpdateTranscriptionDraftResult>;

type SaveToProntuarioFn = (input: {
  transcriptionId: string;
  reviewedChecked: true;
}) => Promise<SaveTranscriptionToProntuarioResult>;

type DiscardFn = (input: { transcriptionId: string }) => Promise<DiscardTranscriptionResult>;

export interface TranscriptionReviewFormProps {
  transcriptionId: TranscriptionId;
  /** Parsed note, or `null` when the stored JSONB drifted from the schema. */
  initialNote: GeneratedNote | null;
  /** Working URL of the new-evolution editor to redirect to after discard. */
  discardRedirectHref: string;
  /**
   * Base prontuário path for the patient (e.g. `/pacientes/<id>/prontuario`).
   * After a successful save, we redirect to the created evolution under it.
   */
  prontuarioHref: string;
  updateDraftAction: UpdateDraftFn;
  saveToProntuarioAction: SaveToProntuarioFn;
  discardAction: DiscardFn;
}

// ---------------------------------------------------------------------------
// Form schema
//
// Array fields of the note are edited as a single multiline textarea (one item
// per line) — simpler than dynamic field arrays and matches the "TextArea per
// array field" requirement. We convert to/from the canonical `GeneratedNote`
// shape on save. All fields are optional strings: an empty note is a valid
// (if unhelpful) draft, and the server re-validates with `GeneratedNoteSchema`.
// ---------------------------------------------------------------------------

const reviewFormSchema = z.object({
  humorInicial: z.string(),
  humorFinal: z.string(),
  pauta: z.string(),
  conteudoTrabalhado: z.string(),
  tarefaCasa: z.string(),
  palavrasRisco: z.string(),
  observacoesExtras: z.string(),
});

type ReviewFormValues = z.infer<typeof reviewFormSchema>;

const AUTO_SAVE_INTERVAL_MS = 10_000;
const ON_BLUR_DEBOUNCE_MS = 800;
const DISCARD_CONFIRMATION_WORD = 'DESCARTAR';

// ---------------------------------------------------------------------------
// Conversions between the form's flat string shape and `GeneratedNote`.
// ---------------------------------------------------------------------------

/** Splits a multiline textarea value into a trimmed, non-empty string list. */
function linesToArray(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Joins a string list into one item-per-line textarea value. */
function arrayToLines(items: string[]): string {
  return items.join('\n');
}

/** Maps a single nullable text field: empty string ⇄ `null`. */
function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function noteToFormValues(note: GeneratedNote | null): ReviewFormValues {
  return {
    humorInicial: note?.humorInicial ?? '',
    humorFinal: note?.humorFinal ?? '',
    pauta: arrayToLines(note?.pauta ?? []),
    conteudoTrabalhado: arrayToLines(note?.conteudoTrabalhado ?? []),
    tarefaCasa: arrayToLines(note?.tarefaCasa ?? []),
    palavrasRisco: arrayToLines(note?.palavrasRisco ?? []),
    observacoesExtras: note?.observacoesExtras ?? '',
  };
}

function formValuesToNote(values: ReviewFormValues): GeneratedNote {
  return {
    schemaVersion: 1,
    humorInicial: emptyToNull(values.humorInicial),
    humorFinal: emptyToNull(values.humorFinal),
    pauta: linesToArray(values.pauta),
    conteudoTrabalhado: linesToArray(values.conteudoTrabalhado),
    tarefaCasa: linesToArray(values.tarefaCasa),
    palavrasRisco: linesToArray(values.palavrasRisco),
    observacoesExtras: emptyToNull(values.observacoesExtras),
  };
}

// ---------------------------------------------------------------------------
// Field descriptors (single-line vs. multiline array fields).
// ---------------------------------------------------------------------------

const TEXTAREA_FIELDS: ReadonlyArray<{
  name: keyof ReviewFormValues;
  label: string;
  helper?: string;
}> = [
  { name: 'pauta', label: 'Pauta', helper: 'Um item por linha.' },
  { name: 'conteudoTrabalhado', label: 'Conteúdo trabalhado', helper: 'Um item por linha.' },
  { name: 'tarefaCasa', label: 'Tarefa de casa', helper: 'Um item por linha.' },
  { name: 'palavrasRisco', label: 'Palavras de risco', helper: 'Um item por linha.' },
  { name: 'observacoesExtras', label: 'Observações extras' },
];

const SINGLE_FIELDS: ReadonlyArray<{ name: keyof ReviewFormValues; label: string }> = [
  { name: 'humorInicial', label: 'Humor inicial' },
  { name: 'humorFinal', label: 'Humor final' },
];

// ---------------------------------------------------------------------------
// pt-BR messages for save/discard error codes.
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'Sua sessão expirou. Faça login novamente.',
  NOT_EDITABLE: 'Esta nota não pode mais ser editada.',
  MUST_REVIEW: 'Confirme que revisou a nota antes de salvar.',
  NOT_FOUND: 'Transcrição não encontrada.',
  ALREADY_SAVED: 'Esta nota já foi salva no prontuário.',
  ALREADY_REVIEWED: 'Esta nota já foi revisada.',
  SAVE_FAILED: 'Não foi possível salvar no prontuário. Tente novamente.',
  INVALID_INPUT: 'Os dados informados são inválidos.',
};

function messageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? 'Algo deu errado. Tente novamente.';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TranscriptionReviewForm({
  transcriptionId,
  initialNote,
  discardRedirectHref,
  prontuarioHref,
  updateDraftAction,
  saveToProntuarioAction,
  discardAction,
}: TranscriptionReviewFormProps) {
  const router = useRouter();

  const { register, getValues } = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewFormSchema),
    defaultValues: noteToFormValues(initialNote),
  });

  const [reviewed, setReviewed] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState('');

  // Auto-save is enabled until the user clicks "Editar mais" (which parks the
  // form so they can keep typing without periodic writes).
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  // -------------------------------------------------------------------------
  // Draft save (shared by interval + on-blur). `isSaving` doubles as the
  // concurrency guard: a second call while a save is in flight is ignored.
  // -------------------------------------------------------------------------
  const saveDraft = useCallback(async () => {
    let started = false;
    setIsSaving((current) => {
      if (current) {
        return current;
      }
      started = true;
      return true;
    });
    if (!started) {
      return;
    }
    try {
      const generatedNote = formValuesToNote(getValues());
      const result = await updateDraftAction({ transcriptionId, generatedNote });
      if (result.ok) {
        setSavedAt(result.savedAt);
      } else {
        toast.error(messageFor(result.code));
      }
    } catch {
      toast.error('Não foi possível salvar o rascunho.');
    } finally {
      setIsSaving(false);
    }
  }, [getValues, transcriptionId, updateDraftAction]);

  // -------------------------------------------------------------------------
  // Auto-save interval (every 10s) — re-armed whenever it is (re-)enabled.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!autoSaveEnabled) {
      return;
    }
    const interval = setInterval(() => {
      void saveDraft();
    }, AUTO_SAVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [autoSaveEnabled, saveDraft]);

  // On-blur save, debounced. The pending timer is captured per-effect so it is
  // cleared on the next blur or on unmount without reading a ref during render.
  const [blurTick, setBlurTick] = useState(0);
  useEffect(() => {
    if (!autoSaveEnabled || blurTick === 0) {
      return;
    }
    const timer = setTimeout(() => {
      void saveDraft();
    }, ON_BLUR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [autoSaveEnabled, blurTick, saveDraft]);

  const handleFieldBlur = useCallback(() => {
    // Bump a counter to (re)start the debounce effect above.
    setBlurTick((tick) => tick + 1);
  }, []);

  const handleEditMore = useCallback(() => {
    setAutoSaveEnabled(false);
    toast.info('Salvamento automático pausado. Suas edições não serão salvas até você salvar.');
  }, []);

  // -------------------------------------------------------------------------
  // Save to prontuário.
  // -------------------------------------------------------------------------
  const handleSave = useCallback(async () => {
    if (!reviewed || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    try {
      // Persist the latest edits before promoting the draft to a real evolution.
      await saveDraft();
      const result = await saveToProntuarioAction({ transcriptionId, reviewedChecked: true });
      if (result.ok) {
        toast.success('Nota salva no prontuário.');
        router.push(`${prontuarioHref}/evolucoes/${result.evolutionId}`);
      } else {
        toast.error(messageFor(result.code));
      }
    } catch {
      toast.error('Não foi possível salvar no prontuário.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    prontuarioHref,
    reviewed,
    router,
    saveDraft,
    saveToProntuarioAction,
    transcriptionId,
  ]);

  // -------------------------------------------------------------------------
  // Discard.
  // -------------------------------------------------------------------------
  const handleDiscardConfirm = useCallback(async () => {
    if (discardConfirm !== DISCARD_CONFIRMATION_WORD || isDiscarding) {
      return;
    }
    setIsDiscarding(true);
    try {
      const result = await discardAction({ transcriptionId });
      if (result.ok) {
        toast.success('Nota descartada. Escreva a evolução manualmente.');
        router.push(discardRedirectHref);
      } else {
        toast.error(messageFor(result.code));
        setIsDiscarding(false);
      }
    } catch {
      toast.error('Não foi possível descartar a nota.');
      setIsDiscarding(false);
    }
  }, [discardAction, discardConfirm, discardRedirectHref, isDiscarding, router, transcriptionId]);

  const savedLabel = savedAt ? `Salvo às ${format(savedAt, 'HH:mm')}` : null;

  return (
    <div className="space-y-6">
      <form className="space-y-5" data-testid="transcription-review-form" noValidate>
        {SINGLE_FIELDS.map((field) => (
          <div key={field.name} className="space-y-2">
            <Label htmlFor={`field-${field.name}`}>{field.label}</Label>
            <Input
              id={`field-${field.name}`}
              data-testid={`field-${field.name}`}
              {...register(field.name, { onBlur: handleFieldBlur })}
            />
          </div>
        ))}

        {TEXTAREA_FIELDS.map((field) => (
          <div key={field.name} className="space-y-2">
            <Label htmlFor={`field-${field.name}`}>{field.label}</Label>
            <Textarea
              id={`field-${field.name}`}
              data-testid={`field-${field.name}`}
              rows={4}
              aria-describedby={field.helper ? `helper-${field.name}` : undefined}
              {...register(field.name, { onBlur: handleFieldBlur })}
            />
            {field.helper && (
              <p id={`helper-${field.name}`} className="text-text-tertiary text-[12px]">
                {field.helper}
              </p>
            )}
          </div>
        ))}
      </form>

      {/* Auto-save indicator — polite live region. */}
      <p
        className="text-text-tertiary text-[13px]"
        data-testid="autosave-indicator"
        aria-live="polite"
      >
        {isSaving ? 'Salvando…' : savedLabel}
      </p>

      {/* Review checkbox — gates the primary action. */}
      <div className="flex items-start gap-3">
        <Checkbox
          id="reviewed-checkbox"
          data-testid="reviewed-checkbox"
          checked={reviewed}
          onCheckedChange={(value) => setReviewed(value === true)}
        />
        <Label htmlFor="reviewed-checkbox" className="text-[14px] leading-snug font-normal">
          Revisei a nota e confirmo que reflete a sessão.
        </Label>
      </div>

      {/* Action row. */}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          data-testid="save-to-prontuario-btn"
          disabled={!reviewed || isSubmitting}
          onClick={() => void handleSave()}
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="h-4 w-4" aria-hidden="true" />
          )}
          Salvar no prontuário
        </Button>

        <Button
          type="button"
          variant="secondary"
          data-testid="edit-more-btn"
          onClick={handleEditMore}
          disabled={!autoSaveEnabled}
        >
          Editar mais
        </Button>

        <AlertDialog
          open={discardOpen}
          onOpenChange={(open) => {
            setDiscardOpen(open);
            if (!open) {
              setDiscardConfirm('');
            }
          }}
        >
          <Button
            type="button"
            variant="destructive"
            data-testid="discard-btn"
            onClick={() => setDiscardOpen(true)}
          >
            Descartar e escrever manualmente
          </Button>
          <AlertDialogContent data-testid="discard-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>Descartar nota gerada por IA?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação não pode ser desfeita. A nota gerada será descartada e você escreverá a
                evolução manualmente. Digite <strong>{DISCARD_CONFIRMATION_WORD}</strong> para
                confirmar.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-2">
              <Label htmlFor="discard-confirm-input">Confirmação</Label>
              <Input
                id="discard-confirm-input"
                data-testid="discard-confirm-input"
                value={discardConfirm}
                autoComplete="off"
                onChange={(event) => setDiscardConfirm(event.target.value)}
                placeholder={DISCARD_CONFIRMATION_WORD}
              />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel data-testid="discard-cancel-btn">Cancelar</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                data-testid="discard-confirm-btn"
                disabled={discardConfirm !== DISCARD_CONFIRMATION_WORD || isDiscarding}
                onClick={() => void handleDiscardConfirm()}
              >
                {isDiscarding && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Descartar definitivamente
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
