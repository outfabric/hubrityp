import { Calendar } from 'lucide-react';
import Link from 'next/link';

import { formatSessionTime } from '@/modules/agenda';
import type { SessionStatus, TodaySessionView, TodaySessionsResult } from '@/modules/dashboard';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

/**
 * Seção "Hoje" — the day's sessions, prioritized at the top of the dashboard.
 *
 * Pure presentational Server Component. It receives the already owner-scoped
 * `TodaySessionsResult` (computed by `getTodaySessions`) and never queries or
 * derives a link target itself: `openHref` is decided server-side from the
 * session's modality, so there is no open-redirect/IDOR surface here.
 *
 * Renders the next upcoming session with a primary "Abrir sessão" CTA, a
 * compact list of the day's other sessions with status badges, or an empty
 * state with a "agendar uma" link to the agenda.
 */

export interface SectionTodayProps {
  result: TodaySessionsResult;
  /** Where the "agendar uma" empty-state link points. Defaults to `/agenda`. */
  agendaHref?: string;
}

/**
 * Maps a clinical session status to its Sálvia Badge variant and pt-BR label.
 * `neutral` for not-yet-happened states, semantic colors for outcomes.
 */
const STATUS_BADGE: Record<
  SessionStatus,
  { variant: 'neutral' | 'info' | 'success' | 'danger' | 'warning'; label: string }
> = {
  scheduled: { variant: 'neutral', label: 'Agendada' },
  confirmed: { variant: 'info', label: 'Confirmada' },
  done: { variant: 'success', label: 'Realizada' },
  cancelled: { variant: 'danger', label: 'Cancelada' },
  no_show: { variant: 'warning', label: 'Faltou' },
};

function StatusBadge({ status }: { status: SessionStatus }) {
  const { variant, label } = STATUS_BADGE[status];
  return (
    <Badge variant={variant} data-testid={`dashboard-today-status-${status}`}>
      {label}
    </Badge>
  );
}

function modalityLabel(modality: TodaySessionView['modality']): string {
  if (modality === 'online') return 'Online';
  if (modality === 'in_person') return 'Presencial';
  return 'Sessão';
}

function patientLabel(name: string | null): string {
  return name ?? 'Paciente';
}

export function SectionToday({ result, agendaHref = '/agenda' }: SectionTodayProps) {
  const { next, sessions } = result;
  const hasSessions = sessions.length > 0;

  return (
    <Card data-testid="dashboard-section-today" data-tour-anchor="secao-hoje">
      <CardHeader className="flex-row items-center gap-2">
        <Calendar className="text-text-tertiary size-5" aria-hidden="true" />
        <CardTitle>Hoje</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!hasSessions ? (
          <p className="text-text-secondary text-sm" data-testid="dashboard-today-empty">
            Nenhuma sessão hoje. Que tal{' '}
            <Link
              href={agendaHref}
              className="text-brand-700 underline-offset-4 hover:underline"
              data-testid="dashboard-today-schedule-link"
            >
              agendar uma
            </Link>
            ?
          </p>
        ) : (
          <>
            {next ? (
              <div
                className="border-border-subtle flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                data-testid="dashboard-today-next"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-text-tertiary text-xs font-medium tracking-wide uppercase">
                    Próxima sessão
                  </span>
                  <span className="text-text-primary text-base font-semibold">
                    {formatSessionTime(next.startAt)} · {patientLabel(next.patientName)}
                  </span>
                  <span className="text-text-secondary text-sm">
                    {modalityLabel(next.modality)}
                  </span>
                </div>
                {next.openHref ? (
                  <Button asChild className="min-h-11">
                    <Link href={next.openHref} data-testid="dashboard-today-open-session">
                      Abrir sessão
                    </Link>
                  </Button>
                ) : null}
              </div>
            ) : null}

            <ul className="flex flex-col" data-testid="dashboard-today-list">
              {sessions.map((session) => (
                <li
                  key={session.sessionId}
                  className={cn(
                    'border-border-subtle flex items-center justify-between gap-3 border-b py-3 last:border-b-0',
                  )}
                  data-testid="dashboard-today-list-item"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="text-text-secondary text-sm tabular-nums">
                      {formatSessionTime(session.startAt)}
                    </span>
                    <span className="text-text-primary truncate text-sm">
                      {patientLabel(session.patientName)}
                    </span>
                  </div>
                  <StatusBadge status={session.status} />
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
