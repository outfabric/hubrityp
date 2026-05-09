'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Building2, Calendar, CheckCircle2, Clock, Pencil, Trash2, Video } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import type { SessionWithDetails } from '@/modules/agenda';
import {
  calculateEndTime,
  formatSessionDateFull,
  formatSessionTime,
  toSaoPauloTime,
} from '@/modules/agenda';
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
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Separator } from '@/shared/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/shared/ui/sheet';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionDetailDrawerProps {
  session: SessionWithDetails | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a mutation (mark done, delete) so the parent can refresh. */
  onSessionMutated: () => void;
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

function formatHistoryAction(action: string): string {
  switch (action) {
    case 'created':
      return 'Criada';
    case 'updated':
      return 'Atualizada';
    case 'rescheduled':
      return 'Reagendada';
    case 'status_changed':
      return 'Status alterado';
    case 'deleted':
      return 'Excluida';
    default:
      return action;
  }
}

function formatHistoryDescription(action: string, changes: Record<string, unknown>): string {
  if (action === 'status_changed' && changes.status) {
    const statusChange = changes.status as { old: string; new: string };
    const oldLabel = statusChange.old === 'scheduled' ? 'agendada' : 'realizada';
    const newLabel = statusChange.new === 'scheduled' ? 'agendada' : 'realizada';
    return `${oldLabel} → ${newLabel}`;
  }
  return '';
}

function formatAmount(amount: string | null | undefined): string {
  if (!amount) return '';
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Slide-in drawer for viewing session details.
 *
 * Design System Salvia — Sheet (right 480px desktop, bottom-up mobile).
 * Sections separated by Separator. Badge for status. Button secondary/primary
 * for actions. AlertDialog for delete confirmation on blocking slots.
 */
export function SessionDetailDrawer({
  session,
  open,
  onOpenChange,
  onSessionMutated,
}: SessionDetailDrawerProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [history, setHistory] = useState<SessionHistory[]>([]);
  const [isPending, startTransition] = useTransition();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Track the last session id we fetched history for so we avoid re-fetching
  // unnecessarily and can detect when we need a new fetch.
  const lastFetchedSessionId = useRef<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Fetch history when the drawer opens with a (new) session.
  // Uses a ref to track which session's history we've already fetched,
  // avoiding direct setState calls in the effect body.
  useEffect(() => {
    if (!open || !session) {
      lastFetchedSessionId.current = null;
      return;
    }

    // Already fetched for this session
    if (lastFetchedSessionId.current === session.id) return;

    lastFetchedSessionId.current = session.id;
    let cancelled = false;

    // Use a microtask to avoid synchronous setState in effect body
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

  const handleMarkDone = useCallback(() => {
    if (!session) return;

    startTransition(() => {
      void import('@/app/(app)/agenda/actions').then(({ markSessionDone }) =>
        markSessionDone(session.id).then((result) => {
          if (result.ok) {
            toast.success('Sessao marcada como realizada');
            onSessionMutated();
          } else {
            const msg =
              'message' in result ? result.message : 'Erro ao marcar sessao como realizada.';
            toast.error(msg);
          }
        }),
      );
    });
  }, [session, onSessionMutated]);

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

  if (!session) return null;

  const isBlocking = session.isBlocking;
  const isDone = session.status === 'done';

  const startLocal = toSaoPauloTime(new Date(session.startAt));
  const endLocal = toSaoPauloTime(
    calculateEndTime(new Date(session.startAt), session.durationMinutes),
  );

  const title = isBlocking
    ? (session.blockingTitle ?? 'Bloqueio')
    : (session.patientName ?? 'Paciente');

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
              {/* Accessible description for screen readers */}
              <SheetDescription className="sr-only">
                {isBlocking ? 'Detalhes do bloqueio' : 'Detalhes da sessao'}
              </SheetDescription>
            </div>
            {!isBlocking && (
              <div className="shrink-0">
                {isDone ? (
                  <Badge variant="success" data-testid="session-status-badge">
                    <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
                    Realizada
                  </Badge>
                ) : (
                  <Badge variant="neutral" data-testid="session-status-badge">
                    <Clock className="mr-1 h-3 w-3" aria-hidden="true" />
                    Agendada
                  </Badge>
                )}
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
                  {formatSessionDateFull(startLocal)}
                </p>
                <p className="text-text-secondary text-[13px]">
                  {formatSessionTime(startLocal)} - {formatSessionTime(endLocal)}
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
                      {history.map((entry) => {
                        const entryDate = new Date(entry.createdAt);
                        const description = formatHistoryDescription(
                          entry.action,
                          entry.changes as Record<string, unknown>,
                        );

                        return (
                          <li key={entry.id} className="flex items-start gap-2">
                            <Clock
                              className="text-text-tertiary mt-0.5 h-3 w-3 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="text-text-tertiary text-[12px]">
                              {format(entryDate, 'dd/MM/yyyy HH:mm', { locale: ptBR })} —{' '}
                              {formatHistoryAction(entry.action)}
                              {description ? `: ${description}` : ''}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer actions */}
          <Separator />
          <div className="flex items-center justify-end gap-3">
            {isBlocking ? (
              <>
                <Button
                  variant="secondary"
                  size="default"
                  disabled={isPending}
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
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="default"
                  disabled={isPending}
                  data-testid="session-edit-button"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  Editar
                </Button>
                {!isDone && (
                  <Button
                    variant="default"
                    size="default"
                    disabled={isPending}
                    onClick={handleMarkDone}
                    data-testid="session-mark-done-button"
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Marcar como realizada
                  </Button>
                )}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation dialog for blocking slots */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir bloqueio</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o bloqueio &quot;{session.blockingTitle ?? 'Bloqueio'}
              &quot;? Esta acao nao pode ser desfeita.
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
    </>
  );
}
