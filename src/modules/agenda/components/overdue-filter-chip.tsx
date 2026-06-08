'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { Badge } from '@/shared/ui/badge';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OverdueFilterChipProps {
  /** Count of overdue-without-evolution sessions currently in the list. */
  count: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Active-filter chip for the `/agenda?filtro=sem-evolucao` list-mode
 * destination (RF-12.09 / RNF-12.03).
 *
 * Renders "Sem evolução · N" as a Sálvia `Badge` with a keyboard-focusable
 * remove control. Removing the filter navigates back to `/agenda` WITHOUT the
 * `filtro` param — i.e. the default calendar view, not the list. We replace
 * with the bare `/agenda` path (rather than mutating current params) because
 * this destination owns no other state worth preserving, and the contract is
 * an unconditional return to the calendar.
 *
 * `aria-live="polite"` on the wrapper announces the chip to assistive tech when
 * the list mode becomes active.
 */
export function OverdueFilterChip({ count }: OverdueFilterChipProps) {
  const router = useRouter();

  const handleRemove = useCallback(() => {
    router.replace('/agenda', { scroll: false });
  }, [router]);

  return (
    <div aria-live="polite">
      <Badge
        variant="warning"
        className="gap-1.5 py-1 pr-1 pl-2.5"
        data-testid="overdue-evolutions-filter-chip"
      >
        <span>Sem evolução &middot; {count}</span>
        <button
          type="button"
          onClick={handleRemove}
          aria-label="Remover filtro: sem evolução"
          className="focus-visible:ring-brand-500 hover:bg-warning-50 inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2"
          data-testid="overdue-evolutions-filter-remove"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </Badge>
    </div>
  );
}
