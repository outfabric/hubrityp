'use client';

import { format } from 'date-fns';
import { FileText } from 'lucide-react';
import { useCallback, useState } from 'react';

import {
  type CreateEvolutionInput,
  EvolutionEditor,
  type EvolutionSummary,
  TEMPLATE_OPTIONS,
  TemplateSelector,
  type TemplateType,
} from '@/modules/medical-records/client';
import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ProntuarioCallContentProps {
  patientId: string;
  /** Recent evolutions fetched server-side, passed as serializable data. */
  recentEvolutions: EvolutionSummary[];
  /** Server Action: create a new evolution for this patient. */
  onCreateEvolution: (input: CreateEvolutionInput) => Promise<{ ok: boolean; id?: string }>;
  /** Server Action: update an existing evolution's content. */
  onUpdateEvolution: (input: {
    evolutionId: string;
    content: Record<string, unknown>;
  }) => Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Component
//
// Client component loaded inside the drawer's Suspense boundary. Renders
// recent evolutions list and a simplified quick evolution creation form.
// Uses existing prontuario module components and Server Actions for CRUD.
// ---------------------------------------------------------------------------

export function ProntuarioCallContent({
  patientId,
  recentEvolutions,
  onCreateEvolution,
  onUpdateEvolution,
}: ProntuarioCallContentProps) {
  const [templateType, setTemplateType] = useState<TemplateType>('livre');
  const [activeEvolutionId, setActiveEvolutionId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const handleCreateAndEdit = useCallback(async () => {
    setIsCreating(true);
    try {
      const result = await onCreateEvolution({
        patientId,
        templateType,
        content: templateType === 'livre' || templateType === 'custom' ? { conteudo: '' } : {},
      });
      if (result.ok && result.id) {
        setActiveEvolutionId(result.id);
        setShowEditor(true);
      }
    } finally {
      setIsCreating(false);
    }
  }, [onCreateEvolution, patientId, templateType]);

  const handleAutoSave = useCallback(
    async (content: Record<string, unknown>) => {
      if (!activeEvolutionId) return;
      await onUpdateEvolution({ evolutionId: activeEvolutionId, content });
    },
    [activeEvolutionId, onUpdateEvolution],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="prontuario-call-content">
      {/* Quick evolution form */}
      {showEditor ? (
        <div className="flex flex-col gap-3">
          <h5 className="text-text-primary text-sm font-medium">Nova evolucao</h5>
          <EvolutionEditor
            templateType={templateType}
            initialContent={
              templateType === 'livre' || templateType === 'custom' ? { conteudo: '' } : {}
            }
            onSave={handleAutoSave}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <h5 className="text-text-primary text-sm font-medium">Nova evolucao rapida</h5>
          <TemplateSelector value={templateType} onChange={setTemplateType} />
          <Button
            size="sm"
            onClick={() => void handleCreateAndEdit()}
            disabled={isCreating}
            data-testid="create-evolution-button"
          >
            <FileText className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {isCreating ? 'Criando...' : 'Criar evolucao'}
          </Button>
        </div>
      )}

      {/* Recent evolutions list */}
      <div className="flex flex-col gap-2">
        <h5 className="text-text-primary text-sm font-medium">
          Evolucoes recentes ({recentEvolutions.length})
        </h5>
        {recentEvolutions.length === 0 ? (
          <p className="text-text-tertiary text-sm">Nenhuma evolucao registrada.</p>
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="recent-evolutions-list">
            {recentEvolutions.map((evo) => {
              const templateLabel =
                TEMPLATE_OPTIONS.find((t) => t.value === evo.templateType)?.label ??
                evo.templateType;
              return (
                <li
                  key={evo.id}
                  className="border-border bg-surface-sunken flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="text-text-primary text-sm">{templateLabel}</span>
                    <span className="text-text-tertiary text-xs">
                      {format(new Date(evo.createdAt), 'dd/MM/yyyy HH:mm')}
                    </span>
                  </div>
                  {evo.finalizedAt && (
                    <span className="text-text-tertiary text-xs italic">Finalizada</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
