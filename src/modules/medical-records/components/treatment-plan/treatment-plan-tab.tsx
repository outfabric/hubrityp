'use client';

import { Target } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type {
  GetTreatmentPlanResult,
  ListTreatmentPlanVersionsResult,
  UpsertTreatmentPlanResult,
} from '@/modules/medical-records';
import { contentHasChanged } from '@/modules/medical-records/lib/content-diff';
import type { Goal, Phase } from '@/modules/medical-records/lib/treatment-plan-schemas';
import { useAutoSave } from '@/modules/patients/lib/use-auto-save';
import type {
  TreatmentPlan,
  TreatmentPlanVersion,
} from '@/shared/db/schema/medical-records/tables';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { AutoSaveIndicator } from '../auto-save-indicator';

import { GoalsList } from './goals-list';
import { PhasesList } from './phases-list';
import { ResourcesEditor } from './resources-editor';
import { SuccessCriteriaEditor } from './success-criteria-editor';
import { VersionHistorySheet } from './version-history-sheet';

// ---------------------------------------------------------------------------
// Editable plan state — the shape auto-save serializes and compares.
// ---------------------------------------------------------------------------

interface PlanContent {
  goals: Goal[];
  phases: Phase[];
  resources: string;
  successCriteria: string;
}

function emptyPlanContent(): PlanContent {
  return {
    goals: [],
    phases: [],
    resources: '',
    successCriteria: '',
  };
}

