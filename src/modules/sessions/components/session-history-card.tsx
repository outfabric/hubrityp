'use client';

/**
 * SessionHistoryCard — one terminal session in the patient history tab
 * (RF-13.05–13.08, RF-13.15, RN-13.04, RN-13.05, RN-13.06).
 *
 * Renders a single Sálvia `interactive` card: a status badge (variant + Lucide
 * icon + label, all driven by `STATUS_PRESENTATION`), the full date with
 * weekday, the time range, and the duration. Optional facets — modality icon,
 * location name and amount — are shown only when present. Contextual neutral
 * tags surface couple sessions, reschedules and retroactive records.
 *
 * For `done` sessions an evolution indicator is shown: either "Evolução
 * registrada" with a "Ver" link (plus a subtle "Finalizada" hint once the
 * 30-day edit window has closed — RN-13.05) or "Sem evolução" with a primary
 * "Registrar" CTA. Non-`done` statuses never render the evolution indicator.
 *
 * For `cancelled` sessions the who / reason / notice / charge details are
 * surfaced (RN-13.06).
 *
 * This is a presentation-only leaf component: it takes a fully-typed,
 * already-serialized `SessionHistoryItem` and renders it. All formatting goes
 * through the São Paulo–timezone helpers in `session-history-formatters` so the
 * displayed wall-clock matches the clinical record regardless of the viewer's
 * machine timezone. Decorative icons are `aria-hidden`; standalone controls
 * carry an accessible label.
 */

import { ptBR } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';

import {
  isFinalizedReadOnly,
  MODALITY_ICON,
  STATUS_PRESENTATION,
  formatFullDateWithWeekday,
  formatTimeRange,
  type SessionDisplayStatus,
} from '@/modules/sessions/lib/session-history-formatters';
import type { SessionHistoryItem } from '@/modules/sessions/lib/session-history-schema';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionHistoryCardProps {
  /** The session to render — already owner-scoped and serialized by the server. */
  session: SessionHistoryItem;
  /**
   * Reference instant for the finalized read-only check (RN-13.05). Injectable
   * so tests stay deterministic; defaults to "now".
   */
  now?: Date;
}

// ---------------------------------------------------------------------------
// Formatters local to the card
// ---------------------------------------------------------------------------

const SAO_PAULO_TZ = 'America/Sao_Paulo';

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Short São Paulo wall-clock date, e.g. `"15/12/2025"`, for the reschedule tag. */
function formatShortDate(isoDate: string): string {
  return formatInTimeZone(isoDate, SAO_PAULO_TZ, 'dd/MM/yyyy', { locale: ptBR });
}

/** Human label for who cancelled the session (RN-13.06). */
function cancelledByLabel(cancelledBy: string): string {
  return cancelledBy === 'patient' ? 'Cancelada pelo paciente' : 'Cancelada por você';
}

