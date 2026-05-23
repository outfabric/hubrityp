'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Building2, Calendar, Clock, Pencil, Repeat, Trash2, Video, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  calculateEndTime,
  formatSessionDateFull,
  formatSessionTime,
} from '@/modules/agenda/lib/date-helpers';
import type { Action, SessionStatus } from '@/modules/agenda/lib/session-status';
import type { SessionWithDetails } from '@/modules/agenda/server/list-sessions';
import type { SessionHistory } from '@/shared/db/schema/agenda/tables';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Separator } from '@/shared/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/shared/ui/sheet';

import { CancelSessionDialog } from './cancel-session-dialog';
import { DeleteSessionDialog } from './delete-session-dialog';
import { SessionActionButtons } from './session-action-buttons';
import { SessionStatusBadge } from './session-status-badge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionDetailDrawerProps {
  session: SessionWithDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a mutation (mark done, delete) so the parent can refresh. */
  onSessionMutated: () => void;
  /** Called when the user wants to edit a session. */
  onEdit?: (session: SessionWithDetails) => void;
  /** Called when the user wants to cancel a recurring session. */
  onCancelRecurring?: (session: SessionWithDetails) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mql = window.matchMedia(query);

    function handler(e: MediaQueryListEvent) {
      setMatches(e.matches);
    }

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

function getModalityLabel(modality: string | null | undefined): string {
  switch (modality) {
    case 'in_person':
      return 'Presencial';
    case 'online':
      return 'Online';
    default:
      return '';
  }
}

function getLocationIcon(locationType: string | null | undefined) {
  if (locationType === 'online') {
    return <Video className="text-text-tertiary h-4 w-4 shrink-0" aria-hidden="true" />;
  }
  return <Building2 className="text-text-tertiary h-4 w-4 shrink-0" aria-hidden="true" />;
}

