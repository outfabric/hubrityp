'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { EvolutionEditor } from '@/modules/medical-records/components/evolution-editor';
import { TemplateSelector } from '@/modules/medical-records/components/template-selector';
import type { TemplateType } from '@/modules/medical-records/lib/template-types';

// ---------------------------------------------------------------------------
// Types (defined locally to avoid importing from server-only barrel)
// ---------------------------------------------------------------------------

/** Mirrors the shape returned by the createEvolution Server Action. */
type CreateEvolutionResult =
  | { ok: true; id: string }
  | { ok: false; code: 'DUPLICATE_SESSION' | 'INVALID_TEMPLATE' | 'UNAUTHORIZED' };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface NewEvolutionFormProps {
  patientId: string;
  /** Optional session ID from query param — links evolution to that session. */
  sessionId: string | undefined;
  /** Server Action for creating an evolution (passed from page). */
  createAction: (input: unknown) => Promise<CreateEvolutionResult>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client form that composes TemplateSelector + EvolutionEditor for creating
 * a new evolution. Handles template selection, content editing (with
 * auto-save via the editor's built-in mechanism), and final submission via
 * the createEvolution Server Action.
 */
export function NewEvolutionForm({ patientId, sessionId, createAction }: NewEvolutionFormProps) {
  const router = useRouter();
  const [templateType, setTemplateType] = useState<TemplateType>('livre');
  const [hasSaved, setHasSaved] = useState(false);

  const handleSave = useCallback(
    async (content: Record<string, unknown>) => {
      // Auto-save: attempts to create the evolution with current content.
      // On first save, this creates the record. On subsequent saves, this is
      // a no-op since the EvolutionEditor's auto-save handles updates after
      // the evolution exists. For creation, we only create on first call.
      if (hasSaved) return;

      const result = await createAction({
        patientId,
        sessionId,
        templateType,
        content,
      });

      if (result.ok) {
        setHasSaved(true);
        toast.success('Evolucao criada com sucesso');
        // Redirect to the detail page for further editing via auto-save
        router.push(`/pacientes/${patientId}/prontuario/evolucoes/${result.id}`);
      } else if (result.code === 'DUPLICATE_SESSION') {
        toast.error('Ja existe uma evolucao vinculada a esta sessao.');
      } else {
        toast.error('Erro ao criar evolucao. Verifique os campos.');
      }
    },
    [patientId, sessionId, templateType, hasSaved, router, createAction],
  );

  return (
    <div className="flex flex-col gap-6">
      <TemplateSelector value={templateType} onChange={setTemplateType} />
      <EvolutionEditor templateType={templateType} initialContent={{}} onSave={handleSave} />
    </div>
  );
}