function planToPlanContent(plan: TreatmentPlan): PlanContent {
  return {
    goals: (plan.goals as Goal[]) ?? [],
    phases: (plan.phases as Phase[]) ?? [],
    resources: plan.resources ?? '',
    successCriteria: plan.successCriteria ?? '',
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TreatmentPlanTabProps {
  /** Patient ID for the treatment plan. */
  patientId: string;
  /** Server action: fetch the current treatment plan. */
  getTreatmentPlan: (input: { patientId: string }) => Promise<GetTreatmentPlanResult>;
  /** Server action: create or update the treatment plan. */
  upsertTreatmentPlan: (input: {
    patientId: string;
    goals: Goal[];
    phases: Phase[];
    resources: string | null;
    successCriteria: string | null;
  }) => Promise<UpsertTreatmentPlanResult>;
  /** Server action: list version history for a plan. */
  listTreatmentPlanVersions: (input: {
    planId: string;
  }) => Promise<ListTreatmentPlanVersionsResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Main container for the "Plano terapeutico" tab in the prontuario.
 *
 * States:
 * - Loading: spinner while fetching initial plan.
 * - Empty: Target icon + h4 + description + CTA (inline transition).
 * - Editor: header with h2 + History button + AutoSaveIndicator, then
 *   4 Card sections: Objetivos (GoalsList), Fases (PhasesList),
 *   Recursos (ResourcesEditor), Criterios (SuccessCriteriaEditor).
 *
 * Integrates useAutoSave with 10s debounce calling upsertTreatmentPlan.
 * Uses contentHasChanged to prevent no-op saves. Invalid goals (empty
 * description) block the save.
 */
export function TreatmentPlanTab({
  patientId,
  getTreatmentPlan,
  upsertTreatmentPlan,
  listTreatmentPlanVersions,
}: TreatmentPlanTabProps) {
  const [loading, setLoading] = useState(true);
  const [planExists, setPlanExists] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [content, setContent] = useState<PlanContent>(emptyPlanContent());
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<TreatmentPlanVersion[]>([]);

  // Track the last successfully saved content to prevent no-op saves.
  const lastSavedContentRef = useRef<string>(JSON.stringify(emptyPlanContent()));

  // Load the treatment plan on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const result = await getTreatmentPlan({ patientId });

      if (cancelled) return;

      if (result.ok && result.plan) {
        const planContent = planToPlanContent(result.plan);
        setContent(planContent);
        setPlanExists(true);
        setPlanId(result.plan.id);
        lastSavedContentRef.current = JSON.stringify(planContent);
      }

      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [patientId, getTreatmentPlan]);

  // Save function for useAutoSave
  const handleSave = useCallback(
    async (contentToSave: PlanContent) => {
      // Validate: block save if any goal has empty description
      const hasInvalidGoal = contentToSave.goals.some((g) => g.description.trim() === '');
      if (hasInvalidGoal) {
        throw new Error('Invalid goal: empty description');
      }

      // Validate: block save if any phase has empty title
      const hasInvalidPhase = contentToSave.phases.some((p) => p.title.trim() === '');
      if (hasInvalidPhase) {
        throw new Error('Invalid phase: empty title');
      }

      // Skip if content unchanged since last save
      if (!contentHasChanged(lastSavedContentRef.current, JSON.stringify(contentToSave))) {
        return;
      }

      const result = await upsertTreatmentPlan({
        patientId,
        goals: contentToSave.goals,
        phases: contentToSave.phases,
        resources: contentToSave.resources || null,
        successCriteria: contentToSave.successCriteria || null,
      });

      if (!result.ok) {
        throw new Error(`Save failed: ${result.code}`);
      }

      // Track plan existence and ID for version history
      if (!planExists) {
        setPlanExists(true);
      }
      setPlanId(result.planId);
      lastSavedContentRef.current = JSON.stringify(contentToSave);
    },
    [patientId, upsertTreatmentPlan, planExists],
  );

  const { status, lastSavedAt } = useAutoSave(content, handleSave, { interval: 10_000 });

  // Load version history when sheet is opened
  const handleVersionHistoryOpen = useCallback(
    (open: boolean) => {
      setVersionHistoryOpen(open);
      if (open && planId) {
        void listTreatmentPlanVersions({ planId }).then((result) => {
          if (result.ok) {
            // Reverse to show newest first
            setVersions([...result.versions].reverse());
          }
        });
      }
    },
    [planId, listTreatmentPlanVersions],
  );

  // Handle CTA click — transitions to editor mode inline
  const handleCreate = useCallback(() => {
    setPlanExists(true);
    setContent(emptyPlanContent());
  }, []);

  // Field updaters
  const handleGoalsChange = useCallback((goals: Goal[]) => {
    setContent((prev) => ({ ...prev, goals }));
  }, []);

  const handlePhasesChange = useCallback((phases: Phase[]) => {
    setContent((prev) => ({ ...prev, phases }));
  }, []);

  const handleResourcesChange = useCallback((resources: string) => {
    setContent((prev) => ({ ...prev, resources }));
  }, []);

  const handleSuccessCriteriaChange = useCallback((successCriteria: string) => {
    setContent((prev) => ({ ...prev, successCriteria }));
  }, []);

  // Retry handler for error state
  const handleRetry = useCallback(() => {
    void handleSave(content).catch(() => {
      toast.error('Erro ao salvar. Tente novamente.');
    });
  }, [content, handleSave]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="treatment-plan-loading">
        <div className="border-brand-500 h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
      </div>
    );
  }

  // Empty state
  if (!planExists) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 text-center"
        data-testid="treatment-plan-empty-state"
      >
        <Target className="text-text-tertiary mb-3 h-10 w-10" aria-hidden="true" />
        <h4 className="text-text-primary mb-1 text-lg font-semibold">
          Plano terapeutico ainda nao criado
        </h4>
        <p className="text-text-secondary mb-4 max-w-sm text-sm">
          Comece definindo objetivos para guiar o trabalho terapeutico.
        </p>
        <Button onClick={handleCreate} data-testid="treatment-plan-create-cta">
          Criar plano terapeutico
        </Button>
      </div>
    );
  }

  // Editor state
  return (
    <div className="space-y-12" data-testid="treatment-plan-editor">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-text-primary text-xl font-semibold">Plano terapeutico</h2>
          <VersionHistorySheet
            versions={versions}
            open={versionHistoryOpen}
            onOpenChange={handleVersionHistoryOpen}
          />
        </div>
        <div className="flex items-center gap-3">
          <AutoSaveIndicator status={status} lastSavedAt={lastSavedAt} />
          {status === 'error' && (
            <button
              type="button"
              onClick={handleRetry}
              className="text-danger-700 text-xs underline"
              data-testid="treatment-plan-retry-save"
            >
              Tentar novamente
            </button>
          )}
        </div>
      </div>

      {/* Objetivos */}
      <Card data-testid="treatment-plan-goals-card">
        <CardHeader>
          <CardTitle>Objetivos</CardTitle>
        </CardHeader>
        <CardContent>
          <GoalsList goals={content.goals} onChange={handleGoalsChange} />
        </CardContent>
      </Card>

      {/* Fases */}
      <Card data-testid="treatment-plan-phases-card">
        <CardHeader>
          <CardTitle>Fases</CardTitle>
        </CardHeader>
        <CardContent>
          <PhasesList phases={content.phases} onChange={handlePhasesChange} />
        </CardContent>
      </Card>

      {/* Recursos terapeuticos */}
      <Card data-testid="treatment-plan-resources-card">
        <CardHeader>
          <CardTitle>Recursos terapeuticos</CardTitle>
        </CardHeader>
        <CardContent>
          <ResourcesEditor value={content.resources} onChange={handleResourcesChange} />
        </CardContent>
      </Card>

      {/* Criterios de sucesso */}
      <Card data-testid="treatment-plan-criteria-card">
        <CardHeader>
          <CardTitle>Criterios de sucesso</CardTitle>
        </CardHeader>
        <CardContent>
          <SuccessCriteriaEditor
            value={content.successCriteria}
            onChange={handleSuccessCriteriaChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}
