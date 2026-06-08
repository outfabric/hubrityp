import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';

import { formatSessionDate, formatSessionTime } from '../lib/date-helpers';
import type { OverdueEvolutionItem } from '../server/list-overdue-evolutions';

import { OverdueFilterChip } from './overdue-filter-chip';

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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds the "Registrar evolução" CTA href for a given item (RF-12.08).
 * Points at the existing evolution-create route, pre-selecting the session.
 */
function evolutionCreateHref(item: OverdueEvolutionItem): string {
  return `/pacientes/${item.patientId}/prontuario/evolucoes/nova?sessionId=${item.sessionId}`;
}

/** Renders the elapsed-time label "há N dias" / "há 1 dia" (RF-12.08). */
function overdueLabel(daysOverdue: number): string {
  return daysOverdue === 1 ? 'há 1 dia' : `há ${daysOverdue} dias`;
}

// ---------------------------------------------------------------------------
// Empty state (positive "tudo em dia" — RF-12.19)
// ---------------------------------------------------------------------------

/**
 * Positive empty state shown when the overdue set resolves to zero — typically
 * because the pendência was already resolved between the dashboard load and the
 * click. It links to the full agenda (`/agenda`), NEVER the calendar
 * unexplained.
 *
 * The 🎉 emoji is mandated verbatim by the spec ("Tudo em dia. 🎉"); the spec
 * is the source of truth for this change and overrides the general
 * design-system "no emojis in product UI" rule for this string only.
 */
function OverdueEvolutionsEmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center py-20 text-center"
      data-testid="overdue-evolutions-empty-state"
    >
      <h4 className="text-text-primary text-base font-medium">
        Nenhuma sessão sem evolução. Tudo em dia. 🎉
      </h4>
      <Link href="/agenda">
        <Button variant="secondary" className="mt-6" data-testid="overdue-evolutions-view-agenda">
          Ver agenda
        </Button>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Server Component that renders the "sessões sem evolução" list-mode view of
 * the agenda (`/agenda?filtro=sem-evolucao`). Shows a header with the overdue
 * count and the removable active-filter chip, one row per overdue session
 * (patient name, São Paulo date/time, modality when available, "há N dias", and
 * the "Registrar evolução" CTA), or the positive empty state.
 *
 * Patient names stay server-rendered. The component carries NO clinical
 * content — only the metadata required to act on the pending evolution.
 */
export function OverdueEvolutionsList({ items }: OverdueEvolutionsListProps) {
  if (items.length === 0) {
    return <OverdueEvolutionsEmptyState />;
  }

  return (
    <section data-testid="overdue-evolutions-list" aria-label="Sessões sem evolução">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-text-primary text-[22px] leading-[1.25] font-semibold">
          Sessões sem evolução
          <span className="text-text-tertiary ml-2 text-base font-normal">({items.length})</span>
        </h2>
        <OverdueFilterChip count={items.length} />
      </div>

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.sessionId}
            data-testid="overdue-evolution-row"
            className="border-border bg-surface flex flex-wrap items-center justify-between gap-4 rounded-xl border p-6 shadow-xs"
          >
            <div className="flex flex-col gap-1">
              <span className="text-text-primary text-[15px] font-medium">{item.patientName}</span>
              <span className="text-text-secondary text-[13px]">
                {formatSessionDate(item.startAt)} às {formatSessionTime(item.startAt)}
                {item.modality !== null ? ` · ${MODALITY_LABEL[item.modality]}` : ''}
                <span className="text-text-tertiary"> · {overdueLabel(item.daysOverdue)}</span>
              </span>
            </div>

            <Link
              href={evolutionCreateHref(item)}
              data-testid="overdue-evolution-cta"
              aria-label={`Registrar evolução para ${item.patientName}`}
            >
              <Button size="sm">
                Registrar evolução
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
