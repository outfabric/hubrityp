'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { Anamnesis } from '@/shared/db/schema/patients/tables';
import { cn } from '@/shared/lib/utils';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import type { UpsertAnamnesisInput } from '../lib/anamnesis-input-schema';
import { useAutoSave, type AutoSaveStatus } from '../lib/use-auto-save';
import type { UpsertAnamnesisResult } from '../server/upsert-anamnesis';

import { TiptapEditor } from './tiptap-editor';

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------

interface SectionDefinition {
  /** Key matching the DB column / schema field. */
  key: keyof Pick<
    UpsertAnamnesisInput,
    | 'chiefComplaint'
    | 'historyPresentIllness'
    | 'familyHistory'
    | 'educationalProfessional'
    | 'physicalHealth'
    | 'priorTherapy'
    | 'initialHypothesis'
    | 'treatmentPlan'
  >;
  label: string;
  placeholder: string;
}

const SECTIONS: SectionDefinition[] = [
  {
    key: 'chiefComplaint',
    label: 'Queixa Principal',
    placeholder: 'Descreva a queixa principal do paciente...',
  },
  {
    key: 'historyPresentIllness',
    label: 'Historia da Queixa',
    placeholder: 'Descreva a historia da queixa atual...',
  },
  {
    key: 'familyHistory',
    label: 'Historia Familiar',
    placeholder: 'Descreva a historia familiar relevante...',
  },
  {
    key: 'educationalProfessional',
    label: 'Escolar/Profissional',
    placeholder: 'Descreva o historico escolar ou profissional...',
  },
  {
    key: 'physicalHealth',
    label: 'Saude Fisica',
    placeholder: 'Descreva o estado de saude fisica...',
  },
  {
    key: 'priorTherapy',
    label: 'Historico Psicoterapeutico',
    placeholder: 'Descreva experiencias anteriores com terapia...',
  },
  {
    key: 'initialHypothesis',
    label: 'Hipoteses Diagnosticas',
    placeholder: 'Descreva as hipoteses diagnosticas iniciais...',
  },
  {
    key: 'treatmentPlan',
    label: 'Plano Terapeutico',
    placeholder: 'Descreva o plano terapeutico proposto...',
  },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AnamnesisTabProps {
  patientId: string;
  initialAnamnesis: Anamnesis | null;
  upsertAction: (input: UpsertAnamnesisInput) => Promise<UpsertAnamnesisResult>;
}

// ---------------------------------------------------------------------------
// Section content type
// ---------------------------------------------------------------------------

type SectionContent = Record<SectionDefinition['key'], string>;

function buildInitialContent(anamnesis: Anamnesis | null): SectionContent {
  return {
    chiefComplaint: anamnesis?.chiefComplaint ?? '',
    historyPresentIllness: anamnesis?.historyPresentIllness ?? '',
    familyHistory: anamnesis?.familyHistory ?? '',
    educationalProfessional: anamnesis?.educationalProfessional ?? '',
    physicalHealth: anamnesis?.physicalHealth ?? '',
    priorTherapy: anamnesis?.priorTherapy ?? '',
    initialHypothesis: anamnesis?.initialHypothesis ?? '',
    treatmentPlan: anamnesis?.treatmentPlan ?? '',
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client component for the Anamnese tab. Renders 8 standard clinical sections
 * in flat Card containers with a shared TiptapEditor per section. Integrates
 * useAutoSave for debounced auto-save and exposes a manual "Salvar" button.
 *
 * Dirty state: shows a confirmation dialog when the user attempts to navigate
 * away with unsaved changes (via `beforeunload` and a controlled AlertDialog).
 */
export function AnamnesisTab({ patientId, initialAnamnesis, upsertAction }: AnamnesisTabProps) {
  const [content, setContent] = useState<SectionContent>(() =>
    buildInitialContent(initialAnamnesis),
  );

  // Track the "clean" snapshot for dirty detection. Using state (not ref) so
  // the render-time comparison `isDirty` doesn't violate the
  // react-hooks/refs rule.
  const [cleanSnapshot, setCleanSnapshot] = useState<string>(() =>
    JSON.stringify(buildInitialContent(initialAnamnesis)),
  );

  const isDirty = JSON.stringify(content) !== cleanSnapshot;

  // Manual save state — tracked separately from auto-save so the indicator
  // can reflect whichever save (manual or auto) happened most recently.
  const [isManualSaving, setIsManualSaving] = useState(false);
  const [manualSaveStatus, setManualSaveStatus] = useState<AutoSaveStatus>('idle');
  const [lastManualSavedAt, setLastManualSavedAt] = useState<Date | null>(null);

  // Dirty-state navigation guard dialog
  const [showDirtyDialog, setShowDirtyDialog] = useState(false);

  // ---- Save function (shared between auto-save and manual save) ----

  const saveFn = useCallback(
    async (data: SectionContent) => {
      const input: UpsertAnamnesisInput = {
        patientId,
        ...data,
      };
      const result = await upsertAction(input);
      if (!result.ok) {
        throw new Error(result.error);
      }
      // Update clean snapshot on successful save.
      setCleanSnapshot(JSON.stringify(data));
    },
    [patientId, upsertAction],
  );

  // ---- Auto-save integration (10s debounce per design system rules) ----

  const { status: autoSaveStatus, lastSavedAt: autoSavedAt } = useAutoSave(content, saveFn, {
    interval: 10_000,
  });

  // Merge auto-save and manual-save into a single effective status. The most
  // recent event wins — "saving" trumps everything, then "error", then the
  // most recent "saved" timestamp.
  const effectiveStatus: AutoSaveStatus =
    autoSaveStatus === 'saving' || manualSaveStatus === 'saving'
      ? 'saving'
      : autoSaveStatus === 'error' || manualSaveStatus === 'error'
        ? 'error'
        : manualSaveStatus === 'saved' || autoSaveStatus === 'saved'
          ? 'saved'
          : 'idle';

  const lastSavedAt =
    autoSavedAt && lastManualSavedAt
      ? autoSavedAt > lastManualSavedAt
        ? autoSavedAt
        : lastManualSavedAt
      : (autoSavedAt ?? lastManualSavedAt);

  // ---- Manual save handler ----

  const handleManualSave = useCallback(async () => {
    setIsManualSaving(true);
    setManualSaveStatus('saving');
    try {
      await saveFn(content);
      setManualSaveStatus('saved');
      setLastManualSavedAt(new Date());
    } catch {
      setManualSaveStatus('error');
    } finally {
      setIsManualSaving(false);
    }
  }, [content, saveFn]);

  // ---- Wrappers for onClick that avoid passing a Promise to the DOM ----

  const fireManualSave = useCallback(() => {
    void handleManualSave();
  }, [handleManualSave]);

  // ---- Section change handler ----

  const handleSectionChange = useCallback((key: SectionDefinition['key'], html: string) => {
    setContent((prev) => ({ ...prev, [key]: html }));
  }, []);

  // ---- Browser beforeunload guard ----

  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // ---- Discard handler for the dialog ----

  const handleDiscard = useCallback(() => {
    // Reset content to the last clean snapshot.
    const parsed: SectionContent = JSON.parse(cleanSnapshot) as SectionContent;
    setContent(parsed);
    setShowDirtyDialog(false);
  }, [cleanSnapshot]);

  return (
    <div className="max-w-[720px]" data-testid="anamnesis-tab">
      {/* Header row: title + auto-save indicator + manual save button */}
      <div className="mb-8 flex items-center justify-between">
        <h3 className="text-text-primary text-lg leading-[1.25] font-semibold">Anamnese</h3>
        <div className="flex items-center gap-3">
          <AutoSaveIndicator
            status={effectiveStatus}
            lastSavedAt={lastSavedAt}
            onRetry={fireManualSave}
          />
          <Button
            onClick={fireManualSave}
            disabled={isManualSaving || !isDirty}
            data-testid="anamnesis-save-button"
          >
            {isManualSaving ? (
              <>
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
                Salvando...
              </>
            ) : (
              'Salvar'
            )}
          </Button>
        </div>
      </div>

      {/* Sections */}
      <div className="flex flex-col gap-12">
        {SECTIONS.map((section) => (
          <Card
            key={section.key}
            className="shadow-none"
            data-testid={`anamnesis-section-${section.key}`}
          >
            <CardHeader>
              <CardTitle className="text-base font-medium">{section.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <TiptapEditor
                content={content[section.key]}
                onChange={(html) => handleSectionChange(section.key, html)}
                placeholder={section.placeholder}
                aria-label={section.label}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Dirty state confirmation dialog */}
      <AlertDialog open={showDirtyDialog} onOpenChange={setShowDirtyDialog}>
        <AlertDialogContent data-testid="anamnesis-dirty-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Alteracoes nao salvas</AlertDialogTitle>
            <AlertDialogDescription>
              Voce tem alteracoes que ainda nao foram salvas. Deseja descartar as alteracoes ou
              continuar editando?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => setShowDirtyDialog(false)}
              data-testid="anamnesis-dirty-continue"
            >
              Continuar editando
            </AlertDialogAction>
            <AlertDialogCancel onClick={handleDiscard} data-testid="anamnesis-dirty-discard">
              Descartar
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AutoSaveIndicator (internal)
// ---------------------------------------------------------------------------

interface AutoSaveIndicatorProps {
  status: AutoSaveStatus;
  lastSavedAt: Date | null;
  onRetry: () => void;
}

/**
 * Displays the current auto-save status: "Salvo as HH:MM", "Salvando...",
 * or "Erro ao salvar" with retry. Respects `prefers-reduced-motion` on the
 * spinner via Tailwind's `motion-reduce:` modifier.
 */
function AutoSaveIndicator({ status, lastSavedAt, onRetry }: AutoSaveIndicatorProps) {
  if (status === 'saving') {
    return (
      <span
        className="text-text-tertiary flex items-center gap-1.5 text-xs font-medium"
        data-testid="anamnesis-autosave-saving"
        aria-live="polite"
      >
        <Loader2
          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        Salvando...
      </span>
    );
  }

  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          'text-danger-700 flex items-center gap-1.5 text-xs font-medium',
          'focus-visible:shadow-focus rounded-sm hover:underline focus-visible:outline-none',
        )}
        data-testid="anamnesis-autosave-error"
        aria-live="assertive"
      >
        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Erro ao salvar
        <RefreshCw className="h-3 w-3" aria-hidden="true" />
      </button>
    );
  }

  if (status === 'saved' && lastSavedAt) {
    const timeStr = format(lastSavedAt, 'HH:mm', { locale: ptBR });
    return (
      <span
        className="text-text-tertiary text-xs font-medium"
        data-testid="anamnesis-autosave-saved"
        aria-live="polite"
      >
        Salvo as {timeStr}
      </span>
    );
  }

  // idle — nothing to show
  return null;
}
