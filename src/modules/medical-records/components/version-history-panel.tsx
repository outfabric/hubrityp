'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { History } from 'lucide-react';
import { useState } from 'react';

import type { EvolutionVersion } from '@/shared/db/schema/medical-records/tables';
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

interface VersionHistoryPanelProps {
  /** All version snapshots for the evolution, ordered by version number DESC. */
  versions: EvolutionVersion[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Sheet panel (slides from the right) that lists evolution version history.
 *
 * Each version entry shows:
 * - Version number
 * - Date formatted in pt-BR
 * - is_addendum Badge (when true)
 * - modified_by UUID (truncated)
 *
 * Clicking a version shows its content in a read-only view below.
 */
export function VersionHistoryPanel({ versions }: VersionHistoryPanelProps) {
  const [selectedVersion, setSelectedVersion] = useState<EvolutionVersion | null>(null);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5" data-testid="version-history-trigger">
          <History className="h-4 w-4" aria-hidden="true" />
          Historico
        </Button>
      </SheetTrigger>

      <SheetContent side="right" data-testid="version-history-panel">
        <SheetHeader>
          <SheetTitle>Historico de Versoes</SheetTitle>
          <SheetDescription>
            {versions.length === 0
              ? 'Nenhuma versao registrada.'
              : `${versions.length} ${versions.length === 1 ? 'versao' : 'versoes'} encontrada${versions.length === 1 ? '' : 's'}.`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-1 flex-col gap-2 overflow-y-auto">
          {versions.map((version) => (
            <button
              key={version.id}
              type="button"
              onClick={() => setSelectedVersion(version)}
              className={`border-border hover:bg-surface-muted flex w-full flex-col gap-1 rounded-md border p-3 text-left transition-colors ${
                selectedVersion?.id === version.id ? 'bg-surface-muted border-brand-500' : ''
              }`}
              data-testid={`version-item-${version.versionNumber}`}
            >
              <div className="flex items-center gap-2">
                <span className="text-text-primary text-sm font-medium">
                  Versao {version.versionNumber}
                </span>
                {version.isAddendum && (
                  <Badge variant="warning" data-testid="addendum-badge">
                    Adendo
                  </Badge>
                )}
              </div>
              <span className="text-text-secondary text-xs">
                {format(new Date(version.createdAt), "dd 'de' MMM 'de' yyyy, HH:mm", {
                  locale: ptBR,
                })}
              </span>
              <span className="text-text-tertiary text-xs">
                Por: {version.modifiedBy.slice(0, 8)}...
              </span>
            </button>
          ))}
        </div>

        {/* Read-only content viewer */}
        {selectedVersion && (
          <div className="border-border mt-4 border-t pt-4">
            <h4 className="text-text-primary mb-2 text-sm font-medium">
              Conteudo da Versao {selectedVersion.versionNumber}
            </h4>
            {selectedVersion.reason && (
              <p className="text-text-secondary mb-2 text-xs">Motivo: {selectedVersion.reason}</p>
            )}
            <div
              className="bg-surface-sunken rounded-md border p-4 text-sm"
              data-testid="version-content-viewer"
            >
              <pre className="text-text-primary max-h-[300px] overflow-y-auto font-sans text-sm whitespace-pre-wrap">
                {typeof selectedVersion.content === 'string'
                  ? selectedVersion.content
                  : JSON.stringify(selectedVersion.content, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
