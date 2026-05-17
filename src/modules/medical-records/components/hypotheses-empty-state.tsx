import { ClipboardList } from 'lucide-react';

import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HypothesesEmptyStateProps {
  /** Callback when the user clicks the "Adicionar hipotese" button. */
  onAdd: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Salvia empty state for the hypotheses tab when no hypotheses exist.
 *
 * Renders:
 * - ClipboardList icon in text-tertiary
 * - h4 "Nenhuma hipotese registrada"
 * - p in text-secondary with guidance text
 * - Primary CTA "Adicionar hipotese" emitting onAdd callback
 */
export function HypothesesEmptyState({ onAdd }: HypothesesEmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="hypotheses-empty-state"
    >
      <ClipboardList className="text-text-tertiary mb-3 h-10 w-10" aria-hidden="true" />
      <h4 className="text-text-primary mb-1 text-lg font-semibold">Nenhuma hipotese registrada</h4>
      <p className="text-text-secondary mb-4 max-w-sm text-sm">
        Adicione a primeira hipotese ao comecar a trabalhar com este paciente.
      </p>
      <Button onClick={onAdd} data-testid="hypotheses-empty-cta">
        Adicionar hipotese
      </Button>
    </div>
  );
}
