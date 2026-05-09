'use client';

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import type { ConflictResult, UpdateSessionResult } from '@/modules/agenda';
import { formatSessionDate, formatSessionTime, toSaoPauloTime } from '@/modules/agenda';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RescheduleInfo {
  /** Session ID to reschedule. */
  sessionId: string;
  /** Patient or blocking title for display. */
  label: string;
  /** Whether this is a blocking slot (not a patient session). */
  isBlocking: boolean;
  /** Original session fields needed to rebuild the update payload. */
  originalSession: {
    patientId: string | null;
    isBlocking: boolean;
    blockingTitle: string | null;
    durationMinutes: number;
    locationId: string | null;
    modality: string | null;
    amount: string | null;
    notes: string | null;
    color: string | null;
  };
  /** New start time (UTC Date). */
  newStart: Date;
  /** New end time (UTC Date). */
  newEnd: Date;
}

interface RescheduleConfirmDialogProps {
  /** Reschedule details. Null when dialog is closed. */
  rescheduleInfo: RescheduleInfo | null;
  /** Whether the dialog is open. */
  open: boolean;
  /** Called when the dialog wants to close. */
  onOpenChange: (open: boolean) => void;
  /** Server Action to update the session. */
  onConfirm: (sessionId: string, input: unknown) => Promise<UpdateSessionResult>;
  /** Called after a successful reschedule (e.g., to refresh sessions). */
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Confirmation dialog for drag-and-drop reschedule.
 *
 * Design System Salvia:
 *   - AlertDialog max-width 480px
 *   - Title "Remarcar sessao?"
 *   - Description with patient name, new date, and new time
 *   - Alert warning inline when a conflict exists at the destination time
 *   - Button primary "Confirmar", Button ghost "Cancelar"
 *   - Sonner toast success on confirm with CheckCircle2 icon
 */
export function RescheduleConfirmDialog({
  rescheduleInfo,
  open,
  onOpenChange,
  onConfirm,
  onSuccess,
}: RescheduleConfirmDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [conflicts, setConflicts] = useState<ConflictResult[]>([]);

  function buildPayload(forceConflict: boolean) {
    if (!rescheduleInfo) return null;

    const { originalSession, newStart } = rescheduleInfo;

    return {
      patient_id: originalSession.patientId ?? undefined,
      is_blocking: originalSession.isBlocking,
      blocking_title: originalSession.blockingTitle ?? undefined,
      start_at: newStart.toISOString(),
      duration_minutes: originalSession.durationMinutes,
      location_id: originalSession.locationId ?? undefined,
      modality: originalSession.modality ?? undefined,
      amount: originalSession.amount ?? undefined,
      notes: originalSession.notes ?? undefined,
      color: originalSession.color ?? undefined,
      force_conflict: forceConflict,
    };
  }

  function handleConfirm(forceConflict: boolean) {
    if (!rescheduleInfo) return;

    const payload = buildPayload(forceConflict);
    if (!payload) return;

    startTransition(async () => {
      const result = await onConfirm(rescheduleInfo.sessionId, payload);

      if (result.ok) {
        const localStart = toSaoPauloTime(rescheduleInfo.newStart);
        toast.success('Sessao remarcada', {
          description: `Sessao remarcada para ${formatSessionDate(localStart)} as ${formatSessionTime(localStart)}`,
          icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
        });
        setConflicts([]);
        onOpenChange(false);
        onSuccess();
        return;
      }

      if (result.error === 'conflict_warning' && 'conflicts' in result) {
        setConflicts(result.conflicts);
        return;
      }

      // Other errors
      const message =
        'message' in result ? result.message : 'Erro ao remarcar sessao. Tente novamente.';
      toast.error(message);
    });
  }

  function handleCancel() {
    setConflicts([]);
    onOpenChange(false);
  }

  // Reset conflicts when dialog closes externally
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setConflicts([]);
    }
    onOpenChange(nextOpen);
  }

  if (!rescheduleInfo) return null;

  const localStart = toSaoPauloTime(rescheduleInfo.newStart);
  const formattedDate = formatSessionDate(localStart);
  const formattedTime = formatSessionTime(localStart);

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent data-testid="reschedule-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Remarcar sessao?</AlertDialogTitle>
          <AlertDialogDescription>
            Remarcar sessao de {rescheduleInfo.label} para {formattedDate} as {formattedTime}?
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Conflict warning — shown after first attempt returns conflicts */}
        {conflicts.length > 0 && (
          <Alert variant="warning" data-testid="reschedule-conflict-alert">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              {conflicts.map((c) => (
                <span key={c.sessionId} className="block">
                  Voce ja tem {c.label} nesse horario. Remarcar mesmo assim?
                </span>
              ))}
            </AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <Button
            variant="ghost"
            onClick={handleCancel}
            disabled={isPending}
            data-testid="reschedule-cancel"
          >
            Cancelar
          </Button>
          <Button
            variant="default"
            onClick={() => handleConfirm(conflicts.length > 0)}
            disabled={isPending}
            data-testid="reschedule-confirm"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Remarcando...
              </>
            ) : (
              'Confirmar'
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