/** Human label for the cancellation notice window (RN-13.06). */
function cancellationNoticeLabel(notice: string): string {
  switch (notice) {
    case '24h+':
      return 'Aviso com mais de 24h';
    case 'less_than_24h':
      return 'Aviso com menos de 24h';
    case 'less_than_2h':
      return 'Aviso com menos de 2h';
    default:
      return notice;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionHistoryCard({ session, now = new Date() }: SessionHistoryCardProps) {
  const status = session.status as SessionDisplayStatus;
  const presentation = STATUS_PRESENTATION[status];
  const StatusIcon = presentation.lucideIcon;
  const ModalityIcon = session.modality ? MODALITY_ICON[session.modality] : null;

  const isDone = session.status === 'done';
  const isCancelled = session.status === 'cancelled';

  const evolutionHref = session.evolutionId
    ? `/pacientes/${session.patientId}/prontuario/evolucoes/${session.evolutionId}`
    : null;
  const registerEvolutionHref = `/pacientes/${session.patientId}/prontuario/evolucoes/nova?sessionId=${session.id}`;
  const evolutionReadOnly = isFinalizedReadOnly(session.evolutionFinalizedAt, now);

  return (
    <article
      data-testid="session-history-card"
      className={cn(
        'bg-surface border-border flex flex-col gap-3 rounded-xl border p-4 shadow-xs',
        'duration-fast hover:border-border-strong transition-colors md:p-6',
      )}
    >
      {/* Header — status badge + tags */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={presentation.badgeVariant} className="gap-1">
          <StatusIcon aria-hidden className="size-4" />
          {presentation.label}
        </Badge>

        {session.isCouple && (
          <Badge variant="neutral" data-testid="tag-couple">
            Sessão de casal
          </Badge>
        )}

        {session.rescheduledFromDate && (
          <Badge variant="neutral" data-testid="tag-rescheduled">
            Remarcada de {formatShortDate(session.rescheduledFromDate)}
          </Badge>
        )}

        {session.isLateRecord && (
          <Badge variant="neutral" data-testid="tag-late-record">
            Registro retroativo
          </Badge>
        )}
      </div>

      {/* Date + time + duration */}
      <div className="flex flex-col gap-1">
        <p className="text-text-primary text-sm font-medium first-letter:uppercase">
          {formatFullDateWithWeekday(session.startAt)}
        </p>
        <p className="text-text-secondary text-sm">
          {formatTimeRange(session.startAt, session.endAt)}{' '}
          <span className="text-text-tertiary">· {session.durationMinutes} min</span>
        </p>
      </div>

      {/* Optional facets — modality, location, amount */}
      {(ModalityIcon || session.locationName || session.amount !== null) && (
        <div className="text-text-secondary flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {ModalityIcon && session.locationName && (
            <span className="flex items-center gap-1.5" data-testid="session-location">
              <ModalityIcon aria-hidden className="text-text-tertiary size-4" />
              {session.locationName}
            </span>
          )}

          {ModalityIcon && !session.locationName && (
            <ModalityIcon
              aria-hidden
              className="text-text-tertiary size-4"
              data-testid="session-modality-icon"
            />
          )}

          {session.amount !== null && (
            <span data-testid="session-amount">{currencyFormatter.format(session.amount)}</span>
          )}
        </div>
      )}

      {/* Evolution indicator — `done` only (RN-13.04, RN-13.05) */}
      {isDone && (
        <div className="flex flex-wrap items-center gap-2" data-testid="evolution-indicator">
          {evolutionHref ? (
            <>
              <Badge variant="success" data-testid="evolution-registered">
                Evolução registrada
              </Badge>
              {evolutionReadOnly && (
                <span className="text-text-tertiary text-xs" data-testid="evolution-finalized-hint">
                  Finalizada
                </span>
              )}
              <Button asChild variant="link" size="sm">
                <a href={evolutionHref}>Ver</a>
              </Button>
            </>
          ) : (
            <>
              <Badge variant="warning" data-testid="evolution-missing">
                Sem evolução
              </Badge>
              <Button asChild variant="default" size="sm">
                <a href={registerEvolutionHref}>Registrar</a>
              </Button>
            </>
          )}
        </div>
      )}

      {/* Cancellation details — `cancelled` only (RN-13.06) */}
      {isCancelled && (
        <div
          className="text-text-secondary flex flex-col gap-1 text-sm"
          data-testid="cancellation-details"
        >
          {session.cancelledBy && (
            <p data-testid="cancellation-by">{cancelledByLabel(session.cancelledBy)}</p>
          )}
          {session.cancellationReason && (
            <p data-testid="cancellation-reason">Motivo: {session.cancellationReason}</p>
          )}
          {session.cancellationNotice && (
            <p data-testid="cancellation-notice">
              {cancellationNoticeLabel(session.cancellationNotice)}
            </p>
          )}
          {session.chargeCancellation !== null && (
            <p data-testid="cancellation-charge">
              {session.chargeCancellation ? 'Cobrada' : 'Não cobrada'}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
