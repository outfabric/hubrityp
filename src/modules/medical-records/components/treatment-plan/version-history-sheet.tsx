'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Eye, History } from 'lucide-react';
import { useState } from 'react';

import type {
  Goal,
  Phase,
  VersionContent,
} from '@/modules/medical-records/lib/treatment-plan-schemas';
import type { TreatmentPlanVersion } from '@/shared/db/schema/medical-records/tables';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/ui/sheet';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface VersionHistorySheetProps {
  /** All version snapshots ordered by version_number DESC (newest first). */
  versions: TreatmentPlanVersion[];
  /** Whether the sheet should be open. */
  open: boolean;
  /** Callback when the sheet open state changes. */
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Sheet (right side) that displays treatment plan version history.
 *
 * Lists versions chronologically (newest first) with:
 * - version number Badge
 * - formatted date (pt-BR, America/Sao_Paulo)
 * - Eye icon button to view full read-only snapshot
 *
 * View mode renders read-only goals/phases/resources/criteria.
 */
export function VersionHistorySheet({ versions, open, onOpenChange }: VersionHistorySheetProps) {
  const [selectedVersion, setSelectedVersion] = useState<TreatmentPlanVersion | null>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          data-testid="treatment-plan-version-history-trigger"
        >
          <History className="h-4 w-4" aria-hidden="true" />
          Historico
        </Button>
      </SheetTrigger>

      <SheetContent side="right" data-testid="treatment-plan-version-history-sheet">
        <SheetHeader>
          <SheetTitle>Historico de versoes</SheetTitle>
          <SheetDescription>
            {versions.length === 0
              ? 'Nenhuma versao registrada.'
              : `${versions.length} ${versions.length === 1 ? 'versao' : 'versoes'} encontrada${versions.length === 1 ? '' : 's'}.`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-1 flex-col gap-2 overflow-y-auto">
          {versions.map((version) => (
            <div
              key={version.id}
              className={`border-border hover:bg-surface-muted flex w-full items-center justify-between rounded-md border p-3 transition-colors ${
                selectedVersion?.id === version.id ? 'bg-surface-muted border-brand-500' : ''
              }`}
              data-testid={`treatment-plan-version-item-${version.versionNumber}`}
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Badge variant="default">v{version.versionNumber}</Badge>
                </div>
                <span className="text-text-secondary text-xs">
                  {format(new Date(version.createdAt), "dd 'de' MMM 'de' yyyy, HH:mm", {
                    locale: ptBR,
                  })}
                </span>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() =>
                  setSelectedVersion(selectedVersion?.id === version.id ? null : version)
                }
                aria-label={`Ver versao ${version.versionNumber}`}
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>

        {/* Read-only snapshot viewer */}
        {selectedVersion && (
          <ReadOnlyPlanSnapshot
            content={selectedVersion.content as VersionContent}
            versionNumber={selectedVersion.versionNumber}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// ReadOnlyPlanSnapshot (internal)
// ---------------------------------------------------------------------------

interface ReadOnlyPlanSnapshotProps {
  content: VersionContent;
  versionNumber: number;
}

function ReadOnlyPlanSnapshot({ content, versionNumber }: ReadOnlyPlanSnapshotProps) {
  return (
    <div
      className="border-border mt-4 border-t pt-4"
      data-testid={`treatment-plan-version-snapshot-${versionNumber}`}
    >
      <h4 className="text-text-primary mb-3 text-sm font-medium">
        Conteudo da versao {versionNumber}
      </h4>

      {/* Goals */}
      {content.goals && content.goals.length > 0 && (
        <div className="mb-3">
          <h5 className="text-text-secondary mb-1 text-xs font-medium">Objetivos</h5>
          <div className="bg-surface-sunken space-y-2 rounded-md border p-3">
            {content.goals.map((goal: Goal, idx: number) => (
              <div key={goal.id ?? idx} className="text-text-primary text-sm">
                <span className="font-medium">{idx + 1}.</span> {goal.description || '(vazio)'}
                {goal.targetDate && (
                  <span className="text-text-tertiary ml-2 text-xs">Ate {goal.targetDate}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Phases */}
      {content.phases && content.phases.length > 0 && (
        <div className="mb-3">
          <h5 className="text-text-secondary mb-1 text-xs font-medium">Fases</h5>
          <div className="bg-surface-sunken space-y-2 rounded-md border p-3">
            {content.phases.map((phase: Phase, idx: number) => (
              <div key={phase.id ?? idx} className="text-text-primary text-sm">
                <span className="font-medium">{phase.title || '(sem titulo)'}</span>
                {phase.completed && (
                  <Badge variant="success" className="ml-2">
                    Concluida
                  </Badge>
                )}
                {phase.description && (
                  <p className="text-text-secondary mt-0.5 text-xs">{phase.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resources — HTML is author-generated Tiptap content from the same
         psychologist, fetched via RLS-scoped query. Not untrusted user input. */}
      {content.resources && (
        <div className="mb-3">
          <h5 className="text-text-secondary mb-1 text-xs font-medium">Recursos terapeuticos</h5>
          <div
            className="bg-surface-sunken prose prose-sm text-text-primary max-h-[200px] overflow-y-auto rounded-md border p-3"
            dangerouslySetInnerHTML={{ __html: content.resources }}
          />
        </div>
      )}

      {/* Success criteria — same justification as resources above. */}
      {content.successCriteria && (
        <div className="mb-3">
          <h5 className="text-text-secondary mb-1 text-xs font-medium">Criterios de sucesso</h5>
          <div
            className="bg-surface-sunken prose prose-sm text-text-primary max-h-[200px] overflow-y-auto rounded-md border p-3"
            dangerouslySetInnerHTML={{ __html: content.successCriteria }}
          />
        </div>
      )}
    </div>
  );
}