function formatAmount(amount: string | null | undefined): string {
  if (!amount) return '';
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------------------------------------------------------------------------
// History formatting — rich, human-readable descriptions in pt-BR
// ---------------------------------------------------------------------------

/** Maps cancellation reason values to pt-BR labels. */
const CANCELLATION_REASON_LABEL: Record<string, string> = {
  patient_cancelled: 'Paciente cancelou',
  therapist_cancelled: 'Psicologo cancelou',
  unforeseen: 'Imprevisto',
  other: 'Outro',
};

/**
 * Formats a session history entry into a human-readable pt-BR description.
 *
 * Uses the `action` and `changes` JSONB fields to produce descriptions like:
 * - "Criada em DD/MM/YYYY"
 * - "Confirmada pelo psicologo em DD/MM/YYYY"
 * - "Cancelada pelo psicologo em DD/MM/YYYY — Motivo: Paciente cancelou"
 * - "Marcada como realizada em DD/MM/YYYY"
 * - "Marcada como falta em DD/MM/YYYY"
 * - "Reativada em DD/MM/YYYY"
 * - "Remarcada em DD/MM/YYYY"
 */
function formatHistoryEntry(entry: SessionHistory): string {
  const dateStr = format(new Date(entry.createdAt), 'dd/MM/yyyy', { locale: ptBR });
  const changes = entry.changes as Record<string, unknown>;

  if (entry.action === 'created') {
    return `Criada em ${dateStr}`;
  }

  if (entry.action === 'rescheduled') {
    return `Remarcada em ${dateStr}`;
  }

  if (entry.action === 'updated') {
    return `Atualizada em ${dateStr}`;
  }

  if (entry.action === 'deleted') {
    return `Excluida em ${dateStr}`;
  }

  // Status changed — derive label from the target status
  if (entry.action === 'status_changed') {
    const statusChange = changes.status as { old: string; new: string } | undefined;

    // Graceful fallback when the changes JSONB doesn't contain the expected
    // `status` key (e.g., data written by a prior migration or seed).
    if (!statusChange) {
      return `Status alterado em ${dateStr}`;
    }

    const cancellation = changes.cancellation as
      | { reason?: string; cancelledBy?: string }
      | undefined;

    switch (statusChange.new) {
      case 'confirmed':
        return `Confirmada pelo psicologo em ${dateStr}`;

      case 'cancelled': {
        const cancelledByLabel = cancellation?.cancelledBy === 'patient' ? 'paciente' : 'psicologo';
        const reasonLabel = cancellation?.reason
          ? (CANCELLATION_REASON_LABEL[cancellation.reason] ?? cancellation.reason)
          : '';
        const base = `Cancelada pelo ${cancelledByLabel} em ${dateStr}`;
        return reasonLabel ? `${base} — Motivo: ${reasonLabel}` : base;
      }

      case 'done':
        return `Marcada como realizada em ${dateStr}`;

      case 'no_show':
        return `Marcada como falta em ${dateStr}`;

      case 'scheduled': {
        if (changes.reactivated) {
          return `Reativada em ${dateStr}`;
        }
        return `Status alterado para agendada em ${dateStr}`;
      }

      default:
        return `Status alterado em ${dateStr}`;
    }
  }

  // Fallback — for any unknown action types, display a human-readable
  // generic message instead of the raw action name.
  return `Atualizada em ${dateStr}`;
}

// ---------------------------------------------------------------------------
// Blocking slot delete dialog — extracted to keep the main component focused
// ---------------------------------------------------------------------------

function AlertDialogForBlocking({
  open,
  onOpenChange,
  isPending,
  handleDelete,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  handleDelete: () => void;
  title: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir bloqueio</AlertDialogTitle>
          <AlertDialogDescription>
            Tem certeza que deseja excluir o bloqueio &quot;{title}&quot;? Esta acao nao pode ser
            desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isPending}
            className="bg-danger-500 text-text-inverse hover:bg-danger-700"
          >
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Slide-in drawer for viewing session details.
 *
 * Design System Salvia — Sheet (right 480px desktop, bottom-up mobile).
 * Sections separated by Separator. SessionStatusBadge in header.
 * SessionActionButtons in footer. Session history chronological list in body.
 */
export function SessionDetailDrawer({
  session,
  open,
  onOpenChange,
  onSessionMutated,
  onEdit,
  onCancelRecurring,
}: SessionDetailDrawerProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [history, setHistory] = useState<SessionHistory[]>([]);
  const [isPending, startTransition] = useTransition();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Cancel session dialog state
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);

  // Soft-delete (hard_delete action) dialog state
  const [softDeleteDialogOpen, setSoftDeleteDialogOpen] = useState(false);

  // Track the last session id we fetched history for so we avoid re-fetching
  // unnecessarily and can detect when we need a new fetch.
  const lastFetchedSessionId = useRef<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Fetch history when the drawer opens with a (new) session.
  useEffect(() => {
    if (!open || !session) {
      lastFetchedSessionId.current = null;
      return;
    }

    // Already fetched for this session
    if (lastFetchedSessionId.current === session.id) return;

    lastFetchedSessionId.current = session.id;
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;
      setHistoryLoading(true);
    });

    void import('@/app/(app)/agenda/actions').then(({ getSessionHistory }) =>
      getSessionHistory(session.id).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setHistory(result.history);
        }
        setHistoryLoading(false);
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [open, session]);

  // Blocking slot delete handler
  const handleDelete = useCallback(() => {
    if (!session) return;

    startTransition(() => {
      void import('@/app/(app)/agenda/actions').then(({ deleteSession }) =>
        deleteSession(session.id).then((result) => {
          if (result.ok) {
            toast.success('Bloqueio excluido');
            setDeleteDialogOpen(false);
            onSessionMutated();
          } else {
            const msg = 'message' in result ? result.message : 'Erro ao excluir bloqueio.';
            toast.error(msg);
          }
        }),
      );
    });
  }, [session, onSessionMutated]);

  // Handler for SessionActionButtons — dispatches each action type to the
  // appropriate server action or opens a dialog for multi-step flows.
  const handleAction = useCallback(
    async (actionType: Action['type']) => {
      if (!session) return;

      switch (actionType) {
        case 'confirm': {
          const { confirmSession } = await import('@/app/(app)/agenda/actions');
          const result = await confirmSession(session.id);
          if (result.ok) {
            toast.success('Sessao confirmada');
            onSessionMutated();
          } else {
            const msg = 'message' in result ? result.message : 'Erro ao confirmar sessao.';
            toast.error(msg);
          }
          break;
        }

        case 'cancel':
          setCancelDialogOpen(true);
          break;

        case 'reschedule':
          // Open cancel dialog — reschedule starts with cancellation
          setCancelDialogOpen(true);
          break;

        case 'mark_done': {
          const { markSessionDone } = await import('@/app/(app)/agenda/actions');
          const result = await markSessionDone(session.id);
          if (result.ok) {
            toast.success('Sessao marcada como realizada');
            onSessionMutated();
          } else {
            const msg =
              'message' in result ? result.message : 'Erro ao marcar sessao como realizada.';
            toast.error(msg);
          }
          break;
        }

        case 'mark_no_show': {
          const { markSessionNoShow } = await import('@/app/(app)/agenda/actions');
          const result = await markSessionNoShow(session.id);
          if (result.ok) {
            toast.success('Sessao marcada como falta');
            onSessionMutated();
          } else {
            const msg = 'message' in result ? result.message : 'Erro ao marcar sessao como falta.';
            toast.error(msg);
          }
          break;
        }

        case 'reactivate': {
          const { reactivateSession } = await import('@/app/(app)/agenda/actions');
          const result = await reactivateSession(session.id);
          if (result.ok) {
            toast.success('Sessao reativada');
            onSessionMutated();
          } else {
            const msg = 'message' in result ? result.message : 'Erro ao reativar sessao.';
            toast.error(msg);
          }
          break;
        }

        case 'hard_delete':
          setSoftDeleteDialogOpen(true);
          break;

        case 'view_record':
          toast.info('Funcionalidade de prontuario em desenvolvimento.');
          break;

        case 'add_payment':
          toast.info('Funcionalidade de pagamento em desenvolvimento.');
          break;

        case 'charge_no_show':
          toast.info('Funcionalidade de cobranca em desenvolvimento.');
          break;
      }
    },
    [session, onSessionMutated],
  );

  if (!session) return null;

  const isBlocking = session.isBlocking;
  const sessionStatus = session.status as SessionStatus;

  // Pass UTC dates directly to formatSessionTime/formatSessionDateFull which
  // use formatInTimeZone internally — no manual toSaoPauloTime shift needed.
  const startUtc = new Date(session.startAt);
  const endUtc = calculateEndTime(startUtc, session.durationMinutes);

  const displayName = session.coupleDisplayName ?? session.patientName;
  const title = isBlocking ? (session.blockingTitle ?? 'Bloqueio') : (displayName ?? 'Paciente');

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={isMobile ? 'max-h-[85vh] overflow-y-auto p-6' : 'overflow-y-auto p-6 md:p-8'}
          data-testid="session-detail-drawer"
        >
          {/* Header */}
          <div className="flex items-start gap-3 pr-8">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-text-primary text-[18px] leading-[1.25] font-semibold">
                {title}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {isBlocking ? 'Detalhes do bloqueio' : 'Detalhes da sessao'}
              </SheetDescription>
            </div>
            {!isBlocking && (
              <div className="shrink-0" data-testid="session-status-badge">
                <SessionStatusBadge status={sessionStatus} />
              </div>
            )}
          </div>

          <Separator />

          {/* Body sections */}
          <div className="flex flex-col gap-4">
            {/* Date/time */}
            <div className="flex items-start gap-3">
              <Calendar className="text-text-tertiary mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-text-primary text-[15px] capitalize">
                  {formatSessionDateFull(startUtc)}
                </p>
                <p className="text-text-secondary text-[13px]">
                  {formatSessionTime(startUtc)} - {formatSessionTime(endUtc)}
                </p>
              </div>
            </div>

            {/* Location */}
            {session.locationName && (
              <>
                <Separator />
                <div className="flex items-start gap-3">
                  {getLocationIcon(session.locationType)}
                  <div>
                    <p className="text-text-primary text-[15px]">{session.locationName}</p>
                    {session.locationAddress && (
                      <p className="text-text-secondary text-[13px]">{session.locationAddress}</p>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Modality */}
            {!isBlocking && session.modality && (
              <>
                <Separator />
                <div className="flex items-center gap-3">
                  <span className="text-text-primary text-[15px]">
                    {getModalityLabel(session.modality)}
                  </span>
                </div>
              </>
            )}

            {/* Amount */}
            {!isBlocking && session.amount && (
              <>
                <Separator />
                <p className="text-text-primary text-[15px]">{formatAmount(session.amount)}</p>
              </>
            )}

            {/* Notes */}
            {session.notes && (
              <>
                <Separator />
                <div>
                  <p className="text-text-secondary mb-1 text-[12px] font-medium tracking-wide uppercase">
                    Observacoes
                  </p>
                  <p className="text-text-primary text-[15px]">{session.notes}</p>
                </div>
              </>
            )}

            {/* History */}
            {!isBlocking && (
              <>
                <Separator />
                <div>
                  <p className="text-text-secondary mb-2 text-[12px] font-medium tracking-wide uppercase">
                    Historico
                  </p>
                  {historyLoading ? (
                    <p className="text-text-tertiary text-[12px]">Carregando...</p>
                  ) : history.length === 0 ? (
                    <p className="text-text-tertiary text-[12px]">Nenhum registro</p>
                  ) : (
                    <ul className="flex flex-col gap-2" data-testid="session-history-list">
                      {history.map((entry) => (
                        <li key={entry.id} className="flex items-start gap-2">
                          <Clock
                            className="text-text-tertiary mt-0.5 h-3 w-3 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="text-text-tertiary text-[12px]">
                            {formatHistoryEntry(entry)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Recurring indicator */}
          {!isBlocking && session.recurrenceId && (
            <>
              <Separator />
              <div className="flex items-center gap-2">
                <Repeat className="text-text-tertiary h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="text-text-secondary text-[13px]">Sessao recorrente</span>
              </div>
            </>
          )}

          {/* Footer actions */}
          <Separator />
          {isBlocking ? (
            <div className="flex items-center justify-end gap-3">
              <Button
                variant="secondary"
                size="default"
                disabled={isPending}
                onClick={() => onEdit?.(session)}
                data-testid="session-edit-button"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Editar
              </Button>
              <Button
                variant="destructive"
                size="default"
                disabled={isPending}
                onClick={() => setDeleteDialogOpen(true)}
                data-testid="session-delete-button"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Excluir
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Start video button — only for online sessions that can still be joined */}
              {session.modality === 'online' &&
                (sessionStatus === 'scheduled' || sessionStatus === 'confirmed') && (
                  <Button variant="secondary" asChild data-testid="start-video-button">
                    <Link href={`/sessao/${session.id}/video`}>
                      <Video className="h-4 w-4" aria-hidden="true" />
                      Iniciar video
                    </Link>
                  </Button>
                )}

              {/* Edit and recurring cancel buttons */}
              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="secondary"
                  size="default"
                  disabled={isPending}
                  onClick={() => onEdit?.(session)}
                  data-testid="session-edit-button"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Editar
                </Button>
                {sessionStatus !== 'done' &&
                  sessionStatus !== 'cancelled' &&
                  session.recurrenceId && (
                    <Button
                      variant="secondary"
                      size="default"
                      disabled={isPending}
                      onClick={() => onCancelRecurring?.(session)}
                      data-testid="session-cancel-recurring-button"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                      Cancelar recorrencia
                    </Button>
                  )}
              </div>
              {/* Status-dependent action buttons */}
              <SessionActionButtons
                status={sessionStatus}
                session={{
                  updatedAt: new Date(session.updatedAt),
                  deletedAt: session.deletedAt ? new Date(session.deletedAt) : null,
                }}
                onAction={handleAction}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete confirmation dialog for blocking slots */}
      <AlertDialogForBlocking
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        isPending={isPending}
        handleDelete={handleDelete}
        title={session.blockingTitle ?? 'Bloqueio'}
      />

      {/* Cancel session dialog */}
      {!isBlocking && (
        <CancelSessionDialog
          sessionId={session.id}
          sessionStartAt={startUtc}
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          onConfirm={async (input) => {
            const { cancelSession } = await import('@/app/(app)/agenda/actions');
            return cancelSession(input);
          }}
          onSuccess={onSessionMutated}
        />
      )}

      {/* Soft-delete session dialog */}
      {!isBlocking && (
        <DeleteSessionDialog
          open={softDeleteDialogOpen}
          onOpenChange={setSoftDeleteDialogOpen}
          onConfirm={async () => {
            const { softDeleteSession } = await import('@/app/(app)/agenda/actions');
            return softDeleteSession(session.id);
          }}
          onSuccess={onSessionMutated}
        />
      )}
    </>
  );
}
