'use client';

import { FileText } from 'lucide-react';

import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DocumentsEmptyStateProps {
  /** Callback when the user clicks the "Novo documento" button. */
  onAdd: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Salvia empty state for the documents tab when no documents exist.
 *
 * Renders:
 * - FileText icon in text-tertiary
 * - h4 "Nenhum documento"
 * - Description guiding the user to create formal documents
 * - Primary CTA "Novo documento"
 */
export function DocumentsEmptyState({ onAdd }: DocumentsEmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="documents-empty-state"
    >
      <FileText className="text-text-tertiary mb-3 h-10 w-10" aria-hidden="true" />
      <h4 className="text-text-primary mb-1 text-lg font-semibold">Nenhum documento</h4>
      <p className="text-text-secondary mb-4 max-w-sm text-sm">
        Crie declarações, atestados, laudos e outros documentos formais.
      </p>
      <Button onClick={onAdd} data-testid="documents-empty-cta">
        Novo documento
      </Button>
    </div>
  );
}
