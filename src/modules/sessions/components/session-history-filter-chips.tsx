'use client';

/**
 * SessionHistoryFilterChips — single-select chip filter bar below the summary
 * strip (RF-13.10).
 *
 * Options: "Todas" (default), "Realizadas", "Canceladas", "Não compareceu".
 * Exactly one chip is active at a time; activating one deactivates the others.
 * The selected value maps to the backend `status` filter:
 *   - "Todas"          → `undefined` (no status filter — all history statuses)
 *   - "Realizadas"     → `'done'`
 *   - "Canceladas"     → `'cancelled'`
 *   - "Não compareceu" → `'no_show'`
 *
 * The filter applies only to historical sessions; the future session stays
 * visible regardless and is rendered outside this component.
 *
 * Presentation-only leaf: it is fully controlled via `value` / `onChange`.
 * Chips are real `<button>`s in a `role="group"` for keyboard accessibility;
 * the active chip carries `aria-pressed` and the Sálvia brand "active" styling.
 */

import type { SessionHistoryStatus } from '@/modules/sessions/lib/session-history-schema';
import { cn } from '@/shared/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** `undefined` = "Todas" (no status filter); otherwise a terminal history status. */
export type SessionHistoryFilterValue = SessionHistoryStatus | undefined;

export interface SessionHistoryFilterChipsProps {
  /** Currently active filter; `undefined` selects the default "Todas" chip. */
  value: SessionHistoryFilterValue;
  /** Called with the chip's value when the user selects a different filter. */
  onChange: (value: SessionHistoryFilterValue) => void;
}

interface ChipOption {
  value: SessionHistoryFilterValue;
  label: string;
}

const CHIP_OPTIONS: readonly ChipOption[] = [
  { value: undefined, label: 'Todas' },
  { value: 'done', label: 'Realizadas' },
  { value: 'cancelled', label: 'Canceladas' },
  { value: 'no_show', label: 'Não compareceu' },
];

/** Stable React key for a chip (`undefined` has no string identity). */
function chipKey(value: SessionHistoryFilterValue): string {
  return value ?? 'all';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionHistoryFilterChips({ value, onChange }: SessionHistoryFilterChipsProps) {
  return (
    <div
      role="group"
      aria-label="Filtrar histórico por status"
      data-testid="session-history-filter-chips"
      className="flex flex-wrap items-center gap-2"
    >
      {CHIP_OPTIONS.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            key={chipKey(option.value)}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium',
              'duration-fast transition-colors',
              'focus-visible:shadow-focus focus-visible:outline-none',
              isActive
                ? 'border-brand-500 bg-brand-50 text-brand-700'
                : 'border-border-strong bg-surface text-text-secondary hover:bg-surface-muted hover:text-text-primary',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
