'use client';

import { Building2, Plus } from 'lucide-react';

import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LocationsEmptyStateProps {
  /** Callback to open the create location modal. */
  onAdd: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Empty state for the locations page.
 *
 * Design System Salvia -- empty state pattern:
 *   - Lucide icon 24px in `text-tertiary`, centered
 *   - h4 "Nenhum local cadastrado" (16px/500)
 *   - Description in `text-secondary`
 *   - CTA "Adicionar local" Button primary
 */
export function LocationsEmptyState({ onAdd }: LocationsEmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="locations-empty-state"
    >
      <Building2 className="text-text-tertiary mb-4 h-6 w-6" aria-hidden="true" />
      <h4 className="text-text-primary mb-2 text-base font-medium">Nenhum local cadastrado</h4>
      <p className="text-text-secondary mb-6 max-w-sm text-[13px]">
        Cadastre seu primeiro local de atendimento para vincular as sessoes
      </p>
      <Button onClick={onAdd} data-testid="empty-state-add-location">
        <Plus className="h-4 w-4" aria-hidden="true" />
        Adicionar local
      </Button>
    </div>
  );
}
