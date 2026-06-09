'use client';

/**
 * SessionHistorySummaryStrip — horizontal summary strip at the top of the
 * patient session-history tab (RF-13.01, RN-13.03, §8 zero-rate edge case).
 *
 * Surfaces four owner-scoped aggregates computed by the single summary query
 * (D3):
 *   - total realized sessions (`doneTotal`)
 *   - attendance rate, ALWAYS shown — including `0%` (never hidden, per §8)
 *   - a `warning` badge with the count of realized sessions lacking an
 *     evolution, HIDDEN when that count is zero
 *   - the date of the last realized session (`lastDoneAt`), or an em-dash when
 *     there is none yet
 *
 * Presentation-only leaf: it takes the already-serialized
 * `SessionHistorySummary` and renders it. The last-session date goes through the
 * São Paulo–timezone formatter so the displayed wall-clock matches the clinical
 * record regardless of the viewer's machine timezone. Decorative icons are
 * `aria-hidden`.
 */

import { AlertTriangle } from 'lucide-react';

import { formatFullDateWithWeekday } from '@/modules/sessions/lib/session-history-formatters';
import type { SessionHistorySummary } from '@/modules/sessions/lib/session-history-schema';
import { Badge } from '@/shared/ui/badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionHistorySummaryStripProps {
  /** Aggregate summary — already owner-scoped and serialized by the server. */
  summary: SessionHistorySummary;
}

// ---------------------------------------------------------------------------
// Local metric primitive
// ---------------------------------------------------------------------------

interface SummaryMetricProps {
  label: string;
  value: string;
}

/** A single labelled metric: caption-upper eyebrow over a primary value. */
function SummaryMetric({ label, value }: SummaryMetricProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-text-tertiary text-xs font-medium tracking-[0.06em] uppercase">
        {label}
      </span>
      <span className="text-text-primary text-sm font-medium">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionHistorySummaryStrip({ summary }: SessionHistorySummaryStripProps) {
  const lastDoneLabel = summary.lastDoneAt ? formatFullDateWithWeekday(summary.lastDoneAt) : '—';

  return (
    <section
      data-testid="session-history-summary-strip"
      aria-label="Resumo do histórico de sessões"
      className="bg-surface border-border flex flex-wrap items-start gap-x-8 gap-y-4 rounded-xl border p-4 shadow-xs md:p-6"
    >
      <SummaryMetric label="Realizadas" value={String(summary.doneTotal)} />

      <SummaryMetric label="Comparecimento" value={`${summary.attendanceRate}%`} />

      <div className="flex flex-col gap-1">
        <span className="text-text-tertiary text-xs font-medium tracking-[0.06em] uppercase">
          Última sessão
        </span>
        <span className="text-text-primary text-sm font-medium first-letter:uppercase">
          {lastDoneLabel}
        </span>
      </div>

      {summary.doneWithoutEvolution > 0 && (
        <Badge
          variant="warning"
          className="gap-1 self-center"
          data-testid="pending-evolution-badge"
        >
          <AlertTriangle aria-hidden className="size-4" />
          {summary.doneWithoutEvolution}{' '}
          {summary.doneWithoutEvolution === 1 ? 'evolução pendente' : 'evoluções pendentes'}
        </Badge>
      )}
    </section>
  );
}
