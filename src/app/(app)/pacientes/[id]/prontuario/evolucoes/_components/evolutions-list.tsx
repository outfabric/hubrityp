'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { TEMPLATE_OPTIONS } from '@/modules/medical-records/lib/template-types';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Types (defined locally to avoid importing from server-only barrel)
// ---------------------------------------------------------------------------

/** Mirrors the shape returned by getEvolutionsByPatientImpl. */
interface EvolutionSummary {
  id: string;
  patientId: string;
  sessionId: string | null;
  templateType: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  finalizedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EvolutionsListProps {
  patientId: string;
  initialEvolutions: EvolutionSummary[];
  initialNextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Template label lookup
// ---------------------------------------------------------------------------

function getTemplateLabel(templateType: string): string {
  const match = TEMPLATE_OPTIONS.find((opt) => opt.value === templateType);
  return match?.label ?? templateType;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders the list of evolutions in reverse chronological order (newest first).
 * Shows a card per evolution with template badge, date, and content snippet.
 * When empty, shows the empty state with CTA "Registrar evolucao".
 */
export function EvolutionsList({
  patientId,
  initialEvolutions,
  initialNextCursor,
}: EvolutionsListProps) {
  const params = useParams<{ id: string }>();
  const id = params.id ?? patientId;

  // Empty state
  if (initialEvolutions.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 text-center"
        data-testid="evolutions-empty-state"
      >
        <FileText className="text-text-tertiary mb-3 h-10 w-10" aria-hidden="true" />
        <h4 className="text-text-primary mb-1 text-lg font-semibold">
          Nenhuma evolucao registrada
        </h4>
        <p className="text-text-secondary mb-4 max-w-sm text-sm">
          Registre a primeira evolucao clinica deste paciente para comecar o prontuario.
        </p>
        <Link href={`/pacientes/${id}/prontuario/evolucoes/nova`}>
          <Button data-testid="evolutions-empty-cta">
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Registrar evolucao
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="evolutions-list">
      {/* Header with CTA */}
      <div className="flex items-center justify-between">
        <p className="text-text-secondary text-sm">
          {initialEvolutions.length} {initialEvolutions.length === 1 ? 'evolucao' : 'evolucoes'}
        </p>
        <Link href={`/pacientes/${id}/prontuario/evolucoes/nova`}>
          <Button size="sm" data-testid="evolutions-new-btn">
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Nova evolucao
          </Button>
        </Link>
      </div>

      {/* Evolution cards */}
      {initialEvolutions.map((evolution) => (
        <EvolutionCard key={evolution.id} evolution={evolution} patientId={id} />
      ))}

      {/* Load more hint (cursor-based) */}
      {initialNextCursor && (
        <p className="text-text-tertiary py-4 text-center text-xs" data-testid="evolutions-cursor">
          Role para carregar mais evolucoes
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvolutionCard
// ---------------------------------------------------------------------------

interface EvolutionCardProps {
  evolution: EvolutionSummary;
  patientId: string;
}

function EvolutionCard({ evolution, patientId }: EvolutionCardProps) {
  const createdDate = format(new Date(evolution.createdAt), "dd 'de' MMM 'de' yyyy", {
    locale: ptBR,
  });

  return (
    <Link
      href={`/pacientes/${patientId}/prontuario/evolucoes/${evolution.id}`}
      className="border-border hover:bg-surface-muted block rounded-md border p-4 transition-colors"
      data-testid={`evolution-card-${evolution.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Badge variant="neutral" data-testid="evolution-template-badge">
              {getTemplateLabel(evolution.templateType)}
            </Badge>
            {evolution.finalizedAt && (
              <Badge variant="outline" data-testid="evolution-finalized-badge">
                Finalizada
              </Badge>
            )}
          </div>
          <span className="text-text-secondary text-xs">{createdDate}</span>
          {evolution.sessionId && (
            <span className="text-text-tertiary text-xs">Vinculada a sessao</span>
          )}
        </div>
        <span className="text-text-tertiary text-xs">v{evolution.currentVersion}</span>
      </div>
    </Link>
  );
}
