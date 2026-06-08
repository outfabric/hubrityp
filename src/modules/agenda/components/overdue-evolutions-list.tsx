import { FileText } from 'lucide-react';

import { formatSessionDate, formatSessionTime } from '../lib/date-helpers';
import type { OverdueEvolutionItem } from '../server/list-overdue-evolutions';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OverdueEvolutionsListProps {
  /** Overdue-without-evolution sessions, already owner-scoped and ordered. */
  items: OverdueEvolutionItem[];
}

// ---------------------------------------------------------------------------
// Modality label
// ---------------------------------------------------------------------------

const MODALITY_LABEL: Record<NonNullable<OverdueEvolutionItem['modality']>, string> = {
  presencial: 'Presencial',
  online: 'Online',
};

// ---------------------------------------------------------------------------
// Empty state (Sálvia empty-state pattern — RF-12 "sem pendências")
// ---------------------------------------------------------------------------

function OverdueEvolutionsEmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 text-center"
      data-testid="overdue-evolutions-empty-state"
    >
      <FileText className="text-text-tertiary mb-4 h-6 w-6" aria-hidden="true" />
      <h4 className="text-text-primary mb-2 text-base font-medium">Nenhuma evolução pendente</h4>
      <p className="text-text-secondary max-w-sm text-[13px]">
        Todas as sessões realizadas já têm evolução registrada.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Server Component that renders the "sessões sem evolução" list view of the
 * agenda. Shows a header with the overdue count, one row per overdue session
 * (patient name, when it happened, modality, days overdue), or the empty state.
 *
 * Carries NO clinical content — only the metadata required to act on the
 * pending evolution. The full row interactions (links into the prontuário) are
 * refined in a later section; this is the structural list.
 */
export function OverdueEvolutionsList({ items }: OverdueEvolutionsListProps) {
  if (items.length === 0) {
    return <OverdueEvolutionsEmptyState />;
  }

  return (
    <section data-testid="overdue-evolutions-list" aria-label="Sessões sem evolução">
      <h2 className="text-text-primary mb-4 text-[22px] leading-[1.25] font-semibold">
        Sessões sem evolução
        <span className="text-text-tertiary ml-2 text-base font-normal">({items.length})</span>
      </h2>

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.sessionId}
            data-testid="overdue-evolution-row"
            className="border-border bg-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border p-6 shadow-xs"
          >
            <div className="flex flex-col gap-1">
              <span className="text-text-primary text-[15px] font-medium">{item.patientName}</span>
              <span className="text-text-secondary text-[13px]">
                {formatSessionDate(item.startAt)} às {formatSessionTime(item.startAt)}
                {item.modality !== null ? ` · ${MODALITY_LABEL[item.modality]}` : ''}
              </span>
            </div>

            <span
              className="bg-warning-50 text-warning-700 inline-flex h-[22px] items-center rounded-full px-[10px] text-xs font-medium"
              data-testid="overdue-days-chip"
            >
              {item.daysOverdue} {item.daysOverdue === 1 ? 'dia' : 'dias'} de atraso
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
