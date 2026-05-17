'use client';

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { EvolutionEditor } from '@/modules/medical-records/components/evolution-editor';
import { VersionHistoryPanel } from '@/modules/medical-records/components/version-history-panel';
import {
  isWithinEditWindow,
  shouldForceAddendum,
} from '@/modules/medical-records/lib/immutability-helpers';
import type { TemplateType } from '@/modules/medical-records/lib/template-types';
import type { Evolution, EvolutionVersion } from '@/shared/db/schema/medical-records/tables';
import { Badge } from '@/shared/ui/badge';
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
import { Textarea } from '@/shared/ui/textarea';

// ---------------------------------------------------------------------------
// Types (defined locally to avoid importing from server-only barrel)
// ---------------------------------------------------------------------------

/** Mirrors the shape returned by the updateEvolution Server Action. */
type UpdateEvolutionResult =
  | { ok: true; version: number; isAddendum: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'UNAUTHORIZED' | 'REASON_REQUIRED' };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EvolutionDetailViewProps {
  evolution: Evolution;
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
 * - Past 30-day window: edits trigger an addendum reason dialog. The user must
 *   provide a reason before the addendum is submitted. Mode badge: "Somente adendo".
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

  // Addendum dialog state
  const [addendumDialogOpen, setAddendumDialogOpen] = useState(false);
  const [addendumReason, setAddendumReason] = useState('');
  const [addendumSubmitting, setAddendumSubmitting] = useState(false);
  // Store pending content for addendum submission
  const pendingContentRef = useRef<Record<string, unknown> | null>(null);

  const submitAddendum = useCallback(async () => {
    if (!pendingContentRef.current || addendumReason.trim().length === 0) return;

    setAddendumSubmitting(true);
    const result = await updateAction({
      evolutionId: evolution.id,
      content: pendingContentRef.current,
      isAddendum: true,
      reason: addendumReason.trim(),
    });

    setAddendumSubmitting(false);

    if (result.ok) {
      toast.success('Adendo adicionado com sucesso');
      setAddendumDialogOpen(false);
      setAddendumReason('');
      pendingContentRef.current = null;
    } else if (result.code === 'REASON_REQUIRED') {
      toast.error('Motivo obrigatorio para adendo.');
    } else {
      toast.error('Erro ao salvar adendo.');
    }
  }, [evolution.id, addendumReason, updateAction]);

  const handleSave = useCallback(
    async (content: Record<string, unknown>) => {
      if (forceAddendum) {
        // Open the addendum reason dialog instead of saving directly
        pendingContentRef.current = content;
        setAddendumDialogOpen(true);
        return;
      }

      const result = await updateAction({
        evolutionId: evolution.id,
        content,
        isAddendum: false,
      });

      if (result.ok) {
        toast.success('Evolucao salva com sucesso');
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

      {/* Addendum reason dialog — opened when forceAddendum is true and user edits */}
      <Dialog open={addendumDialogOpen} onOpenChange={setAddendumDialogOpen}>
        <DialogContent data-testid="addendum-reason-dialog">
          <DialogHeader>
            <DialogTitle>Motivo do adendo</DialogTitle>
            <DialogDescription>
              Esta evolucao ultrapassou o prazo de edicao de 30 dias. Qualquer alteracao sera
              registrada como adendo. Informe o motivo abaixo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="addendum-reason">Motivo</Label>
            <Textarea
              id="addendum-reason"
              data-testid="addendum-reason-input"
              value={addendumReason}
              onChange={(e) => setAddendumReason(e.target.value)}
              placeholder="Descreva o motivo da alteracao..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddendumDialogOpen(false)}
              data-testid="addendum-cancel-btn"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void submitAddendum()}
              disabled={addendumReason.trim().length === 0 || addendumSubmitting}
              data-testid="addendum-submit-btn"
            >
              {addendumSubmitting ? 'Salvando...' : 'Salvar adendo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
