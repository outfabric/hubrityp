import type { WeeklySummaryResult } from '@/modules/dashboard';
import { cn } from '@/shared/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

/**
 * Seção "Resumo da semana" — owner-only operational metrics.
 *
 * Pure presentational Server Component over the owner-scoped
 * `WeeklySummaryResult`. Every metric reflects ONLY the logged-in
 * psychologist's data (RN-11.04) — there is no market benchmark, norm, or
 * comparative copy anywhere in this section.
 *
 * The no-show rate is shown only when `noShowRatePercent` is a number; below
 * the meaningful-sample threshold the server returns `null` and the metric
 * shows its "not enough data" empty state instead of a misleading percentage.
 *
 * `SectionWeeklySkeleton` is the matching `<Suspense>` fallback so the day's
 * data (Hoje + Pendências) can paint before this slower aggregate resolves.
 */

export interface SectionWeeklyProps {
  result: WeeklySummaryResult;
}

const EMPTY_METRIC_COPY = 'Ainda sem dados suficientes — agende sua primeira sessão para começar.';

interface MetricSpec {
  key: string;
  label: string;
  /** `null` renders the graceful empty state. */
  value: number | null;
  /** Optional suffix appended to a non-null value (e.g. "%"). */
  suffix?: string;
}

function Metric({ label, value, suffix, testId }: Omit<MetricSpec, 'key'> & { testId: string }) {
  const isEmpty = value === null;
  return (
    <div
      className="border-border-subtle flex flex-col gap-1 rounded-lg border p-4"
      data-testid={testId}
    >
      <span className="text-text-tertiary text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
      {isEmpty ? (
        <span className="text-text-tertiary text-xs" data-testid={`${testId}-empty`}>
          {EMPTY_METRIC_COPY}
        </span>
      ) : (
        <span
          className="text-text-primary text-2xl font-semibold tabular-nums"
          data-testid={`${testId}-value`}
        >
          {value}
          {suffix ?? ''}
        </span>
      )}
    </div>
  );
}

export function SectionWeekly({ result }: SectionWeeklyProps) {
  // A count metric uses its own empty state only when truly absent of data; a
  // zero count for a date-bounded metric (sessions this week) is a legitimate
  // value, but to satisfy the "graceful empty state per metric" requirement we
  // surface the empty copy when the metric has nothing to report (count === 0).
  const metrics: MetricSpec[] = [
    {
      key: 'sessions-done',
      label: 'Sessões realizadas',
      value: result.sessionsDoneThisWeek > 0 ? result.sessionsDoneThisWeek : null,
    },
    {
      key: 'sessions-scheduled',
      label: 'Sessões agendadas',
      value: result.sessionsScheduledThisWeek > 0 ? result.sessionsScheduledThisWeek : null,
    },
    {
      key: 'no-show-rate',
      label: 'Taxa de faltas',
      value: result.noShowRatePercent,
      suffix: '%',
    },
    {
      key: 'new-patients',
      label: 'Novos pacientes no mês',
      value: result.newPatientsThisMonth > 0 ? result.newPatientsThisMonth : null,
    },
    {
      key: 'evolutions',
      label: 'Evoluções na semana',
      value: result.evolutionsThisWeek > 0 ? result.evolutionsThisWeek : null,
    },
  ];

  return (
    <Card data-testid="dashboard-section-weekly">
      <CardHeader>
        <CardTitle>Resumo da semana</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map(({ key, ...metric }) => (
            <Metric key={key} {...metric} testId={`dashboard-weekly-${key}`} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Suspense fallback for `SectionWeekly`. Mirrors the card shape with neutral
 * pulsing placeholders so the layout does not shift when the summary resolves.
 */
export function SectionWeeklySkeleton() {
  return (
    <Card data-testid="dashboard-section-weekly-skeleton" aria-hidden="true">
      <CardHeader>
        <CardTitle>Resumo da semana</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className={cn('border-border-subtle flex flex-col gap-2 rounded-lg border p-4')}
            >
              <div className="bg-surface-muted h-3 w-24 animate-pulse rounded-full" />
              <div className="bg-surface-muted h-7 w-12 animate-pulse rounded-md" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
