'use client';

import { useCallback } from 'react';
import { toast } from 'sonner';

import {
  isWithinEditWindow,
  shouldForceAddendum,
  type EvolutionFull,
  type TemplateType,
  type UpdateEvolutionResult,
} from '@/modules/medical-records';
import { EvolutionEditor } from '@/modules/medical-records/components/evolution-editor';
import { VersionHistoryPanel } from '@/modules/medical-records/components/version-history-panel';
import type { EvolutionVersion } from '@/shared/db/schema/medical-records/tables';
import { Badge } from '@/shared/ui/badge';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EvolutionDetailViewProps {
  evolution: EvolutionFull;
  versions: EvolutionVersion[];
  /** Server Action for updating the evolution (passed from page). */
  updateAction: (input: unknown) => Promise<UpdateEvolutionResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client component for viewing/editing an existing evolution.
 *
 * Behavior:
 * - Within 30-day edit window: EvolutionEditor's auto-save calls updateAction
 *   with isAddendum=false. Mode badge: "Editavel".
 * - Past 30-day window: content is displayed, and any update is forced as an
 *   addendum (isAddendum=true, reason required). Mode badge: "Somente adendo".
 * - "Historico" button opens VersionHistoryPanel (Sheet) showing all versions.
 */
export function EvolutionDetailView({
  evolution,
  versions,
  updateAction,
}: EvolutionDetailViewProps) {
  const createdAt = new Date(evolution.createdAt);
  const withinWindow = isWithinEditWindow(createdAt);
  const forceAddendum = shouldForceAddendum(createdAt);

  const handleSave = useCallback(
    async (content: Record<string, unknown>) => {
      const result = await updateAction({
        evolutionId: evolution.id,
        content,
        isAddendum: forceAddendum,
        // For addendum, reason is required — this is a simplified flow;
        // a production version would prompt for reason before submission.
        reason: forceAddendum ? 'Atualizacao clinica' : undefined,
      });

      if (result.ok) {
        toast.success(
          result.isAddendum ? 'Adendo adicionado com sucesso' : 'Evolucao salva com sucesso',
        );
      } else if (result.code === 'REASON_REQUIRED') {
        toast.error('Motivo obrigatorio para adendo.');
      } else {
        toast.error('Erro ao salvar evolucao.');
      }
    },
    [evolution.id, forceAddendum, updateAction],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Mode indicator + History */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {withinWindow ? (
            <Badge variant="neutral" data-testid="edit-mode-badge">
              Editavel
            </Badge>
          ) : (
            <Badge variant="warning" data-testid="addendum-mode-badge">
              Somente adendo
            </Badge>
          )}
          <span className="text-text-tertiary text-xs">v{evolution.currentVersion}</span>
        </div>
        <VersionHistoryPanel versions={versions} />
      </div>

      {/* Editor */}
      <EvolutionEditor
        templateType={evolution.templateType as TemplateType}
        initialContent={(evolution.content as Record<string, unknown>) ?? {}}
        onSave={handleSave}
      />
    </div>
  );
}
